import type { MediaMetadata, SizeBreakdown, OptimizationRecommendation } from '../types';
import { uid } from './format';

function pickBitrate(t: { bitrate: number | null; averageBitrate: number | null }): number | null {
  return t.bitrate ?? t.averageBitrate ?? null;
}

export function analyzeSize(sizeBytes: number, meta: MediaMetadata): SizeBreakdown {
  const duration = meta.duration;
  const vb = meta.primaryVideo ? pickBitrate(meta.primaryVideo) : null;
  const ab = meta.primaryAudio ? pickBitrate(meta.primaryAudio) : null;
  const overall = duration && duration > 0 ? (sizeBytes * 8) / duration : null;

  let videoBytes: number | null = null;
  let audioBytes: number | null = null;
  if (duration && duration > 0) {
    if (vb) videoBytes = (vb * duration) / 8;
    if (ab) audioBytes = (ab * duration) / 8;
  }
  let otherBytes: number | null = null;
  if (videoBytes != null || audioBytes != null) {
    otherBytes = Math.max(0, sizeBytes - (videoBytes ?? 0) - (audioBytes ?? 0));
  }

  const factors: string[] = [];
  const v = meta.primaryVideo;
  if (v?.displayWidth && v.displayHeight) {
    const px = v.displayWidth * v.displayHeight;
    if (px >= 3840 * 2160) factors.push('4K resolution');
    else if (px >= 2560 * 1440) factors.push('QHD resolution');
    else if (px >= 1920 * 1080) factors.push('1080p resolution');
  }
  if (v?.frameRate && v.frameRate >= 55) factors.push('high frame rate (60 FPS class)');
  else if (v?.frameRate && v.frameRate >= 45) factors.push('elevated frame rate (50 FPS class)');
  if (vb && vb >= 15_000_000) factors.push('very high video bitrate');
  else if (vb && vb >= 8_000_000) factors.push('high video bitrate');
  if (v?.codec && ['hevc', 'av1', 'prores'].includes(v.codec.toLowerCase())) factors.push(`${v.codec.toUpperCase()} codec characteristics`);
  if (ab && overall && ab / overall > 0.2 && (ab ?? 0) > 192_000) factors.push('proportionally large audio track');
  if (duration && duration > 3600) factors.push('long duration');

  let explanation: string;
  if (factors.length === 0) {
    explanation = overall
      ? `Average total bitrate is ${(overall / 1_000_000).toFixed(2)} Mbps. No single dominant factor stands out; size scales with duration and bitrate.`
      : 'Duration or bitrate metadata is unavailable, so size drivers cannot be quantified from this file.';
  } else if (factors.length === 1) {
    explanation = `This file is relatively large for its duration primarily because of ${factors[0]}.`;
  } else {
    const last = factors[factors.length - 1];
    explanation = `This file is relatively large for its duration because it combines ${factors.slice(0, -1).join(', ')} and ${last}.`;
  }

  return {
    totalBytes: sizeBytes,
    duration,
    videoBytes,
    audioBytes,
    otherBytes,
    videoBitrate: vb,
    audioBitrate: ab,
    overallBitrate: overall,
    explanation,
    factors,
  };
}

export function buildRecommendations(meta: MediaMetadata, sizeBytes: number): OptimizationRecommendation[] {
  const out: OptimizationRecommendation[] = [];
  const v = meta.primaryVideo;
  const a = meta.primaryAudio;
  const vb = v ? pickBitrate(v) : null;
  const ab = a ? pickBitrate(a) : null;

  if (v?.displayWidth && v.displayHeight && v.displayWidth >= 3000) {
    out.push({
      id: uid('rec'),
      category: 'resolution',
      issue: `High resolution (${v.displayWidth}×${v.displayHeight})`,
      explanation: 'Pixel count drives decode cost and bitrate demand. Downscaling is the largest single lever for smaller output.',
      action: 'Downscale to 1920×1080',
      operationConfig: {
        kind: 'resize', container: 'mp4', width: 1920, height: 1080,
        videoCodec: 'avc', videoQuality: 0.7, audioCodec: 'aac', label: 'Resize 1080p',
      },
      estimatedNote: 'Estimated reduction: large, scales with pixel ratio once re-encoded.',
    });
  }

  if (vb && v?.displayWidth && v.displayHeight) {
    const px = v.displayWidth * v.displayHeight;
    const perMpx = vb / (px / 1_000_000);
    if (perMpx > 3_500_000) {
      out.push({
        id: uid('rec'),
        category: 'bitrate',
        issue: 'Video bitrate is high relative to resolution',
        explanation: `Current video bitrate implies high bits-per-megapixel. Re-encoding at a moderate quality setting usually preserves visual quality at a lower rate.`,
        action: 'Re-encode with moderate quality',
        operationConfig: {
          kind: 'transcode', container: 'mp4', videoCodec: 'avc', videoQuality: 0.65,
          audioCodec: 'copy', label: 'Re-encode moderate',
        },
        estimatedNote: 'Estimated reduction: moderate; measured after encode.',
      });
    }
  }

  const codec = v?.codec?.toLowerCase() ?? '';
  if (codec === 'prores' || codec === 'vp8') {
    out.push({
      id: uid('rec'),
      category: 'codec',
      issue: `Codec ${v?.codec} is inefficient for distribution`,
      explanation: 'Mezzanine or legacy codecs produce large files. H.264 in MP4 is broadly compatible.',
      action: 'Convert to H.264 / MP4',
      operationConfig: {
        kind: 'convert', container: 'mp4', videoCodec: 'avc', videoQuality: 0.7,
        audioCodec: 'aac', label: 'Convert H.264 MP4',
      },
      estimatedNote: 'Estimated reduction: large for mezzanine sources.',
    });
  } else if (codec === 'hevc' && sizeBytes > 200 * 1024 * 1024) {
    out.push({
      id: uid('rec'),
      category: 'codec',
      issue: 'HEVC file is still large',
      explanation: 'HEVC is efficient, but at this size a constrained re-encode or downscale still helps for sharing.',
      action: 'Re-encode HEVC at moderate quality',
      operationConfig: {
        kind: 'transcode', container: 'mp4', videoCodec: 'avc', videoQuality: 0.65,
        audioCodec: 'copy', label: 'HEVC → H.264',
      },
      estimatedNote: 'Estimated reduction: moderate.',
    });
  }

  if (ab && ab > 256_000) {
    out.push({
      id: uid('rec'),
      category: 'audio',
      issue: 'Audio bitrate is unusually high',
      explanation: 'Stereo distribution rarely benefits beyond ~128–192 kbps AAC. High audio rates add megabytes on long files.',
      action: 'Re-encode audio to 128 kbps AAC',
      operationConfig: {
        kind: 'transcode', container: 'mp4', videoCodec: 'copy', audioCodec: 'aac',
        audioBitrate: 128_000, label: 'Audio 128k AAC',
      },
      estimatedNote: 'Estimated reduction: proportional to audio share.',
    });
  }

  if (v?.frameRate && v.frameRate >= 55) {
    out.push({
      id: uid('rec'),
      category: 'fps',
      issue: 'High frame rate increases encode cost',
      explanation: '60 FPS doubles frames versus 30 FPS. If motion does not require it, 30 FPS cuts size substantially.',
      action: 'Convert to 30 FPS',
      operationConfig: {
        kind: 'transcode', container: 'mp4', videoCodec: 'avc', videoQuality: 0.7,
        frameRate: 30, audioCodec: 'copy', label: 'To 30 FPS',
      },
      estimatedNote: 'Estimated reduction: moderate to large for high-motion content.',
    });
  }

  const container = meta.container.toLowerCase();
  if (container.includes('matroska') || container.includes('mov') || container.includes('quicktime')) {
    out.push({
      id: uid('rec'),
      category: 'container',
      issue: `Container (${meta.container}) is less web-friendly`,
      explanation: 'Remuxing to MP4 or WebM improves browser playback compatibility without necessarily re-encoding.',
      action: 'Remux to MP4',
      operationConfig: {
        kind: 'convert', container: 'mp4', videoCodec: 'copy', audioCodec: 'copy', label: 'Remux MP4',
      },
      estimatedNote: 'Estimated reduction: small; mainly compatibility.',
    });
  }

  return out;
}
