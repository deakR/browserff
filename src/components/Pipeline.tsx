import type { HistoryEntry, ProcessingProgress } from '../types';

const STAGES = ['demux', 'decode', 'transform', 'encode', 'mux', 'done'] as const;

export function Pipeline({ progress, onCancel }: { progress: ProcessingProgress | null; onCancel: () => void }) {
  if (!progress) return null;
  const idx = STAGES.indexOf(progress.stage);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-live="polite">
      <div className="flex items-center justify-between">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">PIPELINE</h3>
        {progress.stage !== 'done' && (
          <button onClick={onCancel} className="rounded border border-red-900 bg-red-950/50 px-2.5 py-1 text-[12px] text-red-200 hover:border-red-700">
            Cancel Processing
          </button>
        )}
      </div>
      <div className="mono mt-2 flex items-center gap-1 text-[10px]">
        {STAGES.filter((s) => s !== 'done').map((s, i) => (
          <span key={s} className="flex items-center gap-1">
            <span className={`rounded px-1.5 py-0.5 ${i < idx ? 'bg-emerald-900 text-emerald-200' : i === idx ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>{s}</span>
            {i < 4 && <span className="text-zinc-600">→</span>}
          </span>
        ))}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-800">
        <div className="h-full bg-sky-500 transition-all" style={{ width: `${Math.round(progress.progress * 100)}%` }} />
      </div>
      <p className="mono mt-1.5 text-[11px] text-zinc-400">
        {(progress.progress * 100).toFixed(1)}% · elapsed {Math.round(progress.elapsedMs)}ms
        {progress.processedSeconds != null ? ` · processed ${progress.processedSeconds.toFixed(1)}s` : ' · processed N/A'}
        {progress.fps != null ? ` · ${progress.fps.toFixed(0)} fps` : ''}
      </p>
    </div>
  );
}

export function Console({ lines, history }: { lines: string[]; history: HistoryEntry[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">PROCESSING CONSOLE</h3>
        <div className="mono mt-2 h-36 overflow-y-auto text-[11px] leading-relaxed text-zinc-300" aria-live="polite">
          {lines.length === 0 && <p className="text-zinc-600">No operations yet. Runs, warnings, and errors appear here.</p>}
          {lines.map((l, i) => <p key={i}>{l}</p>)}
        </div>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">OPERATION HISTORY</h3>
        <ul className="mt-2 max-h-36 space-y-1.5 overflow-y-auto">
          {history.length === 0 && <p className="mono text-[11px] text-zinc-600">Empty.</p>}
          {history.map((h) => (
            <li key={h.id} className="rounded border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
              <p className="mono text-[10px] text-zinc-500">{new Date(h.at).toLocaleTimeString()}</p>
              <p className="text-[12px] text-zinc-200">{h.title}</p>
              <p className="mono text-[11px] text-zinc-500">{h.detail}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
