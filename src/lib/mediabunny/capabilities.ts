import { canDecodeVideo, canDecodeAudio, canEncodeVideo, canEncodeAudio } from 'mediabunny';
import type { MediaCapabilityRow } from '../../types';

const VIDEO = [
  { codec: 'avc', label: 'H.264' },
  { codec: 'hevc', label: 'HEVC' },
  { codec: 'vp9', label: 'VP9' },
  { codec: 'av1', label: 'AV1' },
];

const AUDIO = [
  { codec: 'aac', label: 'AAC' },
  { codec: 'opus', label: 'Opus' },
  { codec: 'mp3', label: 'MP3' },
  { codec: 'vorbis', label: 'Vorbis' },
];

export async function probeCapabilities(): Promise<MediaCapabilityRow[]> {
  const rows: MediaCapabilityRow[] = [];
  for (const v of VIDEO) {
    const [decode, encode] = await Promise.all([
      canDecodeVideo(v.codec as 'avc').catch(() => false),
      canEncodeVideo(v.codec as 'avc').catch(() => false),
    ]);
    rows.push({ codec: v.label, label: v.label, video: true, decode: !!decode, encode: !!encode });
  }
  for (const a of AUDIO) {
    const [decode, encode] = await Promise.all([
      canDecodeAudio(a.codec as 'aac').catch(() => false),
      canEncodeAudio(a.codec as 'aac').catch(() => false),
    ]);
    rows.push({ codec: a.label, label: a.label, video: false, decode: !!decode, encode: !!encode });
  }
  return rows;
}
