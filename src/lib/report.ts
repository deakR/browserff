import type { MediaMetadata } from '../types';
import { formatBitrate, formatBytes, formatDuration } from './format';

/** Human-readable media report. Every observation comes from measured metadata. */
export function mediaReport(name: string, size: number, meta: MediaMetadata): string {
  const lines: string[] = [];
  lines.push(`# Media report — ${name}`, '');
  lines.push(`This is a ${formatDuration(meta.duration)} ${meta.container} file (${formatBytes(size)}).`, '');
  const v = meta.primaryVideo;
  if (v) {
    lines.push('Video:');
    lines.push(`${(v.codec ?? 'unknown').toUpperCase()} ${v.displayWidth ?? '?'}×${v.displayHeight ?? '?'} ${(v.frameRate ?? 0).toFixed(0)} FPS ${formatBitrate(v.bitrate ?? v.averageBitrate)}${v.name ? ` "${v.name}"` : ''} [${v.languageCode}]`);
    lines.push('');
  } else {
    lines.push('Video: none', '');
  }
  for (const t of meta.audioTracks) {
    lines.push(`Audio ${t.index + 1}:`);
    lines.push(`${(t.codec ?? 'unknown').toUpperCase()} ${t.channels ?? '?'} channels ${t.sampleRate ?? '?'} Hz ${formatBitrate(t.bitrate ?? t.averageBitrate)}${t.name ? ` "${t.name}"` : ''} [${t.languageCode}]`);
  }
  if (meta.audioTracks.length > 0) lines.push('');
  if (meta.title) lines.push(`Title: ${meta.title}`, '');
  lines.push('Observations:');
  const obs = observations(meta, size);
  for (const o of obs) lines.push(`- ${o}`);
  return lines.join('\n');
}

export function observations(meta: MediaMetadata, sizeBytes: number): string[] {
  const out: string[] = [];
  const v = meta.primaryVideo;
  const codec = v?.codec?.toLowerCase() ?? '';
  if (codec === 'av1' || codec === 'hevc') {
    out.push('Video already uses an efficient codec; re-encoding may provide limited gains.');
  } else if (codec === 'prores' || codec === 'vp8' || codec === '') {
    out.push('Video codec is inefficient or unknown for distribution; transcoding would compress far better.');
  }
  if (meta.audioTracks.length > 1) {
    out.push(`Multiple audio tracks (${meta.audioTracks.length}); removing unwanted ones via remux saves size without re-encoding.`);
  }
  const vb = v ? (v.bitrate ?? v.averageBitrate) : null;
  if (vb && meta.duration && meta.duration > 0 && sizeBytes > 0) {
    const share = (((vb * meta.duration) / 8) / sizeBytes) * 100;
    if (share > 85 && share <= 100) out.push(`Video accounts for roughly ${share.toFixed(0)}% of the file; video settings dominate any size work.`);
  }
  if (v?.displayWidth && v.displayWidth >= 3000) {
    out.push('4K resolution; downscaling is the largest single size lever.');
  }
  if (!v?.canDecode && v) {
    out.push('The browser reports no decoder for the video track; load a codec extension or use a compatible file.');
  }
  if (out.length === 0) out.push('No dominant inefficiency detected.');
  return out;
}
