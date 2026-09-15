import { CanvasSink, VideoSampleSink } from 'mediabunny';
import type { InputVideoTrack } from 'mediabunny';

export async function trackAt(input: import('mediabunny').Input): Promise<InputVideoTrack | null> {
  try {
    const t = await input.getPrimaryVideoTrack();
    return t ?? null;
  } catch {
    return null;
  }
}

export async function grabCanvas(
  videoTrack: InputVideoTrack,
  timestamp: number,
  width = 640,
): Promise<{ canvas: HTMLCanvasElement; timestamp: number } | null> {
  const sink = new CanvasSink(videoTrack, { width, fit: 'contain', poolSize: 1 });
  const frame = await sink.getCanvas(timestamp);
  if (!frame) return null;
  const out = document.createElement('canvas');
  out.width = frame.canvas.width;
  out.height = frame.canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(frame.canvas, 0, 0);
  return { canvas: out, timestamp: frame.timestamp };
}

export async function grabVideoFrame(
  videoTrack: InputVideoTrack,
  timestamp: number,
): Promise<{ frame: VideoFrame; timestamp: number; duration: number } | null> {
  const sink = new VideoSampleSink(videoTrack);
  const sample = await sink.getSample(timestamp);
  if (!sample) return null;
  const vf = sample.toVideoFrame();
  const ts = sample.timestamp;
  const dur = sample.duration;
  sample.close();
  return { frame: vf, timestamp: ts, duration: dur };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Frame encode failed'))), type, quality);
  });
}

const thumbCache = new Map<string, string>();

export async function cachedThumbnail(
  videoTrack: InputVideoTrack,
  fileId: string,
  timestamp: number,
  width = 160,
): Promise<string | null> {
  const key = `${fileId}@${timestamp.toFixed(1)}@${width}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const got = await grabCanvas(videoTrack, timestamp, width);
  if (!got) return null;
  const url = got.canvas.toDataURL('image/jpeg', 0.7);
  thumbCache.set(key, url);
  if (thumbCache.size > 120) {
    const first = thumbCache.keys().next().value;
    if (first) thumbCache.delete(first);
  }
  return url;
}

export function clearThumbCache(): void {
  thumbCache.clear();
}
