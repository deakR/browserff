import type { SourceFileEntry } from '../types';

/**
 * Header editor. Container title is written via a single-file remux (Conversion tags).
 * Track name/language/default/forced overrides apply through the Multiplexer packet-copy path.
 * In-place editing is not possible browser-side; a new output file is always created.
 */
export function HeaderEditor(props: {
  source: SourceFileEntry | null;
  title: string;
  onTitle: (t: string) => void;
  onApplyTitle: () => void;
  busy: boolean;
}) {
  const meta = props.source?.metadata;
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Container header">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">CONTAINER HEADER</h3>
        {!props.source && <p className="mono mt-2 text-[11px] text-zinc-600">Open a file first.</p>}
        {props.source && (
          <>
            <div className="mono mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <div className="text-zinc-500">FILE <p className="truncate text-zinc-200">{props.source.name}</p></div>
              <div className="text-zinc-500">CONTAINER <p className="text-zinc-200">{meta?.container ?? 'parsing…'}</p></div>
              <div className="text-zinc-500">CURRENT TITLE <p className="text-zinc-200">{meta?.title ?? '—'}</p></div>
              <div className="text-zinc-500">TRACKS <p className="text-zinc-200">{meta ? meta.videoTracks.length + meta.audioTracks.length : '…'}</p></div>
            </div>
            <label className="mt-3 block text-[12px] text-zinc-400">New container title
              <input value={props.title} onChange={(e) => props.onTitle(e.target.value)} placeholder="e.g. My Movie (2026)" className="mt-1 w-full max-w-md rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100" />
            </label>
            <div className="mt-2 flex gap-2">
              <button onClick={props.onApplyTitle} disabled={props.busy || !props.title.trim()} className="rounded bg-red-600 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-red-500 disabled:opacity-40">
                Apply via remux
              </button>
              <button onClick={() => props.onTitle('')} className="rounded border border-zinc-700 px-3 py-1.5 text-[12px] hover:border-zinc-500">Reset</button>
            </div>
          </>
        )}
      </section>
      <aside className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Header editing notes">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">HOW THIS WORKS</h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[12px] leading-relaxed text-zinc-400">
          <li>Title changes create a <span className="text-emerald-300">new file</span>; streams are copied, never re-encoded.</li>
          <li>In-place header editing is not possible with the browser engine.</li>
          <li>Track name, language, default and forced flags are edited in the Multiplexer track properties panel.</li>
          <li>Attachment (font/cover) read/write is not exposed by Mediabunny 1.56.2 and stays unavailable.</li>
        </ul>
      </aside>
    </div>
  );
}
