import type { Input } from 'mediabunny';
import type { AudioTrackMetadata, MediaMetadata, TrackDisposition, VideoTrackMetadata } from '../../types';

const DEFAULT_DISPOSITION: TrackDisposition = {
  default: false, primary: false, forced: false, original: false,
  commentary: false, hearingImpaired: false, visuallyImpaired: false,
};

async function videoMeta(track: import('mediabunny').InputVideoTrack, index: number): Promise<VideoTrackMetadata> {
  const [codec, codedW, codedH, dispW, dispH, rotation, bitrate, avgBitrate, canDecode, name, languageCode, disposition] = await Promise.all([
    track.getCodec().catch(() => null),
    track.getCodedWidth().catch(() => null),
    track.getCodedHeight().catch(() => null),
    track.getDisplayWidth().catch(() => null),
    track.getDisplayHeight().catch(() => null),
    track.getRotation().catch(() => null),
    track.getBitrate().catch(() => null),
    track.getAverageBitrate().catch(() => null),
    track.canDecode().catch(() => false),
    track.getName().catch(() => null),
    track.getLanguageCode().catch(() => 'und'),
    track.getDisposition().catch(() => null),
  ]);
  let frameRate: number | null = null;
  let averageFrameRate: number | null = null;
  try {
    const m = await track.computeFrameRateMetrics();
    frameRate = m.bestGuessFrameRate ?? null;
    averageFrameRate = m.averageFrameRate ?? null;
  } catch { /* N/A */ }
  let colorSpace: string | null = null;
  try {
    const cs = await track.getColorSpace();
    colorSpace = cs ? `${cs.primaries ?? ''}${cs.transfer ? '/' + cs.transfer : ''}${cs.matrix ? '/' + cs.matrix : ''}`.replace(/^\//, '') || 'present' : null;
  } catch { /* N/A */ }
  let codecDescription: string | null = null;
  try {
    const cfg = await track.getDecoderConfig();
    codecDescription = cfg?.description
      ? Array.from(new Uint8Array(cfg.description as ArrayBuffer)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join(' ')
      : (cfg?.codec ?? null);
  } catch { /* N/A */ }
  let packetCount: number | null = null;
  try {
    const stats = await track.computePacketStats(200);
    packetCount = stats.packetCount ?? null;
  } catch { /* N/A */ }

  return {
    index,
    codec: codec ? String(codec) : null,
    codecDescription,
    codedWidth: codedW ?? null,
    codedHeight: codedH ?? null,
    displayWidth: dispW ?? null,
    displayHeight: dispH ?? null,
    rotation: typeof rotation === 'number' ? rotation : null,
    frameRate,
    averageFrameRate,
    bitrate: bitrate ?? null,
    averageBitrate: avgBitrate ?? null,
    colorSpace,
    canDecode,
    packetCount,
    name: name ?? null,
    languageCode: typeof languageCode === 'string' ? languageCode : 'und',
    disposition: disposition ? { ...DEFAULT_DISPOSITION, ...disposition } : null,
  };
}

async function audioMeta(track: import('mediabunny').InputAudioTrack, index: number): Promise<AudioTrackMetadata> {
  const [codec, channels, rate, bitrate, avgBitrate, canDecode, name, languageCode, disposition] = await Promise.all([
    track.getCodec().catch(() => null),
    track.getNumberOfChannels().catch(() => null),
    track.getSampleRate().catch(() => null),
    track.getBitrate().catch(() => null),
    track.getAverageBitrate().catch(() => null),
    track.canDecode().catch(() => false),
    track.getName().catch(() => null),
    track.getLanguageCode().catch(() => 'und'),
    track.getDisposition().catch(() => null),
  ]);
  return {
    index,
    codec: codec ? String(codec) : null,
    channels: channels ?? null,
    sampleRate: rate ?? null,
    bitrate: bitrate ?? null,
    averageBitrate: avgBitrate ?? null,
    canDecode,
    name: name ?? null,
    languageCode: typeof languageCode === 'string' ? languageCode : 'und',
    disposition: disposition ? { ...DEFAULT_DISPOSITION, ...disposition } : null,
  };
}

export async function extractMetadata(input: Input): Promise<MediaMetadata> {
  const [format, videoTracks, audioTracks, mime, duration, tags] = await Promise.all([
    input.getFormat().catch(() => null),
    input.getVideoTracks().catch(() => []),
    input.getAudioTracks().catch(() => []),
    input.getMimeType().catch(() => null),
    input.computeDuration().catch(() => null),
    input.getMetadataTags().catch(() => null),
  ]);
  const videos: VideoTrackMetadata[] = [];
  for (let i = 0; i < videoTracks.length; i++) videos.push(await videoMeta(videoTracks[i], i));
  const audios: AudioTrackMetadata[] = [];
  for (let i = 0; i < audioTracks.length; i++) audios.push(await audioMeta(audioTracks[i], i));
  return {
    container: format ? (format.name ?? format.mimeType ?? 'unknown') : 'unknown',
    mimeType: mime ?? null,
    duration: typeof duration === 'number' && Number.isFinite(duration) ? duration : null,
    videoTracks: videos,
    audioTracks: audios,
    primaryVideo: videos[0] ?? null,
    primaryAudio: audios[0] ?? null,
    title: tags?.title ?? null,
  };
}
