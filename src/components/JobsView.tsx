import type { JobRecord } from '../types';
import { downloadBlob } from '../lib/mediabunny/exporter';
import { formatBytes } from '../lib/format';

async function downloadJob(job: JobRecord): Promise<void> {
  if (!job.outputUrl || !job.outputName) return;
  const res = await fetch(job.outputUrl);
  const blob = await res.blob();
  downloadBlob(blob, job.outputName);
}

export function JobsView(props: { jobs: JobRecord[]; onCancel: (id: string) => void; onRetry: (id: string) => void; onRemove: (id: string) => void; onDuplicate: (id: string) => void }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Job queue">
      <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">JOB QUEUE ({props.jobs.length})</h3>
      {props.jobs.length === 0 && <p className="mono mt-2 text-[11px] text-zinc-600">Empty. Configure work in Multiplexer, Extract, or Processor.</p>}
      <ul className="mt-2 space-y-1.5">
        {props.jobs.map((j) => (
          <li key={j.id} className="rounded border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[12px] text-zinc-200">{j.label}</p>
                <p className="mono truncate text-[10px] text-zinc-500">{j.detail}</p>
              </div>
              <StatusBadge status={j.status} />
            </div>
            {(j.status === 'running' || j.status === 'pending') && (
              <div className="mt-1.5 h-1 overflow-hidden rounded bg-zinc-800">
                <div className="h-full bg-red-500 transition-all" style={{ width: `${Math.round(j.progress * 100)}%` }} />
              </div>
            )}
            {j.error && <p role="alert" className="mono mt-1 text-[11px] text-red-300">{j.error}</p>}
            {j.status === 'completed' && (
              <p className="mono mt-1 text-[11px] text-emerald-300">
                done{j.outputSize != null ? ` · ${formatBytes(j.outputSize)}` : ''}
              </p>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(j.status === 'running' || j.status === 'pending') && (
                <button onClick={() => props.onCancel(j.id)} className="mono rounded border border-red-900 px-2 py-0.5 text-[11px] text-red-200 hover:border-red-700">cancel</button>
              )}
              {(j.status === 'failed' || j.status === 'cancelled') && (
                <button onClick={() => props.onRetry(j.id)} className="mono rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-zinc-500">retry</button>
              )}
              {j.status === 'completed' && j.outputUrl && (
                <button onClick={() => void downloadJob(j)} className="mono rounded border border-emerald-900 px-2 py-0.5 text-[11px] text-emerald-200 hover:border-emerald-700">download</button>
              )}
              {j.status !== 'running' && (
                <button onClick={() => props.onDuplicate(j.id)} className="mono rounded border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-500 hover:border-zinc-600">duplicate</button>
              )}
              {j.status !== 'running' && (
                <button onClick={() => props.onRemove(j.id)} className="mono rounded border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-500 hover:border-zinc-600">remove</button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mono mt-2 text-[10px] text-zinc-600">Queue metadata persists locally. Media payloads are session-local; after reload, re-queue jobs that still show pending.</p>
    </section>
  );
}

function StatusBadge({ status }: { status: JobRecord['status'] }) {
  const cls: Record<JobRecord['status'], string> = {
    pending: 'border-zinc-700 text-zinc-400',
    running: 'border-sky-800 text-sky-300',
    completed: 'border-emerald-900 text-emerald-300',
    failed: 'border-red-900 text-red-300',
    cancelled: 'border-amber-900 text-amber-300',
  };
  return <span className={`mono shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${cls[status]}`}>{status}</span>;
}
