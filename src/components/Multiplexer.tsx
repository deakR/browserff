import { useState } from 'react';
import type { MuxContainer, MuxTrackSelection, PlannedTrack, SourceFileEntry } from '../types';
import { countCues } from '../lib/subtitles';
import { deleteMuxPreset, listMuxPresets, saveMuxPreset, type MuxPreset } from '../lib/presets';
import { formatBytes, formatDuration, uid } from '../lib/format';
import { remuxPreview } from '../lib/ffmpeg';
import { muxFileName } from '../lib/mediabunny/muxer';

export function Multiplexer(props: {
  sources: SourceFileEntry[];
  selections: MuxTrackSelection[];
  container: MuxContainer;
  title: string;
  plan: PlannedTrack[];
  busy: boolean;
  dryRun: string | null;
  onToggle: (key: string) => void;
  onMove: (key: string, dir: -1 | 1) => void;
  onReorder: (keys: string[]) => void;
  onContainer: (c: MuxContainer) => void;
  onTitle: (t: string) => void;
  onSelectTrack: (key: string) => void;
  selectedKey: string | null;
  onPropChange: (key: string, patch: Partial<MuxTrackSelection>) => void;
  onRemoveSource: (id: string) => void;
  onAddFiles: (files: File[]) => void;
  onEnqueue: () => void;
  onDryRun: () => void;
  onApplyMuxPreset: (p: MuxPreset) => void;
}) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const included = props.plan;
  const blocked = included.filter((t) => t.verdict === 'unsupported');
  const canMux = included.length > 0 && blocked.length === 0 && !props.busy;

  const dropReorder = (targetKey: string) => {
    if (!dragKey || dragKey === targetKey) return;
    const keys = props.selections.map((s) => s.key).filter((k) => k !== dragKey);
    const at = keys.indexOf(targetKey);
    keys.splice(at < 0 ? keys.length : at, 0, dragKey);
    props.onReorder(keys);
    setDragKey(null);
  };

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-3">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Sources">
          <div className="flex items-center justify-between">
            <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">SOURCES ({props.sources.length})</h3>
            <label className="cursor-pointer rounded border border-zinc-700 px-2 py-1 text-[12px] hover:border-zinc-500">
              Add files
              <input type="file" multiple accept="video/*,audio/*,.mkv,.mov,.srt,.vtt" className="hidden" onChange={(e) => { if (e.target.files) props.onAddFiles([...e.target.files]); e.target.value = ''; }} />
            </label>
          </div>
          <ul className="mt-2 space-y-1.5">
            {props.sources.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-zinc-200">{s.name}</p>
                  <p className="mono text-[10px] text-zinc-500">{sourceLine(s)} · {formatBytes(s.size)}</p>
                </div>
                <button onClick={() => props.onRemoveSource(s.id)} className="mono ml-2 text-[11px] text-zinc-500 hover:text-red-300" aria-label={`Remove ${s.name}`}>✕</button>
              </li>
            ))}
            {props.sources.length === 0 && <p className="mono py-2 text-[11px] text-zinc-600">No sources. Add media files, SRT/VTT subtitles, or both.</p>}
          </ul>
        </section>

        <section className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Track matrix">
          <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500"><span className="md:hidden">TRACK MATRIX</span><span className="hidden md:inline">TRACK MATRIX — DRAG TO REORDER OUTPUT</span></h3>
          <ul className="mt-2 space-y-2 md:hidden">
            {props.selections.map((s) => {
              const src = props.sources.find((x) => x.id === s.sourceId);
              const t = s.kind === 'video' ? src?.metadata?.videoTracks[s.trackIndex]
                : s.kind === 'audio' ? src?.metadata?.audioTracks[s.trackIndex] : null;
              const planned = props.plan.find((p) => p.key === s.key);
              const verdict = !s.include ? 'dropped'
                : planned?.verdict === 'copy' ? 'COPY'
                : planned?.verdict === 'unsupported' ? 'BLOCKED'
                : '…';
              return (
                <li
                  key={s.key}
                  onClick={() => props.onSelectTrack(s.key)}
                  className={`rounded border border-zinc-800 bg-zinc-950/60 p-2.5 ${props.selectedKey === s.key ? 'border-sky-800' : ''} ${s.include ? '' : 'opacity-45'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-[12px] text-zinc-200" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={s.include} onChange={() => props.onToggle(s.key)} aria-label={`Include ${s.kind} track`} />
                      <span>{s.kind === 'subtitle' ? 'sub' : s.kind} · {src?.name ?? '?'}</span>
                    </label>
                    <span className={`mono text-[11px] ${verdict === 'COPY' ? 'text-emerald-400' : verdict === 'BLOCKED' ? 'text-red-300' : 'text-zinc-600'}`}>{verdict}</span>
                  </div>
                  <p className="mono mt-1 text-[10px] text-zinc-500">{codecOf(s, src, t)} · {s.nameOverride ?? t?.name ?? '—'}</p>
                  <div className="mt-2 flex gap-1">
                    <button className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400" onClick={(e) => { e.stopPropagation(); props.onMove(s.key, -1); }} aria-label="Move up">↑</button>
                    <button className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400" onClick={(e) => { e.stopPropagation(); props.onMove(s.key, 1); }} aria-label="Move down">↓</button>
                  </div>
                </li>
              );
            })}
          </ul>
          <table className="mono mt-2 hidden w-full min-w-[760px] text-[11px] md:table">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="py-1 pr-2 font-normal">✓</th>
                <th className="py-1 pr-2 font-normal">Type</th>
                <th className="py-1 pr-2 font-normal">Source</th>
                <th className="py-1 pr-2 font-normal">Codec</th>
                <th className="py-1 pr-2 font-normal">Lang</th>
                <th className="py-1 pr-2 font-normal">Name</th>
                <th className="py-1 pr-2 font-normal">Def/Frc</th>
                <th className="py-1 pr-2 font-normal">Enabled</th>
                <th className="py-1 pr-2 font-normal">Detail</th>
                <th className="py-1 pr-2 font-normal">Plan</th>
                <th className="py-1 font-normal">Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {props.selections.map((s) => {
                const src = props.sources.find((x) => x.id === s.sourceId);
                const t = s.kind === 'video' ? src?.metadata?.videoTracks[s.trackIndex]
                  : s.kind === 'audio' ? src?.metadata?.audioTracks[s.trackIndex] : null;
                const planned = props.plan.find((p) => p.key === s.key);
                return (
                  <tr
                    key={s.key}
                    draggable
                    onDragStart={() => setDragKey(s.key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropReorder(s.key)}
                    onClick={() => props.onSelectTrack(s.key)}
                    className={`cursor-grab ${props.selectedKey === s.key ? 'bg-sky-950/40' : ''} ${s.include ? '' : 'opacity-45'} ${dragKey === s.key ? 'opacity-30' : ''}`}
                  >
                    <td className="py-1 pr-2">
                      <input type="checkbox" checked={s.include} onChange={() => props.onToggle(s.key)} onClick={(e) => e.stopPropagation()} aria-label={`Include ${s.kind} track`} />
                    </td>
                    <td className="py-1 pr-2 text-zinc-300">{s.kind === 'subtitle' ? 'sub' : s.kind}</td>
                    <td className="max-w-[140px] truncate py-1 pr-2 text-zinc-400">{src?.name ?? '?'}</td>
                    <td className="py-1 pr-2 text-zinc-200">{codecOf(s, src, t)}</td>
                    <td className="py-1 pr-2 text-zinc-400">{s.langOverride ?? t?.languageCode ?? (s.kind === 'subtitle' ? 'und' : '?')}</td>
                    <td className="max-w-[140px] truncate py-1 pr-2 text-zinc-300">{s.nameOverride ?? t?.name ?? '—'}</td>
                    <td className="py-1 pr-2 text-zinc-400">{defFrc(s, t)}</td>
                    <td className="py-1 pr-2 text-zinc-600">N/A</td>
                    <td className="py-1 pr-2 text-zinc-500">{detailOf(s, src, t)}</td>
                    <td className="py-1 pr-2">
                      {!s.include ? <span className="text-zinc-600">dropped</span>
                        : planned?.verdict === 'copy' ? <span className="text-emerald-400">COPY</span>
                        : planned?.verdict === 'unsupported' ? <span className="text-red-300">BLOCKED</span>
                        : <span className="text-zinc-600">…</span>}
                    </td>
                    <td className="py-1">
                      <button className="px-1 text-zinc-500 hover:text-zinc-200" onClick={(e) => { e.stopPropagation(); props.onMove(s.key, -1); }} aria-label="Move up">↑</button>
                      <button className="px-1 text-zinc-500 hover:text-zinc-200" onClick={(e) => { e.stopPropagation(); props.onMove(s.key, 1); }} aria-label="Move down">↓</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mono mt-1 text-[10px] text-zinc-600">Enabled flag and track delay are not exposed by Mediabunny 1.56.2 — shown as N/A, never faked.</p>
        </section>

        <ValidationReport
          plan={included}
          dryRun={props.dryRun}
          container={props.container}
          onContainer={props.onContainer}
          onRemoveTrack={(key) => props.onToggle(key)}
          onConvertSubtitle={(key) => props.onPropChange(key, { convertSubtitle: true })}
        />

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Media plan">
          <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">MEDIA PLAN</h3>
          <ul className="mono mt-1.5 space-y-0.5 text-[11px]">
            {included.map((t) => (
              <li key={t.key} className="flex justify-between gap-2">
                <span className="truncate text-zinc-300">{t.kind} #{t.trackIndex + 1} · {t.sourceName}{(t.codec ? ` · ${t.codec}` : '')}</span>
                <span className={t.verdict === 'copy' ? 'shrink-0 text-emerald-300' : 'shrink-0 text-red-300'}>{t.verdict === 'copy' ? 'COPY' : 'UNAVAILABLE'}</span>
              </li>
            ))}
            {included.length === 0 && <li className="text-zinc-600">no tracks selected</li>}
          </ul>
          <div className="mono mt-2 text-[11px] leading-relaxed text-zinc-300">
            <p><span className="text-zinc-500">container</span> <span className="text-emerald-300">REMUX — no media re-encoding</span></p>
            <p><span className="text-zinc-500">output</span> {muxFileName(props.title || null, props.container)}</p>
            <p><span className="text-zinc-500">expected</span> {blocked.length > 0 ? 'blocked tracks must be resolved first' : 'streams copied in output order with selected metadata'}</p>
          </div>
          <p className="mono mt-2 break-all text-[11px] text-zinc-500">{included.length > 0 ? remuxPreview(props.sources[0]?.name ?? 'input', included, props.container, muxFileName(props.title || null, props.container)) : '—'}</p>
          <p className="mono text-[10px] text-zinc-600">REFERENCE ONLY — BrowserFF remuxes with Mediabunny, not FFmpeg.</p>
          <div className="mt-2 flex gap-2">
            <button onClick={props.onDryRun} disabled={included.length === 0} className="rounded border border-zinc-700 px-3 py-1.5 text-[12px] hover:border-zinc-500 disabled:opacity-40">Validate</button>
            <button onClick={props.onEnqueue} disabled={!canMux} className="rounded bg-red-600 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-red-500 disabled:opacity-40">
              {props.busy ? 'Queued…' : 'Start mux job (Ctrl+Enter)'}
            </button>
          </div>
        </section>
      </div>

      <aside className="space-y-3">
        <MuxPresetBar
          container={props.container}
          title={props.title}
          selections={props.selections}
          onApply={props.onApplyMuxPreset}
        />
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Output settings">
          <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">OUTPUT</h3>
          <label className="mt-2 block text-[12px] text-zinc-400">Container
            <select value={props.container} onChange={(e) => props.onContainer(e.target.value as MuxContainer)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
              <option value="mkv">Matroska (.mkv)</option>
              <option value="mp4">MP4 (.mp4)</option>
              <option value="webm">WebM (.webm)</option>
            </select>
          </label>
          <label className="mt-2 block text-[12px] text-zinc-400">Title
            <input value={props.title} onChange={(e) => props.onTitle(e.target.value)} placeholder="Optional — written to output" className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100" />
          </label>
        </section>
        <TrackProps selection={props.selections.find((s) => s.key === props.selectedKey) ?? null} onChange={props.onPropChange} />
      </aside>
    </div>
  );
}

function sourceLine(s: SourceFileEntry): string {
  if (s.subtitle) {
    let cues = '';
    try { cues = ` · ~${countCues(s.subtitle.format === 'vtt' ? s.subtitle.text : '')} cues`; } catch { /* srt: unknown */ }
    return `${s.subtitle.format.toUpperCase()} subtitles${s.subtitle.format === 'vtt' ? cues : ''}`;
  }
  if (s.metadata) return `${s.metadata.container} · ${s.metadata.videoTracks.length + s.metadata.audioTracks.length} tracks · ${formatDuration(s.metadata.duration)}`;
  return s.loadError ? 'unreadable' : 'parsing…';
}

function codecOf(s: MuxTrackSelection, src: SourceFileEntry | undefined, t: { codec?: string | null } | null | undefined): string {
  if (s.kind === 'subtitle') return (src?.subtitle?.format ?? '?').toUpperCase();
  return (t?.codec ?? 'N/A').toUpperCase();
}

function defFrc(s: MuxTrackSelection, t: { disposition?: { default?: boolean; forced?: boolean } | null } | null | undefined): string {
  const d = s.defaultOverride ?? t?.disposition?.default ?? false;
  const f = s.forcedOverride ?? t?.disposition?.forced ?? false;
  if (!d && !f) return '—';
  return `${d ? 'def' : ''}${d && f ? '/' : ''}${f ? 'frc' : ''}`;
}

function detailOf(s: MuxTrackSelection, src: SourceFileEntry | undefined, t: { displayWidth?: number | null; displayHeight?: number | null; frameRate?: number | null; channels?: number | null; sampleRate?: number | null } | null | undefined): string {
  if (s.kind === 'subtitle') {
    if (!src?.subtitle) return 'N/A';
    if (src.subtitle.format === 'vtt') {
      try { return `~${countCues(src.subtitle.text)} cues`; } catch { return 'WebVTT'; }
    }
    return 'SRT → WebVTT on mux';
  }
  if (!t) return 'N/A';
  if (s.kind === 'video' && 'displayWidth' in t) {
    return `${t.displayWidth ?? '?'}×${t.displayHeight ?? '?'}${t.frameRate ? ` ${t.frameRate.toFixed(1)}fps` : ''}`;
  }
  if ('channels' in t) return `${t.channels ?? '?'}ch ${t.sampleRate ? `${(t.sampleRate / 1000).toFixed(1)}kHz` : ''}`;
  return '';
}

function ValidationReport(props: {
  plan: PlannedTrack[];
  dryRun: string | null;
  container: MuxContainer;
  onContainer: (c: MuxContainer) => void;
  onRemoveTrack: (key: string) => void;
  onConvertSubtitle: (key: string) => void;
}) {
  const blocked = props.plan.filter((t) => t.verdict === 'unsupported');
  const ready = props.plan.length > 0 && blocked.length === 0;
  const others: MuxContainer[] = (['mkv', 'mp4', 'webm'] as MuxContainer[]).filter((c) => c !== props.container);
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Validation">
      <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">VALIDATION</h3>
      {props.plan.length === 0 && <p className="mono mt-1 text-[11px] text-zinc-600">Select tracks to validate.</p>}
      <ul className="mono mt-1.5 space-y-0.5 text-[11px]">
        {props.plan.map((t) => (
          <li key={t.key} className="flex items-start justify-between gap-2">
            <span className="text-zinc-300">
              {t.verdict === 'copy' ? <span className="text-emerald-400">✓ </span> : <span className="text-red-300">⚠ </span>}
              {(t.codec ?? t.kind).toUpperCase()} → {props.container.toUpperCase()}
            </span>
          </li>
        ))}
      </ul>
      {blocked.map((t) => (
        <div key={t.key} role="alert" className="mt-2 rounded border border-red-900 bg-red-950/40 p-2">
          <p className="text-[12px] text-red-200">{t.sourceName} {t.kind} #{t.trackIndex + 1}: {t.verdictReason}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {others.map((c) => (
              <button key={c} onClick={() => props.onContainer(c)} className="mono rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-zinc-500">
                Change to {c.toUpperCase()}
              </button>
            ))}
            <button onClick={() => props.onRemoveTrack(t.key)} className="mono rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-zinc-500">Remove track</button>
            {t.kind === 'subtitle' && (
              <button onClick={() => props.onConvertSubtitle(t.key)} className="mono rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-zinc-500">Convert subtitle (SRT→WebVTT)</button>
            )}
          </div>
        </div>
      ))}
      {ready && <p className="mono mt-1.5 text-[11px] text-emerald-300">READY — all selected streams copy without re-encoding.</p>}
      {props.dryRun && <p className="mono mt-1 text-[11px] text-sky-300">{props.dryRun}</p>}
    </section>
  );
}

function MuxPresetBar(props: {
  container: MuxContainer;
  title: string;
  selections: MuxTrackSelection[];
  onApply: (p: MuxPreset) => void;
}) {
  const [presets, setPresets] = useState<MuxPreset[]>(() => listMuxPresets());
  const [name, setName] = useState('');
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Mux presets">
      <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">MUX PRESETS (CONFIG ONLY)</h3>
      <ul className="mt-1.5 space-y-1">
        {presets.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-1 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1">
            <button onClick={() => props.onApply(p)} className="mono min-w-0 flex-1 truncate text-left text-[11px] text-zinc-200 hover:text-white" title={`${p.container} · ${p.includeVideo ? 'V' : ''}${p.includeAudio ? 'A' : ''}${p.includeSubtitles ? 'S' : ''}`}>
              {p.name}
            </button>
            <button onClick={() => setPresets(deleteMuxPreset(p.id))} className="mono text-[10px] text-zinc-600 hover:text-red-300" aria-label={`Delete preset ${p.name}`}>✕</button>
          </li>
        ))}
        {presets.length === 0 && <li className="mono text-[10px] text-zinc-600">None saved.</li>}
      </ul>
      <div className="mt-1.5 flex gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Preset name" aria-label="Preset name" className="mono min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-[11px] text-zinc-100" />
        <button
          onClick={() => {
            if (!name.trim()) return;
            setPresets(saveMuxPreset({
              id: uid('preset'), name: name.trim(), container: props.container, title: props.title,
              includeVideo: props.selections.some((s) => s.kind === 'video' && s.include),
              includeAudio: props.selections.some((s) => s.kind === 'audio' && s.include),
              includeSubtitles: props.selections.some((s) => s.kind === 'subtitle' && s.include),
              createdAt: Date.now(),
            }));
            setName('');
          }}
          className="mono shrink-0 rounded border border-zinc-700 px-2 py-1 text-[11px] hover:border-zinc-500"
        >
          save
        </button>
      </div>
    </section>
  );
}

export function TrackProps(props: {
  selection: MuxTrackSelection | null;
  onChange: (key: string, patch: Partial<MuxTrackSelection>) => void;
}) {
  const s = props.selection;
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Track properties">
      <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">TRACK PROPERTIES</h3>
      {!s && <p className="mono mt-2 text-[11px] text-zinc-600">Select a track in the matrix.</p>}
      {s && (
        <div className="mt-2 space-y-2 text-[12px] text-zinc-400">
          <p className="mono text-[11px] text-zinc-300">{s.kind} · order {s.order + 1}</p>
          <label className="block">Name override
            <input value={s.nameOverride ?? ''} onChange={(e) => props.onChange(s.key, { nameOverride: e.target.value || null })} placeholder="Keep original" className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100" />
          </label>
          <label className="block">Language override (ISO 639-2, e.g. eng)
            <input value={s.langOverride ?? ''} onChange={(e) => props.onChange(s.key, { langOverride: e.target.value || null })} placeholder="Keep original" className="mono mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100" />
          </label>
          <label className="block">Default flag
            <select value={s.defaultOverride == null ? '' : s.defaultOverride ? 'yes' : 'no'} onChange={(e) => props.onChange(s.key, { defaultOverride: e.target.value === '' ? null : e.target.value === 'yes' })} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
              <option value="">Keep original</option>
              <option value="yes">Default</option>
              <option value="no">Not default</option>
            </select>
          </label>
          <label className="block">Forced flag
            <select value={s.forcedOverride == null ? '' : s.forcedOverride ? 'yes' : 'no'} onChange={(e) => props.onChange(s.key, { forcedOverride: e.target.value === '' ? null : e.target.value === 'yes' })} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
              <option value="">Keep original</option>
              <option value="yes">Forced</option>
              <option value="no">Not forced</option>
            </select>
          </label>
          {s.kind === 'subtitle' && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.convertSubtitle} onChange={(e) => props.onChange(s.key, { convertSubtitle: e.target.checked })} />
              Convert SRT → WebVTT on mux
            </label>
          )}
          <p className="mono text-[10px] text-zinc-600">Enabled flag and track delay are not exposed by the engine — unavailable, never faked. Overrides apply through packet-copy remux.</p>
        </div>
      )}
    </section>
  );
}
