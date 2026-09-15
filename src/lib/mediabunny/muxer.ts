import {
  BufferTarget,
  Conversion,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Output,
  TextSubtitleSource,
} from 'mediabunny';
import type { MuxContainer, MuxTrackSelection, PlannedTrack, ProcessingProgress, SourceFileEntry } from '../../types';
import { containerSupportsCodec, formatMime, muxOutputFormat, outputFormatById } from '../codecs';
import { srtToVtt } from '../subtitles';
import { openInput } from './reader';
import { uid } from '../format';

export interface PlanInput {
  sources: SourceFileEntry[];
  selections: MuxTrackSelection[];
  container: MuxContainer;
}

/** Pure planner: container×codec verdicts from the real output format. No faking. */
export function planMux(plan: PlanInput): PlannedTrack[] {
  const byId = new Map(plan.sources.map((s) => [s.id, s]));
  return plan.selections
    .filter((s) => s.include)
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      const src = byId.get(s.sourceId);
      if (s.kind === 'subtitle') {
        const has = !!src?.subtitle;
        if (!src || !has) {
          return { ...s, sourceName: src?.name ?? '?', codec: null, verdict: 'dropped', verdictReason: 'Subtitle source is no longer available.' };
        }
        if (containerSupportsCodec(plan.container, 'webvtt')) {
          const conv = src.subtitle?.format === 'srt';
          return {
            ...s, sourceName: src.name, codec: src.subtitle?.format.toUpperCase() ?? 'SRT', verdict: 'copy',
            verdictReason: conv ? 'SRT will be converted to WebVTT (the only subtitle codec this engine writes) without touching media streams.' : 'WebVTT subtitle will be muxed without re-encoding media.',
          };
        }
        return {
          ...s, sourceName: src.name, codec: src.subtitle?.format.toUpperCase() ?? 'SRT', verdict: 'unsupported',
          verdictReason: `${plan.container.toUpperCase()} does not accept WebVTT subtitles via this engine. Change container or remove the track.`,
        };
      }
      const track = s.kind === 'video'
        ? src?.metadata?.videoTracks[s.trackIndex] ?? null
        : src?.metadata?.audioTracks[s.trackIndex] ?? null;
      const codec = track?.codec ?? null;
      if (!src || !track) {
        return { ...s, sourceName: src?.name ?? '?', codec, verdict: 'dropped', verdictReason: 'Source track is no longer available.' };
      }
      if (containerSupportsCodec(plan.container, codec)) {
        return { ...s, sourceName: src.name, codec, verdict: 'copy', verdictReason: 'Container supports this codec. Stream will be copied without re-encoding.' };
      }
      return {
        ...s, sourceName: src.name, codec, verdict: 'unsupported',
        verdictReason: `${plan.container.toUpperCase()} does not accept ${(codec ?? 'unknown').toUpperCase()} via this engine. Choose another container or transcode the track.`,
      };
    });
}

/** Dry-run validation of a single-file remux using a real Conversion.init (no execute). */
export async function dryRunSingleRemux(
  file: File,
  videoIdx: number[],
  audioIdx: number[],
  container: MuxContainer,
): Promise<{ valid: boolean; copied: number; discarded: Array<{ track: string; reason: string }> }> {
  const input = await openInput(file);
  try {
    const vset = new Set(videoIdx);
    const aset = new Set(audioIdx);
    const videos = await input.getVideoTracks();
    const audios = await input.getAudioTracks();
    const target = new BufferTarget();
    const output = new Output({ format: muxOutputFormat(container), target });
    const conv = await Conversion.init({
      input,
      output,
      video: (t) => (videos.includes(t) && vset.has(videos.indexOf(t)) ? undefined : { discard: true }),
      audio: (t) => (audios.includes(t) && aset.has(audios.indexOf(t)) ? undefined : { discard: true }),
      copy: { mode: 'forced' },
      showWarnings: false,
    });
    return {
      valid: conv.isValid,
      copied: conv.utilizedTracks.length,
      discarded: conv.discardedTracks.map((d) => ({ track: `${d.track.type} #${d.track.number}`, reason: d.reason })),
    };
  } finally {
    input.dispose();
  }
}

export interface RunHandle {
  promise: Promise<{ blob: Blob; size: number }>;
  cancel: () => Promise<void>;
}

function trackLabel(kind: string, idx: number): string {
  return `${kind} #${idx + 1}`;
}

/** Single-file remux: selected tracks copied (never re-encoded), optional title via tags. */
export function remuxSingleFile(
  file: File,
  videoIdx: number[],
  audioIdx: number[],
  container: MuxContainer,
  title: string | null,
  onProgress: (p: ProcessingProgress) => void,
): RunHandle {
  let conv: Conversion | null = null;
  let cancelled = false;
  const started = performance.now();
  const promise = (async () => {
    const input = await openInput(file);
    try {
      const vset = new Set(videoIdx);
      const aset = new Set(audioIdx);
      const videos = await input.getVideoTracks();
      const audios = await input.getAudioTracks();
      const target = new BufferTarget();
      const output = new Output({ format: muxOutputFormat(container), target });
      conv = await Conversion.init({
        input,
        output,
        video: (t) => (vset.has(videos.indexOf(t)) ? undefined : { discard: true }),
        audio: (t) => (aset.has(audios.indexOf(t)) ? undefined : { discard: true }),
        copy: { mode: 'forced' },
        tags: title ? { title } : undefined,
        showWarnings: false,
      });
      if (!conv.isValid) {
        const reasons = conv.discardedTracks.map((d) => `${d.track.type} #${d.track.number}: ${d.reason}`).join('; ');
        throw new Error(`Remux is not possible for this selection (${reasons || 'no utilizable tracks'}).`);
      }
      conv.onProgress = (progress: number) => {
        onProgress({ stage: progress < 0.9 ? 'mux' : 'done', progress, processedSeconds: null, elapsedMs: performance.now() - started, fps: null });
      };
      await conv.execute();
      if (cancelled) throw new Error('Remux cancelled');
      const buf = target.buffer;
      if (!buf) throw new Error('Remux produced no output.');
      const blob = new Blob([buf], { type: container === 'mkv' ? 'video/x-matroska' : container === 'webm' ? 'video/webm' : 'video/mp4' });
      return { blob, size: blob.size };
    } finally {
      input.dispose();
    }
  })();
  return { promise, cancel: async () => { cancelled = true; if (conv) await conv.cancel().catch(() => undefined); } };
}

export interface ManualCopyTrack {
  file: File | null;
  sourceName: string;
  kind: 'video' | 'audio' | 'subtitle';
  trackIndex: number;
  name: string | null;
  languageCode: string | null;
  makeDefault: boolean | null;
  makeForced: boolean | null;
  subtitleText: string | null;
}

/**
 * True multi-file remux by copying encoded packets (no decode/re-encode).
 * Per-track name/language/default/forced overrides are written to the output.
 * The packet-copy path cannot transcode by construction; unsupported
 * container/codec combinations fail instead of degrading silently.
 */
export function remuxManualCopy(
  tracks: ManualCopyTrack[],
  formatId: string,
  onProgress: (p: ProcessingProgress) => void,
  title: string | null = null,
): RunHandle {
  let cancelled = false;
  let output: Output | null = null;
  const started = performance.now();
  const promise = (async () => {
    const target = new BufferTarget();
    output = new Output({ format: outputFormatById(formatId), target });
    type Prepared =
      | { kind: 'video'; spec: ManualCopyTrack; input: import('mediabunny').Input; track: import('mediabunny').InputVideoTrack; source: EncodedVideoPacketSource }
      | { kind: 'audio'; spec: ManualCopyTrack; input: import('mediabunny').Input; track: import('mediabunny').InputAudioTrack; source: EncodedAudioPacketSource }
      | { kind: 'subtitle'; spec: ManualCopyTrack };
    const prepared: Prepared[] = [];
    try {
      // Pass 1: open inputs, create sources, register output tracks (defines output order).
      for (const spec of tracks) {
        if (cancelled) throw new Error('Remux cancelled');
        if (spec.kind === 'subtitle') {
          if (!spec.subtitleText) throw new Error(`Missing subtitle data for ${spec.sourceName}.`);
          let vtt = spec.subtitleText;
          if (spec.subtitleText.trimStart().startsWith('WEBVTT') === false) {
            vtt = srtToVtt(spec.subtitleText);
          }
          const source = new TextSubtitleSource('webvtt');
          output.addSubtitleTrack(source, {
            name: spec.name ?? undefined,
            languageCode: spec.languageCode ?? 'und',
            disposition: {
              ...(spec.makeDefault != null ? { default: spec.makeDefault } : {}),
              ...(spec.makeForced != null ? { forced: spec.makeForced } : {}),
            },
          });
          prepared.push({ kind: 'subtitle', spec });
          await source.add(vtt);
          continue;
        }
        const input = await openInput(spec.file as File);
        try {
          if (spec.kind === 'video') {
            const list = await input.getVideoTracks();
            const track = list[spec.trackIndex];
            if (!track) throw new Error(`Missing video track ${trackLabel('video', spec.trackIndex)} in ${spec.sourceName}.`);
            const codec = await track.getCodec();
            if (!codec) throw new Error(`Unknown video codec in ${spec.sourceName}.`);
            const source = new EncodedVideoPacketSource(codec);
            const disp = await track.getDisposition().catch(() => null);
            output.addVideoTrack(source, {
              name: spec.name ?? (await track.getName().catch(() => null)) ?? undefined,
              languageCode: spec.languageCode ?? (await track.getLanguageCode().catch(() => 'und')),
              disposition: {
                ...disp,
                ...(spec.makeDefault != null ? { default: spec.makeDefault } : {}),
                ...(spec.makeForced != null ? { forced: spec.makeForced } : {}),
              },
            });
            prepared.push({ kind: 'video', spec, input, track, source });
          } else {
            const list = await input.getAudioTracks();
            const track = list[spec.trackIndex];
            if (!track) throw new Error(`Missing audio track ${trackLabel('audio', spec.trackIndex)} in ${spec.sourceName}.`);
            const codec = await track.getCodec();
            if (!codec) throw new Error(`Unknown audio codec in ${spec.sourceName}.`);
            const source = new EncodedAudioPacketSource(codec);
            const disp = await track.getDisposition().catch(() => null);
            output.addAudioTrack(source, {
              name: spec.name ?? (await track.getName().catch(() => null)) ?? undefined,
              languageCode: spec.languageCode ?? (await track.getLanguageCode().catch(() => 'und')),
              disposition: {
                ...disp,
                ...(spec.makeDefault != null ? { default: spec.makeDefault } : {}),
                ...(spec.makeForced != null ? { forced: spec.makeForced } : {}),
              },
            });
            prepared.push({ kind: 'audio', spec, input, track, source });
          }
        } catch (e) {
          input.dispose();
          throw e;
        }
      }
      if (prepared.length === 0) throw new Error('No tracks selected for output.');
      if (title) output.setMetadataTags({ title });
      await output.start();
      // Pass 2: copy encoded packets track by track.
      for (let i = 0; i < prepared.length; i++) {
        if (cancelled) throw new Error('Remux cancelled');
        const p = prepared[i];
        if (p.kind === 'subtitle') {
          onProgress({ stage: 'mux', progress: (i + 1) / prepared.length, processedSeconds: null, elapsedMs: performance.now() - started, fps: null });
          continue;
        }
        onProgress({ stage: 'mux', progress: i / prepared.length, processedSeconds: null, elapsedMs: performance.now() - started, fps: null });
        const sink = new EncodedPacketSink(p.track);
        const decoderConfig = await p.track.getDecoderConfig().catch(() => null);
        let first = true;
        for await (const packet of sink.packets()) {
          if (cancelled) throw new Error('Remux cancelled');
          if (first && decoderConfig) {
            await p.source.add(packet, { decoderConfig } as never);
            first = false;
          } else {
            await p.source.add(packet);
            first = false;
          }
        }
      }
      await output.finalize();
    } finally {
      for (const p of prepared) {
        if (p.kind !== 'subtitle') p.input.dispose();
      }
    }
    if (cancelled) throw new Error('Remux cancelled');
    onProgress({ stage: 'done', progress: 1, processedSeconds: null, elapsedMs: performance.now() - started, fps: null });
    const buf = target.buffer;
    if (!buf) throw new Error('Remux produced no output.');
    const hasVideo = tracks.some((t) => t.kind === 'video');
    const blob = new Blob([buf], { type: formatMime(formatId, hasVideo ? 'video' : 'audio') });
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

export function muxFileName(title: string | null, container: MuxContainer): string {
  const base = (title?.trim() || 'browserff-mux').replace(/[\\/:*?"<>|]+/g, '-');
  return `${base}.${container === 'mkv' ? 'mkv' : container}`;
}

export function newSelectionId(): string {
  return uid('sel');
}
