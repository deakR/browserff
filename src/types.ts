export type VideoCodecId = 'avc' | 'hevc' | 'vp9' | 'av1' | 'vp8' | 'prores' | string;
export type AudioCodecId = 'aac' | 'opus' | 'mp3' | 'vorbis' | 'flac' | 'ac3' | 'eac3' | string;

export interface TrackDisposition {
  default: boolean;
  primary: boolean;
  forced: boolean;
  original: boolean;
  commentary: boolean;
  hearingImpaired: boolean;
  visuallyImpaired: boolean;
}

export interface VideoTrackMetadata {
  index: number;
  codec: string | null;
  codecDescription: string | null;
  codedWidth: number | null;
  codedHeight: number | null;
  displayWidth: number | null;
  displayHeight: number | null;
  rotation: number | null;
  frameRate: number | null;
  averageFrameRate: number | null;
  bitrate: number | null;
  averageBitrate: number | null;
  colorSpace: string | null;
  canDecode: boolean;
  packetCount: number | null;
  name: string | null;
  languageCode: string;
  disposition: TrackDisposition | null;
}

export interface AudioTrackMetadata {
  index: number;
  codec: string | null;
  channels: number | null;
  sampleRate: number | null;
  bitrate: number | null;
  averageBitrate: number | null;
  canDecode: boolean;
  name: string | null;
  languageCode: string;
  disposition: TrackDisposition | null;
}

export interface MediaMetadata {
  container: string;
  mimeType: string | null;
  duration: number | null;
  videoTracks: VideoTrackMetadata[];
  audioTracks: AudioTrackMetadata[];
  primaryVideo: VideoTrackMetadata | null;
  primaryAudio: AudioTrackMetadata | null;
  title: string | null;
}

export interface MediaFile {
  id: string;
  file: File;
  objectUrl: string;
  name: string;
  size: number;
  extension: string;
  metadata: MediaMetadata | null;
  loadError: string | null;
}

export interface SizeBreakdown {
  totalBytes: number;
  duration: number | null;
  videoBytes: number | null;
  audioBytes: number | null;
  otherBytes: number | null;
  videoBitrate: number | null;
  audioBitrate: number | null;
  overallBitrate: number | null;
  explanation: string;
  factors: string[];
}

export interface OptimizationRecommendation {
  id: string;
  category: 'resolution' | 'bitrate' | 'codec' | 'audio' | 'container' | 'fps';
  issue: string;
  explanation: string;
  action: string;
  operationConfig: OperationConfig;
  estimatedNote: string;
}

export type OutputContainer = 'mp4' | 'webm';

export interface OperationConfig {
  kind: 'convert' | 'trim' | 'resize' | 'transcode' | 'extract-audio' | 'remove-audio' | 'clip' | 'frame' | 'contact-sheet' | 'compress';
  container: OutputContainer;
  width?: number;
  height?: number;
  videoCodec?: 'avc' | 'vp9' | 'av1' | 'hevc' | 'copy';
  videoQuality?: number;
  videoBitrate?: number | null;
  frameRate?: number | null;
  audioCodec?: 'aac' | 'opus' | 'mp3' | 'copy' | 'none';
  audioBitrate?: number | null;
  audioChannels?: number | null;
  audioSampleRate?: number | null;
  videoIndices?: number[] | null;
  audioIndices?: number[] | null;
  start?: number;
  end?: number;
  label: string;
}

export interface ProcessingProgress {
  stage: 'demux' | 'decode' | 'transform' | 'encode' | 'mux' | 'done';
  progress: number;
  processedSeconds: number | null;
  elapsedMs: number;
  fps: number | null;
}

export interface ProcessedOutput {
  id: string;
  blob: Blob;
  objectUrl: string;
  size: number;
  container: OutputContainer;
  config: OperationConfig;
  metadata: MediaMetadata | null;
  durationMs: number;
  createdAt: number;
}

export interface MediaCapabilityRow {
  codec: string;
  label: string;
  video: boolean;
  decode: boolean;
  encode: boolean;
}

export interface Marker {
  id: string;
  time: number;
  label: string;
}

export interface HistoryEntry {
  id: string;
  at: number;
  title: string;
  detail: string;
  config: OperationConfig | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  filename: string;
  size: number;
  duration: number | null;
  container: string | null;
  metadata: MediaMetadata | null;
  updatedAt: number;
}

export type MuxContainer = 'mkv' | 'mp4' | 'webm';

export type CompressorMode = 'smart' | 'target-size' | 'reduction' | 'quality' | 'manual';

export type QualityTier = 'low' | 'balanced' | 'high' | 'very-high';

export const QUALITY_TIER_VALUE: Record<QualityTier, number> = {
  low: 0.35,
  balanced: 0.55,
  high: 0.7,
  'very-high': 0.85,
};

export interface CompressionEstimate {
  targetBytes: number | null;
  videoBitrate: number | null;
  audioBitrate: number | null;
  audioBytes: number | null;
  overheadBytes: number;
  reductionPct: number | null;
  complexity: 'Low' | 'Medium' | 'High';
  notes: string[];
}

export interface SourceFileEntry {
  id: string;
  file: File;
  objectUrl: string;
  name: string;
  size: number;
  metadata: MediaMetadata | null;
  loadError: string | null;
  subtitle: { format: 'srt' | 'vtt'; text: string } | null;
}

export interface MuxTrackSelection {
  key: string;
  sourceId: string;
  trackIndex: number;
  kind: 'video' | 'audio' | 'subtitle';
  include: boolean;
  order: number;
  nameOverride: string | null;
  langOverride: string | null;
  defaultOverride: boolean | null;
  forcedOverride: boolean | null;
  convertSubtitle: boolean;
}

export type TrackVerdict = 'copy' | 'unsupported' | 'dropped';

export interface PlannedTrack extends MuxTrackSelection {
  sourceName: string;
  codec: string | null;
  verdict: TrackVerdict;
  verdictReason: string;
}

export interface Chapter {
  id: string;
  start: number;
  title: string;
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type JobKind = 'remux' | 'transcode' | 'extract' | 'contact-sheet' | 'frame' | 'analyze' | 'join';

export interface JobRecord {
  id: string;
  kind: JobKind;
  label: string;
  detail: string;
  status: JobStatus;
  progress: number;
  createdAt: number;
  error: string | null;
  outputSize: number | null;
  outputUrl: string | null;
  outputName: string | null;
}

export type ExtensionState = 'available' | 'loading' | 'loaded' | 'failed';

export interface CodecExtensionInfo {
  id: string;
  label: string;
  pkg: string;
  sizeMB: number;
  codecs: string[];
  kind: 'decoder' | 'encoder' | 'both';
  state: ExtensionState;
  error: string | null;
}
