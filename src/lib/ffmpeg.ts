import type { MuxContainer, OperationConfig, PlannedTrack } from '../types';

export function remuxPreview(inputName: string, tracks: PlannedTrack[], _container: MuxContainer, outputName: string): string {
  const parts = ['ffmpeg', '-i', q(inputName)];
  for (const t of tracks) {
    if (t.kind === 'video') parts.push('-map', `0:v:${t.trackIndex}`);
    else if (t.kind === 'audio') parts.push('-map', `0:a:${t.trackIndex}`);
    else parts.push('-map', `0:s:${t.trackIndex}`);
  }
  parts.push('-c', 'copy', q(outputName));
  return parts.join(' ');
}

export function extractPreview(inputName: string, kind: 'video' | 'audio', trackIndex: number, outputName: string): string {
  const sel = kind === 'video' ? `0:v:${trackIndex}` : `0:a:${trackIndex}`;
  return ['ffmpeg', '-i', q(inputName), '-map', sel, '-c', 'copy', q(outputName)].join(' ');
}

function q(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s;
}

export function ffmpegPreview(inputName: string, cfg: OperationConfig, outputName: string): string {
  const parts = ['ffmpeg', '-i', q(inputName)];
  if (cfg.start != null || cfg.end != null) {
    if (cfg.start != null) parts.push('-ss', String(cfg.start.toFixed(3)));
    if (cfg.end != null && cfg.start != null) parts.push('-t', (cfg.end - cfg.start).toFixed(3));
    else if (cfg.end != null) parts.push('-t', cfg.end.toFixed(3));
  }
  const vf: string[] = [];
  if (cfg.width && cfg.height) vf.push(`scale=${cfg.width}:${cfg.height}`);
  if (cfg.frameRate) vf.push(`fps=${cfg.frameRate}`);
  if (vf.length > 0) parts.push('-vf', q(vf.join(',')));

  const vmap: Record<string, string> = { avc: 'libx264', vp9: 'libvpx-vp9', av1: 'libaom-av1', hevc: 'libx265', copy: 'copy' };
  const amap: Record<string, string> = { aac: 'aac', opus: 'libopus', mp3: 'libmp3lame', copy: 'copy', none: 'none' };
  if (cfg.kind === 'extract-audio' || cfg.audioCodec !== undefined || cfg.kind === 'remove-audio') {
    // handled below
  }
  if (cfg.videoCodec) parts.push('-c:v', vmap[cfg.videoCodec] ?? cfg.videoCodec);
  if (cfg.kind === 'remove-audio') parts.push('-an');
  else if (cfg.kind === 'extract-audio') {
    parts.push('-vn');
    if (cfg.audioCodec && cfg.audioCodec !== 'none') parts.push('-c:a', amap[cfg.audioCodec] ?? cfg.audioCodec);
  } else if (cfg.audioCodec) {
    if (cfg.audioCodec === 'none') parts.push('-an');
    else parts.push('-c:a', amap[cfg.audioCodec] ?? cfg.audioCodec);
  }
  if (cfg.audioBitrate && cfg.audioCodec !== 'none' && cfg.audioCodec !== 'copy') {
    parts.push('-b:a', `${Math.round(cfg.audioBitrate / 1000)}k`);
  }
  if (cfg.videoQuality != null && cfg.videoCodec !== 'copy') {
    parts.push('-crf', String(Math.round((1 - cfg.videoQuality) * 40 + 12)));
  }
  parts.push(q(outputName));
  return parts.join(' ');
}
