import { useMemo, useState } from 'react';
import type { MediaMetadata, OptimizationRecommendation, SourceFileEntry } from '../types';
import { analyzeSize, buildRecommendations } from '../lib/analyzer';
import { compareHashes, sha256Hex } from '../lib/hash';
import { mediaReport } from '../lib/report';
import { downloadBlob } from '../lib/mediabunny/exporter';
import { formatBitrate, formatBytes, formatDuration } from '../lib/format';

export function Analyzer(props: { size: number; meta: MediaMetadata }) {
  const breakdown = useMemo(() => analyzeSize(props.size, props.meta), [props.size, props.meta]);
  const total = breakdown.totalBytes || 1;
  const vp = breakdown.videoBytes != null ? (breakdown.videoBytes / total) * 100 : 0;
  const ap = breakdown.audioBytes != null ? (breakdown.audioBytes / total) * 100 : 0;
  const op = breakdown.otherBytes != null ? Math.max(0, 100 - vp - ap) : 0;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">WHY IS THIS FILE SO LARGE?</h3>
      <div className="mono mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
        <div>Total <span className="text-zinc-100">{formatBytes(breakdown.totalBytes)}</span></div>
        <div>Duration <span className="text-zinc-100">{formatDuration(breakdown.duration)}</span></div>
        <div>Video <span className="text-zinc-100">{formatBitrate(breakdown.videoBitrate)}</span></div>
        <div>Audio <span className="text-zinc-100">{formatBitrate(breakdown.audioBitrate)}</span></div>
        <div className="col-span-2">Overall <span className="text-zinc-100">{formatBitrate(breakdown.overallBitrate)}</span></div>
      </div>
      <div className="mt-3 space-y-1.5" aria-label="Size breakdown">
        <Bar label="Video" pct={vp} cls="bg-sky-500" val={breakdown.videoBytes} />
        <Bar label="Audio" pct={ap} cls="bg-emerald-500" val={breakdown.audioBytes} />
        <Bar label="Other" pct={op} cls="bg-zinc-600" val={breakdown.otherBytes} />
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-zinc-300">{breakdown.explanation}</p>
    </div>
  );
}

function Bar({ label, pct, cls, val }: { label: string; pct: number; cls: string; val: number | null }) {
  return (
    <div>
      <div className="mono flex justify-between text-[10px] text-zinc-500">
        <span>{label}</span>
        <span>{val != null ? `${formatBytes(val)} · ${pct.toFixed(1)}%` : 'N/A'}</span>
      </div>
      <div className="mt-0.5 h-2 overflow-hidden rounded bg-zinc-800">
        <div className={`h-full ${cls}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}

export function MediaReportPanel(props: { source: SourceFileEntry; onQueue?: () => void }) {
  const { source } = props;
  const [copied, setCopied] = useState(false);
  const report = useMemo(
    () => (source.metadata ? mediaReport(source.name, source.size, source.metadata) : null),
    [source.name, source.size, source.metadata],
  );
  if (!report) return null;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-center justify-between">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">ANALYZE MEDIA — REPORT</h3>
        <div className="flex gap-1.5">
          <button
            onClick={() => { navigator.clipboard?.writeText(report).then(() => setCopied(true)).catch(() => undefined); setTimeout(() => setCopied(false), 1500); }}
            className="mono rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-zinc-500"
          >
            {copied ? 'copied ✓' : 'copy'}
          </button>
          <button
            onClick={() => downloadBlob(new Blob([report], { type: 'text/markdown' }), 'media-report.md')}
            className="mono rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-zinc-500"
          >
            .md
          </button>
          {props.onQueue && (
            <button
              onClick={props.onQueue}
              className="mono rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-zinc-500"
            >
              queue job
            </button>
          )}
        </div>
      </div>
      <pre className="mono mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-300">{report}</pre>
    </div>
  );
}

export function TrackContrib(props: { meta: MediaMetadata; size: number; onOpenMux: () => void; onOpenCompressor: () => void }) {
  const { meta } = props;
  const dur = meta.duration;
  const rows: Array<{ label: string; bytes: number | null }> = [];
  for (const t of meta.videoTracks) {
    const br = t.bitrate ?? t.averageBitrate;
    rows.push({ label: `Video ${t.index + 1} (${(t.codec ?? '?').toUpperCase()})`, bytes: br && dur ? (br * dur) / 8 : null });
  }
  for (const t of meta.audioTracks) {
    const br = t.bitrate ?? t.averageBitrate;
    rows.push({ label: `Audio ${t.index + 1} (${(t.codec ?? '?').toUpperCase()})`, bytes: br && dur ? (br * dur) / 8 : null });
  }
  const known = rows.reduce((s, r) => s + (r.bytes ?? 0), 0);
  const other = Math.max(0, props.size - known);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">TRACK-LEVEL SIZE (FROM BITRATES)</h3>
      <ul className="mono mt-1.5 space-y-0.5 text-[11px]">
        {rows.map((r) => (
          <li key={r.label} className="flex justify-between gap-2">
            <span className="text-zinc-300">{r.label}</span>
            <span className="text-zinc-400">{r.bytes != null ? `~${formatBytes(r.bytes)}` : 'N/A'}</span>
          </li>
        ))}
        <li className="flex justify-between gap-2"><span className="text-zinc-500">Container / overhead / subtitles</span><span className="text-zinc-400">~{formatBytes(other)}</span></li>
      </ul>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button onClick={props.onOpenMux} className="mono rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:border-zinc-500">Remove tracks in Multiplexer</button>
        <button onClick={props.onOpenCompressor} className="mono rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:border-zinc-500">Re-encode in Compressor</button>
      </div>
    </div>
  );
}

export function IntegrityPanel(props: { source: SourceFileEntry }) {
  const [fileB, setFileB] = useState<File | null>(null);
  const [hashA, setHashA] = useState<string | null>(null);
  const [hashB, setHashB] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verdict = compareHashes(hashA, hashB);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const [a, b] = await Promise.all([
        sha256Hex(props.source.file),
        fileB ? sha256Hex(fileB) : Promise.resolve(null),
      ]);
      setHashA(a);
      setHashB(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hashing failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">FILE INTEGRITY (SHA-256)</h3>
      <p className="mono mt-1 truncate text-[11px] text-zinc-400">A: {props.source.name}</p>
      <label className="mono mt-1 block text-[11px] text-zinc-400">B (optional compare):
        <input type="file" onChange={(e) => setFileB(e.target.files?.[0] ?? null)} className="mono mt-1 block w-full text-[11px] text-zinc-300" />
      </label>
      <button onClick={() => void run()} disabled={busy} className="mono mt-2 rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-200 hover:border-zinc-500 disabled:opacity-50">
        {busy ? 'hashing…' : 'Compute hash'}
      </button>
      {error && <p role="alert" className="mono mt-1 text-[11px] text-red-300">{error}</p>}
      {hashA && <p className="mono mt-1 break-all text-[10px] text-zinc-500">A {hashA}</p>}
      {hashB && <p className="mono mt-1 break-all text-[10px] text-zinc-500">B {hashB}</p>}
      {verdict !== 'PENDING' && (
        <p className={`mono mt-1 text-[12px] ${verdict === 'IDENTICAL' ? 'text-emerald-300' : 'text-red-300'}`}>
          {verdict} — {verdict === 'IDENTICAL' ? 'hashes match' : 'hashes differ'}. Hash equality proves identical bytes, not media equivalence.
        </p>
      )}
    </div>
  );
}

export function Recommendations(props: { meta: MediaMetadata; size: number; onApply: (r: OptimizationRecommendation) => void }) {
  const recs = useMemo(() => buildRecommendations(props.meta, props.size), [props.meta, props.size]);
  if (recs.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">OPTIMIZATION</h3>
        <p className="mt-2 text-[12px] text-zinc-400">No specific issues detected. This file looks reasonably encoded for its characteristics.</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">OPTIMIZATION ENGINE</h3>
      <ul className="mt-2 space-y-2">
        {recs.map((r) => (
          <li key={r.id} className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5">
            <p className="text-[12px] font-medium text-zinc-100">{r.issue}</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-400">{r.explanation}</p>
            <p className="mono mt-1 text-[11px] text-zinc-500">{r.estimatedNote}</p>
            <button
              className="mt-2 rounded-md border border-sky-800 bg-sky-950/50 px-2.5 py-1 text-[12px] text-sky-200 hover:border-sky-600"
              onClick={() => props.onApply(r)}
            >
              Apply: {r.action}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
