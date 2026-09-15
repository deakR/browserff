import { BufferTarget, Conversion, Mp4OutputFormat, Output, Quality, WebMOutputFormat } from 'mediabunny';
import type { OperationConfig, ProcessedOutput, ProcessingProgress } from '../../types';
import { openInput } from './reader';
import { extractMetadata } from './metadata';
import { uid } from '../format';

export interface RunHandle {
  promise: Promise<ProcessedOutput>;
  cancel: () => Promise<void>;
}

function outputFormat(container: OperationConfig['container']) {
  return container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat();
}

export function runOperation(file: File, cfg: OperationConfig, onProgress: (p: ProcessingProgress) => void): RunHandle {
  let conv: Conversion | null = null;
  let cancelled = false;
  const started = performance.now();
  let frames = 0;

  const promise = (async (): Promise<ProcessedOutput> => {
    const input = await openInput(file);
    try {
      const target = new BufferTarget();
      const output = new Output({ format: outputFormat(cfg.container), target });

      const trim = cfg.start != null || cfg.end != null
        ? { start: cfg.start ?? 0, end: cfg.end ?? undefined }
        : undefined;

      const videos = await input.getVideoTracks().catch(() => []);
      const audios = await input.getAudioTracks().catch(() => []);
      const vset = cfg.videoIndices == null ? null : new Set(cfg.videoIndices);
      const aset = cfg.audioIndices == null ? null : new Set(cfg.audioIndices);

      const videoOpts = cfg.kind === 'extract-audio'
        ? { discard: true }
        : cfg.kind === 'remove-audio'
          ? undefined
          : buildVideoOpts(cfg);
      const audioOpts = cfg.kind === 'remove-audio'
        ? { discard: true }
        : cfg.kind === 'extract-audio'
          ? buildAudioOpts(cfg, true)
          : buildAudioOpts(cfg, false);

      conv = await Conversion.init({
        input,
        output,
        trim,
        video: videoOpts === undefined && vset == null
          ? undefined
          : (t) => {
            const idx = videos.indexOf(t as never);
            if (vset && !vset.has(idx)) return { discard: true };
            if (cfg.kind === 'remove-audio') return undefined;
            return videoOpts as never;
          },
        audio: audioOpts === undefined && aset == null
          ? undefined
          : (t) => {
            const idx = audios.indexOf(t as never);
            if (aset && !aset.has(idx)) return { discard: true };
            if (cfg.kind === 'remove-audio') return { discard: true };
            return audioOpts as never;
          },
        copy: cfg.kind === 'compress' || cfg.kind === 'transcode' || cfg.kind === 'convert' ? {} : undefined,
        showWarnings: false,
      });
      conv.onProgress = (progress: number, processedTime: number) => {
        frames++;
        const elapsed = performance.now() - started;
        const fps = elapsed > 0 ? (frames / elapsed) * 1000 : null;
        const stage = progress < 0.15 ? 'demux' : progress < 0.45 ? 'decode' : progress < 0.6 ? 'transform' : progress < 0.9 ? 'encode' : 'mux';
        onProgress({ stage, progress, processedSeconds: processedTime ?? null, elapsedMs: elapsed, fps });
      };
      await conv.execute();
      if (cancelled) throw new Error('Processing cancelled');
      onProgress({ stage: 'done', progress: 1, processedSeconds: null, elapsedMs: performance.now() - started, fps: null });

      const buf = target.buffer;
      if (!buf) throw new Error('Encoder produced no output. The selected codec/container combination may be unsupported in this browser.');
      const blob = new Blob([buf], { type: cfg.container === 'webm' ? 'video/webm' : 'video/mp4' });
      const metaInput = await openInput(blob);
      let metadata = null;
      try {
        metadata = await extractMetadata(metaInput);
      } finally {
        metaInput.dispose();
      }
      return {
        id: uid('out'),
        blob,
        objectUrl: URL.createObjectURL(blob),
        size: blob.size,
        container: cfg.container,
        config: cfg,
        metadata,
        durationMs: performance.now() - started,
        createdAt: Date.now(),
      };
    } finally {
      input.dispose();
    }
  })();

  return {
    promise,
    cancel: async () => {
      cancelled = true;
      if (conv) await conv.cancel().catch(() => undefined);
    },
  };
}

function buildVideoOpts(cfg: OperationConfig) {
  if (cfg.videoCodec === 'copy' && cfg.width == null && cfg.frameRate == null) return undefined;
  if (cfg.videoCodec === 'copy') {
    return {
      width: cfg.width, height: cfg.height, fit: 'contain' as const,
      frameRate: cfg.frameRate ?? undefined,
    };
  }
  const codec = cfg.videoCodec === 'hevc' ? 'hevc' : cfg.videoCodec === 'vp9' ? 'vp9' : cfg.videoCodec === 'av1' ? 'av1' : 'avc';
  return {
    codec,
    width: cfg.width,
    height: cfg.height,
    fit: 'contain' as const,
    frameRate: cfg.frameRate ?? undefined,
    quality: cfg.videoBitrate
      ? new Quality({ bitrate: cfg.videoBitrate, bitrateMode: 'variable' })
      : new Quality({ quality: cfg.videoQuality ?? 0.7, preferBitrate: true }),
    forceTranscode: true,
  };
}

function buildAudioOpts(cfg: OperationConfig, forExtraction: boolean) {
  if (!forExtraction && cfg.audioCodec === 'copy' && cfg.audioBitrate == null && cfg.audioChannels == null && cfg.audioSampleRate == null) return undefined;
  if (cfg.audioCodec === 'copy') {
    if (cfg.audioChannels == null && cfg.audioSampleRate == null) return undefined;
    return {
      numberOfChannels: cfg.audioChannels ?? undefined,
      sampleRate: cfg.audioSampleRate ?? undefined,
      forceTranscode: true,
    };
  }
  if (cfg.audioCodec === 'none') return { discard: true };
  const codec = cfg.audioCodec === 'opus' ? 'opus' : cfg.audioCodec === 'mp3' ? 'mp3' : 'aac';
  return {
    codec,
    forceTranscode: true,
    quality: cfg.audioBitrate ? new Quality({ bitrate: cfg.audioBitrate }) : new Quality(0.6),
    numberOfChannels: cfg.audioChannels ?? undefined,
    sampleRate: cfg.audioSampleRate ?? undefined,
  };
}

export function describeRunError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'ConversionCanceledError' || err.message.toLowerCase().includes('cancel')) {
      return 'Processing was cancelled. Temporary resources were released.';
    }
    const m = err.message;
    if (m.toLowerCase().includes('codec') || m.toLowerCase().includes('encode')) {
      return `Encode failed: ${m} Try H.264 video with AAC audio in MP4, which has the widest browser encoder support.`;
    }
    if (m.toLowerCase().includes('decode')) {
      return `Decode failed: ${m} The browser does not currently expose a decoder for this track.`;
    }
    return m;
  }
  return 'Processing failed for an unknown reason. Try a shorter trim or a different codec.';
}
