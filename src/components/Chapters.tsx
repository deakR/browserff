import { useState } from 'react';
import type { Chapter } from '../types';
import { chaptersFromXml, chaptersToVtt, chaptersToXml, sortChapters } from '../lib/chapters';
import { saveOutput } from '../lib/folder';
import { formatDuration, outputFileName, uid } from '../lib/format';

/**
 * Chapter editor. Chapters are project-local: the engine exposes no chapter
 * read/write API, so attaching chapters to an output file is unsupported.
 * Export targets MKVToolNix (XML) and WebVTT for real downstream use.
 */
export function ChapterEditor(props: {
  chapters: Chapter[];
  duration: number | null;
  currentTime: number;
  onChange: (c: Chapter[]) => void;
  onSeek: (t: number) => void;
  sourceName: string | null;
}) {
  const [importError, setImportError] = useState<string | null>(null);
  const sorted = sortChapters(props.chapters);

  const add = () => {
    props.onChange([...props.chapters, { id: uid('ch'), start: props.currentTime, title: `Chapter ${props.chapters.length + 1}` }]);
  };

  const importXml = async (f: File) => {
    setImportError(null);
    try {
      const text = await f.text();
      const parsed = chaptersFromXml(text);
      if (parsed.length === 0) {
        setImportError('No chapters found. Expected MKVToolNix chapter XML with ChapterTimeStart entries.');
        return;
      }
      props.onChange([...props.chapters, ...parsed]);
    } catch {
      setImportError('Could not read that file as chapter XML.');
    }
  };

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Chapters">
        <div className="flex items-center justify-between">
          <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">CHAPTERS ({sorted.length})</h3>
          <div className="flex gap-2">
            <button onClick={add} className="rounded border border-zinc-700 px-2.5 py-1 text-[12px] hover:border-zinc-500">Add at playhead</button>
            <label className="cursor-pointer rounded border border-zinc-700 px-2.5 py-1 text-[12px] hover:border-zinc-500">
              Import XML
              <input type="file" accept=".xml" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importXml(f); e.target.value = ''; }} />
            </label>
          </div>
        </div>
        {importError && <p role="alert" className="mt-2 text-[12px] text-red-300">{importError}</p>}
        <ul className="mt-2 space-y-1.5">
          {sorted.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
              <button onClick={() => props.onSeek(c.start)} className="mono shrink-0 text-[11px] text-sky-300 hover:text-sky-200" title="Seek to chapter">
                {formatDuration(c.start)}
              </button>
              <input
                value={c.title}
                onChange={(e) => props.onChange(props.chapters.map((x) => (x.id === c.id ? { ...x, title: e.target.value } : x)))}
                aria-label="Chapter title"
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] text-zinc-200 hover:border-zinc-700 focus:border-sky-600"
              />
              <input
                type="number" step="0.1" min="0" value={c.start}
                onChange={(e) => props.onChange(props.chapters.map((x) => (x.id === c.id ? { ...x, start: Math.max(0, Number(e.target.value)) } : x)))}
                aria-label="Chapter start seconds"
                className="mono w-24 shrink-0 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-zinc-300"
              />
              <button
                onClick={() => {
                  const i = sorted.findIndex((x) => x.id === c.id);
                  if (i <= 0) return;
                  const rest = sorted.filter((x) => x.id !== c.id);
                  const prev = sorted[i - 1];
                  const at = rest.findIndex((x) => x.id === prev.id);
                  const next = [...rest];
                  next.splice(at, 0, c);
                  props.onChange(next.map((x, order) => ({ ...x, order } as Chapter)));
                }}
                className="px-1 text-zinc-500 hover:text-zinc-200" aria-label="Move earlier">↑</button>
              <button onClick={() => props.onChange(props.chapters.filter((x) => x.id !== c.id))} className="px-1 text-zinc-500 hover:text-red-300" aria-label="Delete chapter">✕</button>
            </li>
          ))}
          {sorted.length === 0 && <p className="mono py-2 text-[11px] text-zinc-600">No chapters. Add one at the playhead or import MKVToolNix XML.</p>}
        </ul>
      </section>
      <aside className="space-y-3">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Chapter export">
          <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">EXPORT</h3>
          <div className="mt-2 flex flex-col gap-2">
            <button
              disabled={sorted.length === 0}
              onClick={() => { void saveOutput(new Blob([chaptersToXml(sorted)], { type: 'application/xml' }), outputFileName(props.sourceName ?? 'chapters', 'chapters.xml')); }}
              className="rounded border border-zinc-700 px-3 py-1.5 text-left text-[12px] hover:border-zinc-500 disabled:opacity-40"
            >
              chapters.xml <span className="mono block text-[10px] text-zinc-500">MKVToolNix-compatible · use with mkvmerge --chapters</span>
            </button>
            <button
              disabled={sorted.length === 0}
              onClick={() => { void saveOutput(new Blob([chaptersToVtt(sorted, props.duration)], { type: 'text/vtt' }), outputFileName(props.sourceName ?? 'chapters', 'chapters.vtt')); }}
              className="rounded border border-zinc-700 px-3 py-1.5 text-left text-[12px] hover:border-zinc-500 disabled:opacity-40"
            >
              chapters.vtt <span className="mono block text-[10px] text-zinc-500">WebVTT cue sheet</span>
            </button>
          </div>
        </section>
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Chapter limits">
          <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">LIMITS</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
            Chapters are saved with this file&apos;s project in this browser. Mediabunny 1.56.2
            still cannot embed them in muxed output. Export XML or VTT for external tools.
          </p>
        </section>
      </aside>
    </div>
  );
}
