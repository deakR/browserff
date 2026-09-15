import {
  AdtsOutputFormat,
  ALL_FORMATS,
  AUDIO_CODECS,
  FlacOutputFormat,
  MkvOutputFormat,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  MpegTsOutputFormat,
  OggOutputFormat,
  SUBTITLE_CODECS,
  VIDEO_CODECS,
  WavOutputFormat,
  WebMOutputFormat,
  type OutputFormat,
} from 'mediabunny';
import type { MuxContainer } from '../types';

export const VIDEO_CODEC_LIST: string[] = [...VIDEO_CODECS];
export const AUDIO_CODEC_LIST: string[] = [...AUDIO_CODECS];
export const SUBTITLE_CODEC_LIST: string[] = [...SUBTITLE_CODECS];

export interface InputFormatInfo {
  name: string;
  mime: string;
}

export function inputFormats(): InputFormatInfo[] {
  return ALL_FORMATS.map((f) => ({
    name: (f as { name?: string }).name ?? 'unknown',
    mime: (f as { mimeType?: string }).mimeType ?? '',
  }));
}

export interface OutputFormatInfo {
  id: string;
  label: string;
  codecs: string[];
  videoCodecs: string[];
  audioCodecs: string[];
  subtitleCodecs: string[];
}

function splitCodecs(all: string[]): { video: string[]; audio: string[]; sub: string[] } {
  const v = new Set(VIDEO_CODEC_LIST);
  const a = new Set(AUDIO_CODEC_LIST);
  const s = new Set(SUBTITLE_CODEC_LIST);
  return {
    video: all.filter((c) => v.has(c)),
    audio: all.filter((c) => a.has(c)),
    sub: all.filter((c) => s.has(c)),
  };
}

export function outputFormats(): OutputFormatInfo[] {
  const defs = [
    { id: 'mkv', label: 'Matroska (.mkv)', make: () => new MkvOutputFormat() },
    { id: 'mp4', label: 'MP4 (.mp4)', make: () => new Mp4OutputFormat() },
    { id: 'mov', label: 'QuickTime (.mov)', make: () => new MovOutputFormat() },
    { id: 'webm', label: 'WebM (.webm)', make: () => new WebMOutputFormat() },
    { id: 'ogg', label: 'Ogg (.ogg)', make: () => new OggOutputFormat() },
    { id: 'mp3', label: 'MP3 (.mp3)', make: () => new Mp3OutputFormat() },
    { id: 'wav', label: 'WAV (.wav)', make: () => new WavOutputFormat() },
    { id: 'flac', label: 'FLAC (.flac)', make: () => new FlacOutputFormat() },
  ];
  return defs.map((d) => {
    let codecs: string[] = [];
    try {
      codecs = [...d.make().getSupportedCodecs()];
    } catch { /* report what we can */ }
    const parts = splitCodecs(codecs);
    return { id: d.id, label: d.label, codecs, videoCodecs: parts.video, audioCodecs: parts.audio, subtitleCodecs: parts.sub };
  });
}

export function muxOutputFormat(container: MuxContainer) {
  return container === 'mkv' ? new MkvOutputFormat() : container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat();
}

export interface ExtractionFormat {
  id: string;
  label: string;
  ext: string;
  audioExt: string | null;
  videoMime: string;
  audioMime: string;
  make: () => OutputFormat;
}

function supportedCodecs(make: () => OutputFormat): string[] {
  try {
    return [...make().getSupportedCodecs()];
  } catch {
    return [];
  }
}

/** Every plain-file output format the engine can write, with standard extensions. */
export const EXTRACTION_FORMATS: ExtractionFormat[] = [
  { id: 'adts', label: 'ADTS AAC', ext: 'aac', audioExt: null, videoMime: '', audioMime: 'audio/aac', make: () => new AdtsOutputFormat() },
  { id: 'mp3', label: 'MP3', ext: 'mp3', audioExt: null, videoMime: '', audioMime: 'audio/mpeg', make: () => new Mp3OutputFormat() },
  { id: 'flac', label: 'FLAC', ext: 'flac', audioExt: null, videoMime: '', audioMime: 'audio/flac', make: () => new FlacOutputFormat() },
  { id: 'ogg', label: 'Ogg', ext: 'ogg', audioExt: null, videoMime: 'video/ogg', audioMime: 'audio/ogg', make: () => new OggOutputFormat() },
  { id: 'wav', label: 'WAV', ext: 'wav', audioExt: null, videoMime: '', audioMime: 'audio/wav', make: () => new WavOutputFormat() },
  { id: 'mp4', label: 'MP4', ext: 'mp4', audioExt: 'm4a', videoMime: 'video/mp4', audioMime: 'audio/mp4', make: () => new Mp4OutputFormat() },
  { id: 'mov', label: 'QuickTime', ext: 'mov', audioExt: null, videoMime: 'video/quicktime', audioMime: 'audio/mp4', make: () => new MovOutputFormat() },
  { id: 'mkv', label: 'Matroska', ext: 'mkv', audioExt: 'mka', videoMime: 'video/x-matroska', audioMime: 'audio/x-matroska', make: () => new MkvOutputFormat() },
  { id: 'webm', label: 'WebM', ext: 'webm', audioExt: 'weba', videoMime: 'video/webm', audioMime: 'audio/webm', make: () => new WebMOutputFormat() },
  { id: 'mpegts', label: 'MPEG-TS', ext: 'ts', audioExt: null, videoMime: 'video/mp2t', audioMime: 'audio/mp2t', make: () => new MpegTsOutputFormat() },
];

const formatCache = new Map<string, string[]>();

function codecsOf(f: ExtractionFormat): string[] {
  const hit = formatCache.get(f.id);
  if (hit) return hit;
  const list = supportedCodecs(f.make);
  formatCache.set(f.id, list);
  return list;
}

export function outputFormatById(id: string): OutputFormat {
  const f = EXTRACTION_FORMATS.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown output format: ${id}`);
  return f.make();
}

export function formatMime(id: string, kind: 'video' | 'audio'): string {  const f = EXTRACTION_FORMATS.find((x) => x.id === id);
  if (!f) return kind === 'video' ? 'video/mp4' : 'audio/mp4';
  return kind === 'video' ? f.videoMime || 'video/mp4' : f.audioMime;
}

export function formatExt(id: string, kind: 'video' | 'audio'): string {
  const f = EXTRACTION_FORMATS.find((x) => x.id === id);
  if (!f) return kind === 'video' ? 'mp4' : 'm4a';
  return kind === 'audio' && f.audioExt ? f.audioExt : f.ext;
}

const TRANSCODE_PREFERENCE = ['mp4', 'mkv', 'webm', 'mov', 'mpegts'];

/**
 * Containers that accept a given encode-codec pair, from the engine's own
 * supported-codec lists. Used to constrain compressor output choices.
 */
export function transcodeContainers(videoCodec: string | null, audioCodec: string | null): string[] {
  return TRANSCODE_PREFERENCE.filter((id) => {
    const f = EXTRACTION_FORMATS.find((x) => x.id === id);
    if (!f) return false;
    const list = codecsOf(f);
    if (videoCodec && videoCodec !== 'copy' && !list.includes(videoCodec)) return false;
    if (audioCodec && audioCodec !== 'copy' && audioCodec !== 'none' && !list.includes(audioCodec)) return false;
    return true;
  });
}

export interface ExtractionTarget {
  formatId: string;
  label: string;
  ext: string;
  mime: string;
  note: string;
}

const AUDIO_PREFERENCE = ['adts', 'mp3', 'flac', 'ogg', 'wav', 'mp4', 'mov', 'mkv', 'webm', 'mpegts'];
const VIDEO_PREFERENCE = ['mp4', 'mov', 'mkv', 'webm', 'mpegts'];

/**
 * Valid stream-copy extraction targets for a track codec, derived from the
 * engine's own per-format supported-codec lists. Empty means copy extraction
 * is impossible — the caller must block, never transcode silently.
 */
export function extractionTargets(codec: string | null, kind: 'video' | 'audio'): ExtractionTarget[] {
  if (!codec) return [];
  const pref = kind === 'video' ? VIDEO_PREFERENCE : AUDIO_PREFERENCE;
  const out: ExtractionTarget[] = [];
  for (const id of pref) {
    const f = EXTRACTION_FORMATS.find((x) => x.id === id);
    if (!f || !codecsOf(f).includes(codec)) continue;
    const ext = kind === 'audio' && f.audioExt ? f.audioExt : f.ext;
    const elementary = kind === 'audio' && ['adts', 'mp3', 'flac', 'ogg', 'wav'].includes(id);
    out.push({
      formatId: f.id,
      label: `${f.label} (.${ext})`,
      ext,
      mime: kind === 'audio' ? f.audioMime : f.videoMime,
      note: elementary ? 'elementary stream · copy' : 'container · copy',
    });
  }
  return out;
}

export function containerSupportsCodec(container: MuxContainer, codec: string | null): boolean {
  if (!codec) return false;
  try {
    return muxOutputFormat(container).getSupportedCodecs().includes(codec as never);
  } catch {
    return false;
  }
}
