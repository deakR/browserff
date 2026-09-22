import type { CompressionEstimate, MediaMetadata, OperationConfig, QualityTier } from '../types';
import { QUALITY_TIER_VALUE } from '../types';

export interface SmartAdvice {
  text: string;
  kind: 'resolution' | 'bitrate' | 'codec' | 'audio' | 'general';
}

function primaryVideoBitrate(meta: MediaMetadata): number | null {
  const v = meta.primaryVideo;
  return v ? (v.bitrate ?? v.averageBitrate ?? null) : null;
}

function primaryAudioBitrate(meta: MediaMetadata): number | null {
  const a = meta.primaryAudio;
  return a ? (a.bitrate ?? a.averageBitrate ?? null) : null;
}

/** Recommendations generated from measured metadata. No hardcoding. */
export function smartAnalysis(meta: MediaMetadata, sizeBytes: number): SmartAdvice[] {
  const out: SmartAdvice[] = [];
  const v = meta.primaryVideo;
  const vb = primaryVideoBitrate(meta);
  const ab = primaryAudioBitrate(meta);
  const dur = meta.duration;

  if (v?.displayWidth && v.displayHeight && v.displayWidth >= 3000) {
    out.push({
      kind: 'resolution',
      text: `Source is ${v.displayWidth}×${v.displayHeight}. Reducing resolution to 1080p will generally provide a much larger size reduction than lowering quality alone.`,
    });
  }
  if (vb && v?.displayWidth && v.displayHeight) {
    const perMpx = vb / ((v.displayWidth * v.displayHeight) / 1_000_000);
    if (perMpx > 3_000_000) {
      out.push({ kind: 'bitrate', text: 'Video bitrate is high relative to the current resolution and duration. Re-encoding at a moderate setting usually preserves visual quality at a lower rate.' });
    }
  }
  if (ab && dur && dur > 0) {
    const audioBytes = (ab * dur) / 8;
    if (audioBytes / sizeBytes > 0.15 && (ab ?? 0) > 192_000) {
      out.push({ kind: 'audio', text: `Audio contributes roughly ${Math.round((audioBytes / sizeBytes) * 100)}% of the file. Consider a lower bitrate or a more efficient codec.` });
    }
  }
  const codec = v?.codec?.toLowerCase() ?? '';
  if (codec === 'av1' || codec === 'hevc') {
    out.push({ kind: 'codec', text: 'This codec is already highly efficient. Re-encoding may still reduce size, but the gain may come with higher encoding time or compatibility tradeoffs.' });
  } else if (codec === 'prores' || codec === 'vp8') {
    out.push({ kind: 'codec', text: `The ${v?.codec} codec is inefficient for distribution. A modern codec will compress far better at similar visual quality.` });
  }
  if (v?.frameRate && v.frameRate >= 55) {
    out.push({ kind: 'general', text: 'High frame rate doubles the frames to encode versus 30 FPS. Lowering it is a large, honest lever when motion allows.' });
  }
  if (out.length === 0) {
    out.push({ kind: 'general', text: 'No dominant inefficiency detected. Size scales with duration and bitrate; compression gains will be gradual.' });
  }
  return out;
}

export interface SizePlanInput {
  targetBytes: number;
  duration: number | null;
  audioBitrate: number | null;
  audioTrackCount: number;
  overheadPct?: number;
}

/** Target-size → bitrate planning math. Displayed, never guaranteed. */
export function planFromTargetSize(input: SizePlanInput): CompressionEstimate {
  const overheadPct = input.overheadPct ?? 0.02;
  const overheadBytes = Math.round(input.targetBytes * overheadPct);
  const audioBytes = input.duration && input.audioBitrate
    ? Math.round(((input.audioBitrate * input.audioTrackCount) * input.duration) / 8)
    : null;
  const videoBytes = audioBytes != null ? Math.max(0, input.targetBytes - audioBytes - overheadBytes) : null;
  const videoBitrate = videoBytes != null && input.duration && input.duration > 0
    ? Math.round((videoBytes * 8) / input.duration)
    : null;
  return {
    targetBytes: input.targetBytes,
    videoBitrate,
    audioBitrate: input.audioBitrate,
    audioBytes,
    overheadBytes,
    reductionPct: null,
    complexity: videoBitrate != null && videoBitrate < 1_000_000 ? 'High' : videoBitrate != null && videoBitrate < 4_000_000 ? 'Medium' : 'Low',
    notes: [
      'Planning estimate only. Final size depends on encoder behavior, content complexity, and container overhead.',
      'Very low target bitrates may visibly degrade quality; prefer resolution reduction first.',
    ],
  };
}

export function estimateForConfig(args: {
  sizeBytes: number;
  duration: number | null;
  config: Pick<OperationConfig, 'videoBitrate' | 'audioBitrate' | 'videoQuality' | 'audioCodec'>;
  audioTrackCount: number;
}): CompressionEstimate {
  const { sizeBytes, duration, config, audioTrackCount } = args;
  const audioBitrate = config.audioCodec === 'none' ? 0 : (config.audioBitrate ?? 128_000);
  const audioBytes = duration ? Math.round(((audioBitrate * audioTrackCount) * duration) / 8) : null;
  const overheadBytes = Math.round(sizeBytes * 0.01);
  let targetBytes: number | null = null;
  if (duration && duration > 0 && config.videoBitrate && audioBytes != null) {
    targetBytes = Math.round(((config.videoBitrate * duration) / 8) + audioBytes + overheadBytes);
  }
  return {
    targetBytes,
    videoBitrate: config.videoBitrate ?? null,
    audioBitrate,
    audioBytes,
    overheadBytes,
    reductionPct: targetBytes != null && sizeBytes > 0 ? ((sizeBytes - targetBytes) / sizeBytes) * 100 : null,
    complexity: 'Medium',
    notes: config.videoBitrate
      ? ['Estimate assumes the encoder sustains the target bitrate. Complex content may overshoot.']
      : ['Quality-mode encoding has no predictable size. The estimate appears after choosing a target bitrate.'],
  };
}

/** True when the config changes nothing that needs re-encoding. */
export function isRemuxOnly(config: Pick<OperationConfig, 'videoCodec' | 'audioCodec' | 'width' | 'frameRate' | 'videoQuality' | 'videoBitrate' | 'audioBitrate' | 'audioChannels' | 'audioSampleRate' | 'start' | 'end'>): boolean {
  return (
    (config.videoCodec === 'copy' || config.videoCodec == null) &&
    (config.audioCodec === 'copy' || config.audioCodec == null) &&
    config.width == null &&
    config.frameRate == null &&
    config.videoQuality == null &&
    config.videoBitrate == null &&
    config.audioBitrate == null &&
    config.audioChannels == null &&
    config.audioSampleRate == null &&
    config.start == null &&
    config.end == null
  );
}

export function tierToQuality(tier: QualityTier): number {
  return QUALITY_TIER_VALUE[tier];
}

export function previewEnd(duration: number | null): number {
  if (duration != null && duration > 0) return Math.min(5, duration);
  return 5;
}

export type PresetId = 'max-compat' | 'balanced' | 'small' | 'archive' | 'mobile';

export interface CapsLike {
  video: string[];
  audio: string[];
}

export interface ResolvedPreset {
  id: PresetId;
  label: string;
  usable: boolean;
  disabledReason: string | null;
  strategy: string;
  changes: string[];
  videoCodec: 'avc' | 'vp9' | 'av1' | 'hevc';
  audioCodec: 'aac' | 'opus' | 'mp3' | 'copy';
  width: number | null;
  tier: QualityTier;
  mode: 'quality' | 'reduction';
  reductionPct: number | null;
  container: 'mp4' | 'webm';
}

export function bestEfficientEncodable(video: string[]): 'av1' | 'hevc' | 'avc' {
  if (video.includes('av1')) return 'av1';
  if (video.includes('hevc')) return 'hevc';
  return 'avc';
}

/**
 * Resolve a preset to its exact encoding strategy on THIS browser.
 * Nothing vague: the codec names the probed encoder, not a superlative.
 */
export function resolvePreset(id: PresetId, caps: CapsLike, meta: MediaMetadata | null): ResolvedPreset {
  const srcW = meta?.primaryVideo?.displayWidth ?? null;
  const srcH = meta?.primaryVideo?.displayHeight ?? null;
  const res = srcW && srcH ? `${srcW}×${srcH}` : 'original resolution';
  const aac = caps.audio.includes('aac');
  const opus = caps.audio.includes('opus');
  const eff = bestEfficientEncodable(caps.video.length > 0 ? caps.video : ['avc']);
  const noneProbed = caps.video.length === 0;

  switch (id) {
    case 'max-compat': {
      const usable = caps.video.includes('avc');
      return {
        id, label: 'Maximum Compatibility', usable,
        disabledReason: usable ? null : 'no H.264 encoder in this browser',
        strategy: 'H.264 video + AAC audio in MP4: plays everywhere, largest output of the presets.',
        changes: ['video → H.264 (re-encode)', `audio → ${aac ? 'AAC 128k (re-encode)' : 'copy (no AAC encoder)'}`, `resolution → keep ${res}`, 'quality → High (0.70)', 'container → MP4'],
        videoCodec: 'avc', audioCodec: aac ? 'aac' : 'copy', width: null, tier: 'high', mode: 'quality', reductionPct: null, container: 'mp4',
      };
    }
    case 'balanced': {
      const vc = caps.video.includes('hevc') ? 'hevc' : 'avc';
      return {
        id, label: 'Balanced', usable: !noneProbed,
        disabledReason: noneProbed ? 'no video encoder reported' : null,
        strategy: `${vc.toUpperCase()} video + AAC audio in MP4: smaller than H.264-only where the encoder exists, still widely compatible.`,
        changes: [`video → ${vc.toUpperCase()} (re-encode)`, `audio → ${aac ? 'AAC 128k (re-encode)' : 'copy (no AAC encoder)'}`, `resolution → keep ${res}`, 'quality → Balanced (0.55)', 'container → MP4'],
        videoCodec: vc, audioCodec: aac ? 'aac' : 'copy', width: null, tier: 'balanced', mode: 'quality', reductionPct: null, container: 'mp4',
      };
    }
    case 'small': {
      const shrink = srcW != null && srcW > 1280;
      return {
        id, label: 'Small File', usable: !noneProbed,
        disabledReason: noneProbed ? 'no video encoder reported' : null,
        strategy: `${eff.toUpperCase()} video at 50% size reduction + ${opus ? 'Opus' : aac ? 'AAC' : 'copied'} audio: smallest output, slowest encode, narrowest compatibility.`,
        changes: [`video → ${eff.toUpperCase()} (re-encode)`, `audio → ${opus ? 'Opus 128k (re-encode)' : aac ? 'AAC 128k (re-encode)' : 'copy'}`, `resolution → ${shrink ? '1280w downscale' : `keep ${res} (already small)`}`, 'rate control → 50% size-reduction target bitrate', 'container → MP4'],
        videoCodec: eff, audioCodec: opus ? 'opus' : aac ? 'aac' : 'copy', width: shrink ? 1280 : null, tier: 'balanced', mode: 'reduction', reductionPct: 50, container: 'mp4',
      };
    }
    case 'archive': {
      return {
        id, label: 'Archive Efficient', usable: !noneProbed,
        disabledReason: noneProbed ? 'no video encoder reported' : null,
        strategy: `${eff.toUpperCase()} video at Very High quality (0.85) with original audio copied: the highest quality-per-byte among this browser's reported encoders, resolution untouched.`,
        changes: [`video → ${eff.toUpperCase()} (re-encode)`, 'audio → copy (untouched)', `resolution → keep ${res} (untouched)`, 'quality → Very High (0.85)', 'container → MP4'],
        videoCodec: eff, audioCodec: 'copy', width: null, tier: 'very-high', mode: 'quality', reductionPct: null, container: 'mp4',
      };
    }
    case 'mobile': {
      const shrink = srcW != null && srcW > 1920;
      const usable = caps.video.includes('avc');
      return {
        id, label: 'Mobile / Sharing', usable,
        disabledReason: usable ? null : 'no H.264 encoder in this browser',
        strategy: `H.264 + AAC capped at 1080p: small enough to share, playable on any phone.`,
        changes: ['video → H.264 (re-encode)', `audio → ${aac ? 'AAC 128k (re-encode)' : 'copy (no AAC encoder)'}`, `resolution → ${shrink ? '1920w downscale' : `keep ${res} (already ≤1080p)`}`, 'quality → Balanced (0.55)', 'container → MP4'],
        videoCodec: 'avc', audioCodec: aac ? 'aac' : 'copy', width: shrink ? 1920 : null, tier: 'balanced', mode: 'quality', reductionPct: null, container: 'mp4',
      };
    }
  }
}

/** Per-track pipeline rows derived from the actual plan. */
export function pipelineRows(args: {
  meta: MediaMetadata;
  videoIndices: number[] | null;
  audioIndices: number[] | null;
  videoTranscodes: boolean;
  audioTranscodes: boolean;
}): Array<{ label: string; action: 'COPY' | 'TRANSCODE' | 'DROP' }> {
  const rows: Array<{ label: string; action: 'COPY' | 'TRANSCODE' | 'DROP' }> = [];
  for (const t of args.meta.videoTracks) {
    const kept = args.videoIndices == null || args.videoIndices.includes(t.index);
    rows.push({ label: `Video ${t.index + 1} (${(t.codec ?? '?').toUpperCase()})`, action: !kept ? 'DROP' : args.videoTranscodes ? 'TRANSCODE' : 'COPY' });
  }
  for (const t of args.meta.audioTracks) {
    const kept = args.audioIndices == null || args.audioIndices.includes(t.index);
    rows.push({ label: `Audio ${t.index + 1} (${(t.codec ?? '?').toUpperCase()})`, action: !kept ? 'DROP' : args.audioTranscodes ? 'TRANSCODE' : 'COPY' });
  }
  return rows;
}
