import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } from 'mediabunny';

/** Generate a lightweight synthetic sample (no binary committed) via Mediabunny encoding. */
export async function generateSample(): Promise<File> {
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const source = new CanvasSource(canvas, { codec: 'avc', quality: new Quality(0.7) });
  output.addVideoTrack(source);
  await output.start();
  const total = 90; // 3 seconds at 30fps
  for (let i = 0; i < total; i++) {
    const t = i / 30;
    const g = ctx.createLinearGradient(0, 0, 640, 360);
    g.addColorStop(0, `hsl(${(i * 4) % 360} 60% 22%)`);
    g.addColorStop(1, '#0b0e13');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#e6e9ee';
    ctx.font = '28px monospace';
    ctx.fillText(`BrowserFF sample  ${t.toFixed(2)}s`, 40, 180);
    ctx.fillStyle = '#4f8ff7';
    ctx.fillRect(40 + (i / total) * 560, 220, 8, 24);
    await source.add(t, 1 / 30);
  }
  await output.finalize();
  const buf = target.buffer;
  if (!buf) throw new Error('Sample generation produced no output');
  return new File([buf], 'browserff-sample.mp4', { type: 'video/mp4' });
}
