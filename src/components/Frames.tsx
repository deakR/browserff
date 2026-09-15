import { useState } from 'react';
import { openInput } from '../lib/mediabunny/reader';
import { grabCanvas, canvasToBlob, trackAt } from '../lib/mediabunny/frames';
import { downloadBlob } from '../lib/mediabunny/exporter';
import { formatDuration } from '../lib/format';

export function FrameInspector({ file, time }: { file: File; time: number }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ts, setTs] = useState<number | null>(null);

  const inspect = async () => {
    setBusy(true);
    setErr(null);
    try {
      const input = await openInput(file);
      try {
        const track = await trackAt(input);
        if (!track) throw new Error('No video track in this file.');
        const got = await grabCanvas(track, time, 640);
        if (!got) throw new Error('No decodable frame at this timestamp.');
        setTs(got.timestamp);
        if (url) URL.revokeObjectURL(url);
        const blob = await canvasToBlob(got.canvas, 'image/png');
        setUrl(URL.createObjectURL(blob));
      } finally {
        input.dispose();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Frame extraction failed');
    } finally {
      setBusy(false);
    }
  };

  const exportFrame = async () => {
    if (!url) return;
    const res = await fetch(url);
    const blob = await res.blob();
    downloadBlob(blob, `frame-${time.toFixed(3)}s.png`);
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">FRAME INSPECTOR</h3>
      <p className="mono mt-1 text-[11px] text-zinc-400">playhead <span className="text-zinc-100">{formatDuration(time)}</span>{ts != null && <> · decoded <span className="text-zinc-100">{formatDuration(ts)}</span></>}</p>
      <div className="mt-2 flex gap-2">
        <button onClick={inspect} disabled={busy} className="rounded border border-zinc-700 px-2.5 py-1 text-[12px] hover:border-zinc-500 disabled:opacity-50">
          {busy ? 'Decoding…' : 'Inspect frame'}
        </button>
        {url && <button onClick={exportFrame} className="rounded border border-zinc-700 px-2.5 py-1 text-[12px] hover:border-zinc-500">Export Frame</button>}
        {url && <button onClick={() => navigator.clipboard?.writeText(formatDuration(time)).catch(() => undefined)} className="rounded border border-zinc-700 px-2.5 py-1 text-[12px] hover:border-zinc-500">Copy Timestamp</button>}
      </div>
      {err && <p role="alert" className="mt-2 text-[12px] text-red-300">{err}</p>}
      {url && <img src={url} alt={`Decoded frame at ${formatDuration(time)}`} className="mt-2 w-full rounded border border-zinc-800" />}
    </div>
  );
}

export function ContactSheet({ file, duration }: { file: File; duration: number | null }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [count, setCount] = useState(6);
  const [cols, setCols] = useState(3);
  const [err, setErr] = useState<string | null>(null);

  const generate = async () => {
    if (!duration || duration <= 0) { setErr('Duration unavailable; contact sheet needs timestamps.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const input = await openInput(file);
      try {
        const track = await trackAt(input);
        if (!track) throw new Error('No video track in this file.');
        const times = Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count);
        const thumbs: HTMLCanvasElement[] = [];
        for (const t of times) {
          const got = await grabCanvas(track, t, 320);
          if (got) thumbs.push(got.canvas);
        }
        if (thumbs.length === 0) throw new Error('No frames could be decoded.');
        const tw = 320;
        const th = Math.round((320 * 9) / 16);
        const rows = Math.ceil(thumbs.length / cols);
        const sheet = document.createElement('canvas');
        sheet.width = cols * tw;
        sheet.height = rows * th;
        const ctx = sheet.getContext('2d');
        if (!ctx) throw new Error('Canvas unavailable');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, sheet.width, sheet.height);
        thumbs.forEach((c, i) => ctx.drawImage(c, (i % cols) * tw, Math.floor(i / cols) * th, tw, th));
        const blob = await canvasToBlob(sheet, 'image/jpeg', 0.85);
        if (url) URL.revokeObjectURL(url);
        setUrl(URL.createObjectURL(blob));
      } finally {
        input.dispose();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Contact sheet failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">CONTACT SHEET</h3>
      <div className="mono mt-2 flex items-center gap-3 text-[11px] text-zinc-400">
        <label>samples <input type="number" min={2} max={12} value={count} onChange={(e) => setCount(Number(e.target.value))} className="ml-1 w-14 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-zinc-100" /></label>
        <label>columns <input type="number" min={1} max={4} value={cols} onChange={(e) => setCols(Number(e.target.value))} className="ml-1 w-14 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-zinc-100" /></label>
        <button onClick={generate} disabled={busy} className="rounded border border-zinc-700 px-2.5 py-1 text-[12px] text-zinc-200 hover:border-zinc-500 disabled:opacity-50">
          {busy ? 'Rendering…' : 'Generate'}
        </button>
      </div>
      {err && <p role="alert" className="mt-2 text-[12px] text-red-300">{err}</p>}
      {url && (
        <div className="mt-2">
          <img src={url} alt="Contact sheet of representative frames" className="w-full rounded border border-zinc-800" />
          <a href={url} download="contact-sheet.jpg" className="mt-2 inline-block rounded border border-zinc-700 px-2.5 py-1 text-[12px] hover:border-zinc-500">Export sheet</a>
        </div>
      )}
    </div>
  );
}
