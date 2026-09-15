import {
  AudioBufferSink,
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  EncodedPacketSink,
  Output,
  Quality,
  VideoSampleSink,
} from 'mediabunny';
import type { MediaMetadata, ProcessingProgress } from '../../types';
import { formatMime, outputFormatById } from '../codecs';
import { openInput } from './reader';

export interface SplitSegment {
  start: number;
  end: number;
}

/** Split a duration into segments at the given sorted cut points. */
export function segmentsFromTimestamps(duration: number, points: number[]): SplitSegment[] {
  const cuts = [...new Set(points.filter((p) => p > 0 && p < duration))].sort((a, b) => a - b);
  const bounds = [0, ...cuts, duration];
  const out: SplitSegment[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    if (bounds[i + 1] > bounds[i]) out.push({ start: bounds[i], end: bounds[i + 1] });
  }
  return out;
}

/** Split into parts of at most partBytes, using the overall bitrate as the ruler. Labeled estimate. */
export function segmentsFromSize(sizeBytes: number, duration: number, partBytes: number): SplitSegment[] {
  if (!(duration > 0) || !(partBytes > 0)) return [];
  const n = Math.max(1, Math.ceil(sizeBytes / partBytes));
  if (n === 1) return [{ start: 0, end: duration }];
  const out: SplitSegment[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ start: (duration * i) / n, end: (duration * (i + 1)) / n });
  }
  return out;
}

export function segmentFileName(base: string, index: number, total: number, ext: string): string {
  const stem = base.replace(/\.[^.]+$/, '') || 'output';
  const digits = String(total).length;
  return `${stem}-${String(index + 1).padStart(digits, '0')}.${ext}`;
}

/**
 * Snap requested cut points to the nearest preceding keyframe so stream-copy
 * splits start on decodable frames. Falls back to the requested time when the
 * file has no video track or no key packet is found.
 */
export async function snapToKeyframes(file: File, times: number[]): Promise<number[]> {
  const input = await openInput(file);
  try {
    const track = await input.getPrimaryVideoTrack().catch(() => null);
    if (!track) return [...times];
    const sink = new EncodedPacketSink(track);
    const out: number[] = [];
    for (const t of times) {
      try {
        const key = await sink.getKeyPacket(t);
        out.push(key ? key.timestamp : t);
      } catch {
        out.push(t);
      }
    }
    return out;
  } finally {
    input.dispose();
  }
}

export interface JoinConfig {
  container: 'mp4' | 'webm' | 'mkv';
  videoCodec: 'avc' | 'vp9' | 'av1';
  videoQuality: number;
  width: number | null;
  audioCodec: 'aac' | 'opus';
  audioBitrate: number;
  label: string;
}

export interface JoinHandle {
  promise: Promise<{ blob: Blob; size: number }>;
  cancel: () => Promise<void>;
}

/**
 * Sequential join (append) of multiple files into one output.
 * Packet timestamps are immutable in this engine, so same-codec stream
 * concatenation is impossible: join always decodes and re-encodes through
 * CanvasSource (explicit timestamps) and AudioBufferSource (sequential
 * placement). Slow but real.
 */
export function joinFiles(files: File[], cfg: JoinConfig, onProgress: (p: ProcessingProgress) => void): JoinHandle {
  let cancelled = false;
  let output: Output | null = null;
  const started = performance.now();
  const promise = (async () => {
    if (files.length < 2) throw new Error('Join needs at least two files.');
    const target = new BufferTarget();
    output = new Output({ format: outputFormatById(cfg.container), target });

    const canvas = document.createElement('canvas');
    canvas.width = cfg.width ?? 1280;
    canvas.height = Math.round(((cfg.width ?? 1280) * 9) / 16);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    const videoSource = new CanvasSource(canvas, {
      codec: cfg.videoCodec,
      quality: new Quality({ quality: cfg.videoQuality, preferBitrate: true }),
    });
    output.addVideoTrack(videoSource);
    const audioSource = new AudioBufferSource(
      { codec: cfg.audioCodec, quality: new Quality({ bitrate: cfg.audioBitrate }) },
      { startTimestamp: 0 },
    );
    output.addAudioTrack(audioSource);
    await output.start();

    let offset = 0;
    let frames = 0;
    for (let fi = 0; fi < files.length; fi++) {
      if (cancelled) throw new Error('Join cancelled');
      const file = files[fi];
      const input = await openInput(file);
      try {
        const duration = await input.computeDuration().catch(() => 0);
        const vtrack = await input.getPrimaryVideoTrack().catch(() => null);
        const atrack = await input.getPrimaryAudioTrack().catch(() => null);
        if (!vtrack) throw new Error(`${file.name} has no video track; joining mixed media is not supported.`);
        const vsink = new VideoSampleSink(vtrack);
        for await (const sample of vsink.samples()) {
          if (cancelled) throw new Error('Join cancelled');
          sample.draw(ctx, 0, 0, canvas.width, canvas.height);
          await videoSource.add(offset + sample.timestamp, sample.duration || 1 / 30);
          sample.close();
          frames++;
          if (frames % 30 === 0) {
            const elapsed = performance.now() - started;
            onProgress({ stage: 'encode', progress: -1, processedSeconds: offset + sample.timestamp, elapsedMs: elapsed, fps: frames / (elapsed / 1000) });
          }
        }
        if (atrack) {
          const asink = new AudioBufferSink(atrack);
          for await (const wrapped of asink.buffers()) {
            if (cancelled) throw new Error('Join cancelled');
            await audioSource.add(wrapped.buffer);
          }
        }
        offset += duration || 0;
        onProgress({ stage: 'encode', progress: (fi + 1) / files.length, processedSeconds: offset, elapsedMs: performance.now() - started, fps: null });
      } finally {
        input.dispose();
      }
    }
    await output.finalize();
    if (cancelled) throw new Error('Join cancelled');
    const buf = target.buffer;
    if (!buf) throw new Error('Join produced no output.');
    const blob = new Blob([buf], { type: formatMime(cfg.container, 'video') });
    return { blob, size: blob.size };
  })();
  return {
    promise,
    cancel: async () => {
      cancelled = true;
      if (output) await output.cancel().catch(() => undefined);
    },
  };
}

export function joinFileName(firstName: string, container: JoinConfig['container']): string {
  const stem = firstName.replace(/\.[^.]+$/, '') || 'joined';
  return `${stem}-joined.${container === 'mkv' ? 'mkv' : container}`;
}

export function describeJoinConfig(cfg: JoinConfig): string {
  return `video ${cfg.videoCodec.toUpperCase()}${cfg.width ? ` ${cfg.width}w` : ''} q${cfg.videoQuality.toFixed(2)} + audio ${cfg.audioCodec.toUpperCase()} ${Math.round(cfg.audioBitrate / 1000)}k → ${cfg.container.toUpperCase()}`;
}

/** Compatibility rows for join sources. Join always re-encodes; matches only reduce generational loss. */
export function joinCompatibility(metas: Array<{ name: string; meta: MediaMetadata | null }>): Array<{ name: string; video: string; audio: string; duration: string }> {
  return metas.map(({ name, meta }) => ({
    name,
    video: meta?.primaryVideo
      ? `${(meta.primaryVideo.codec ?? '?').toUpperCase()} ${meta.primaryVideo.displayWidth ?? '?'}×${meta.primaryVideo.displayHeight ?? '?'} ${(meta.primaryVideo.frameRate ?? 0).toFixed(0)}fps`
      : 'none',
    audio: meta?.primaryAudio ? `${(meta.primaryAudio.codec ?? '?').toUpperCase()} ${meta.primaryAudio.channels ?? '?'}ch` : 'none',
    duration: meta?.duration != null ? `${meta.duration.toFixed(1)}s` : 'N/A',
  }));
}

