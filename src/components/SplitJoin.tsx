import { useEffect, useMemo, useState } from 'react';
import { canEncodeAudio, canEncodeVideo } from 'mediabunny';
import type { Chapter, OperationConfig, QualityTier, SourceFileEntry } from '../types';
import { QUALITY_TIER_VALUE } from '../types';
import {
  joinCompatibility, joinFileName, describeJoinConfig, segmentsFromSize,
  segmentsFromTimestamps, segmentFileName, snapToKeyframes, type JoinConfig, type SplitSegment,
} from '../lib/mediabunny/splitjoin';
import { formatBytes, formatDuration, uid } from '../lib/format';
import { ffmpegPreview } from '../lib/ffmpeg';

export interface SplitPlan {
  configs: OperationConfig[];
  names: string[];
}

export function SplitJoin(props: {
  sources: SourceFileEntry[];
  chapters: Chapter[];
  log: (s: string) => void;
  onSplit: (file: File, plan: SplitPlan) => void;
  onJoin: (files: File[], cfg: JoinConfig) => void;
}) {
  const [tab, setTab] = useState<'split' | 'join'>('split');
  return (
    <div className="space-y-3">
      <div className="flex gap-1" role="tablist" aria-label="Split and join">
        {(['split', 'join'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`mono rounded px-3 py-1 text-[11px] ${tab === t ? 'bg-red-600/20 text-red-100' : 'text-zinc-500 hover:text-zinc-200'}`}>
            {t === 'split' ? 'Splitter' : 'Append / Join'}
          </button>
        ))}
      </div>
      {tab === 'split'
        ? <Splitter sources={props.sources} chapters={props.chapters} log={props.log} onSplit={props.onSplit} />
        : <Joiner sources={props.sources} log={props.log} onJoin={props.onJoin} />}
    </div>
  );
}

function useEncodable() {
  const [caps, setCaps] = useState<{ video: string[]; audio: string[] }>({ video: [], audio: [] });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const v: string[] = [];
      const a: string[] = [];
      for (const c of ['avc', 'hevc', 'vp9', 'av1'] as const) {
        if (await canEncodeVideo(c).catch(() => false)) v.push(c);
      }
      for (const c of ['aac', 'opus'] as const) {
        if (await canEncodeAudio(c).catch(() => false)) a.push(c);
      }
      setCaps({ video: v, audio: a });
      setLoading(false);
    })();
  }, []);
  return { caps, loading };
}

function Splitter(props: { sources: SourceFileEntry[]; chapters: Chapter[]; log: (s: string) => void; onSplit: (file: File, plan: SplitPlan) => void }) {
  const withDur = props.sources.filter((s) => (s.metadata?.duration ?? 0) > 0 && !s.subtitle);
  const [sourceId, setSourceId] = useState<string>(withDur[0]?.id ?? '');
  const [mode, setMode] = useState<'timestamps' | 'size' | 'parts' | 'chapters'>('timestamps');
  const [pointsText, setPointsText] = useState('60, 120');
  const [partMB, setPartMB] = useState(700);
  const [parts, setParts] = useState<Array<{ id: string; start: number; end: number }>>([]);
  const [copy, setCopy] = useState(true);
  const [container, setContainer] = useState<'mp4' | 'webm'>('mp4');
  const [snapped, setSnapped] = useState<number[] | null>(null);
  const [snapping, setSnapping] = useState(false);

  const src = withDur.find((s) => s.id === sourceId) ?? withDur[0] ?? null;
  const dur = src?.metadata?.duration ?? 0;

  const rawPoints = useMemo(() => {
    if (mode === 'chapters') return props.chapters.map((c) => c.start).filter((t) => t > 0 && t < dur);
    if (mode !== 'timestamps') return [];
    return pointsText.split(/[,;\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0 && n < dur);
  }, [mode, pointsText, props.chapters, dur]);

  const segments: SplitSegment[] = useMemo(() => {
    if (!dur) return [];
    if (mode === 'size') return segmentsFromSize(src?.size ?? 0, dur, partMB * 1024 * 1024);
    if (mode === 'parts') {
      return parts
        .filter((p) => p.end > p.start && p.start < dur)
        .map((p) => ({ start: Math.max(0, p.start), end: Math.min(dur, p.end) }));
    }
    return segmentsFromTimestamps(dur, snapped ?? rawPoints);
  }, [dur, mode, src?.size, partMB, parts, snapped, rawPoints]);

  const overall = dur > 0 ? (src ? (src.size * 8) / dur : null) : null;

  const doSnap = async () => {
    if (!src || rawPoints.length === 0) return;
    setSnapping(true);
    try {
      const s = await snapToKeyframes(src.file, rawPoints);
      setSnapped(s);
      props.log(`split points snapped to keyframes: ${s.map((t) => t.toFixed(2)).join(', ')}`);
    } finally {
      setSnapping(false);
    }
  };

  const enqueue = () => {
    if (!src || segments.length === 0) return;
    const ext = container;
    const v = src.metadata?.primaryVideo;
    const cfgs: OperationConfig[] = segments.map((seg) => ({
      kind: 'trim', container,
      videoCodec: copy ? 'copy' : ((v?.codec === 'hevc' ? 'hevc' : 'avc') as OperationConfig['videoCodec']),
      videoQuality: 0.7, audioCodec: 'copy',
      start: seg.start, end: seg.end,
      label: `Split ${src.name} ${formatDuration(seg.start)}→${formatDuration(seg.end)}`,
    }));
    const names = segments.map((_, i) => segmentFileName(src.name, i, segments.length, ext));
    props.onSplit(src.file, { configs: cfgs, names });
    props.log(`queued ${cfgs.length} split segments (${copy ? 'stream copy, keyframe-aligned' : 'exact re-encode'})`);
  };

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-3">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Split source">
          <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">SPLIT SOURCE</h3>
          {withDur.length === 0 && <p className="mono mt-2 text-[11px] text-zinc-600">Open a media file first.</p>}
          <div className="mt-2 grid max-w-2xl grid-cols-2 gap-2 md:grid-cols-4">
            <label className="text-[12px] text-zinc-400">File
              <select value={src?.id ?? ''} onChange={(e) => { setSourceId(e.target.value); setSnapped(null); }} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
                {withDur.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="text-[12px] text-zinc-400">Mode
              <select value={mode} onChange={(e) => { setMode(e.target.value as typeof mode); setSnapped(null); }} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
                <option value="timestamps">Timestamps</option>
                <option value="size">By size</option>
                <option value="parts">Keep parts</option>
                <option value="chapters">Chapters ({props.chapters.length})</option>
              </select>
            </label>
            <label className="text-[12px] text-zinc-400">Container
              <select value={container} onChange={(e) => setContainer(e.target.value as 'mp4' | 'webm')} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
                <option value="mp4">MP4</option>
                <option value="webm">WebM</option>
              </select>
            </label>
            <div className="flex items-end pb-1">
              <label className="mono flex items-center gap-1.5 text-[11px] text-zinc-300">
                <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /> stream copy
              </label>
            </div>
          </div>
          {mode === 'timestamps' && (
            <div className="mt-2 flex max-w-2xl flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 text-[12px] text-zinc-400">Cut points (seconds, comma-separated)
                <input value={pointsText} onChange={(e) => { setPointsText(e.target.value); setSnapped(null); }} className="mono mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100" />
              </label>
              <button onClick={() => void doSnap()} disabled={snapping || rawPoints.length === 0} className="mono rounded border border-zinc-700 px-2.5 py-1.5 text-[11px] hover:border-zinc-500 disabled:opacity-40">
                {snapping ? 'snapping…' : 'snap to keyframes'}
              </button>
            </div>
          )}
          {mode === 'size' && (
            <label className="mt-2 block max-w-xs text-[12px] text-zinc-400">Part size (MB — planning ruler is overall bitrate)
              <input type="number" min={10} value={partMB} onChange={(e) => setPartMB(Number(e.target.value))} className="mono mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100" />
            </label>
          )}
          {mode === 'parts' && (
            <PartsEditor parts={parts} onChange={setParts} duration={dur} />
          )}
          {!copy && <p className="mt-2 text-[12px] text-amber-300">Exact cut: every segment is re-encoded. Slower, frame-accurate.</p>}
          {copy && <p className="mono mt-2 text-[11px] text-zinc-500">Stream copy: cuts expand to keyframes (snap first for exact boundaries). No re-encoding.</p>}
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Segments">
          <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">SEGMENTS ({segments.length})</h3>
          <ul className="mono mt-1.5 max-h-56 space-y-0.5 overflow-y-auto text-[11px]">
            {segments.map((s, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="text-zinc-300">{String(i + 1).padStart(2, '0')} · {formatDuration(s.start)} → {formatDuration(s.end)} ({(s.end - s.start).toFixed(1)}s)</span>
                <span className="text-zinc-500">{overall ? `~${formatBytes(((s.end - s.start) * overall) / 8)}` : ''} · {segmentFileName(src?.name ?? 'out', i, segments.length, container)}</span>
              </li>
            ))}
            {segments.length === 0 && <li className="text-zinc-600">No segments. Add cut points, parts, or chapters.</li>}
          </ul>
          {src && segments.length > 0 && (
            <>
              <p className="mono mt-2 break-all text-[11px] text-zinc-500">{ffmpegPreview(src.name, { kind: 'trim', container, start: segments[0].start, end: segments[0].end, label: '' }, segmentFileName(src.name, 0, segments.length, container))}</p>
              <p className="mono text-[10px] text-zinc-600">REFERENCE ONLY — segments processed with Mediabunny, not FFmpeg.</p>
            </>
          )}
          <button onClick={enqueue} disabled={!src || segments.length === 0} className="mt-2 rounded bg-red-600 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-red-500 disabled:opacity-40">
            Queue {segments.length} segment job{segments.length === 1 ? '' : 's'}
          </button>
        </section>
      </div>
      <aside className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Splitter notes">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">HOW SPLITTING WORKS</h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[12px] leading-relaxed text-zinc-400">
          <li>Each segment is an independent job in the queue with real progress.</li>
          <li>Stream copy never re-encodes but starts segments on keyframes.</li>
          <li>By-size splitting uses overall bitrate as a ruler — part sizes are approximate.</li>
          <li>Chapter mode turns your chapter list into cut points.</li>
        </ul>
      </aside>
    </div>
  );
}

function PartsEditor(props: { parts: Array<{ id: string; start: number; end: number }>; duration: number; onChange: (p: Array<{ id: string; start: number; end: number }>) => void }) {
  return (
    <div className="mt-2 max-w-2xl">
      <div className="mb-1.5 flex gap-2">
        <button onClick={() => props.onChange([...props.parts, { id: uid('part'), start: 0, end: Math.min(60, props.duration) }])} className="mono rounded border border-zinc-700 px-2 py-1 text-[11px] hover:border-zinc-500">+ keep range</button>
      </div>
      <ul className="space-y-1.5">
        {props.parts.map((p) => (
          <li key={p.id} className="mono flex items-center gap-2 text-[11px]">
            <input type="number" min={0} step={0.1} value={p.start} aria-label="Range start seconds" onChange={(e) => props.onChange(props.parts.map((x) => (x.id === p.id ? { ...x, start: Number(e.target.value) } : x)))} className="w-24 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-zinc-100" />
            <span className="text-zinc-500">→</span>
            <input type="number" min={0} step={0.1} value={p.end} aria-label="Range end seconds" onChange={(e) => props.onChange(props.parts.map((x) => (x.id === p.id ? { ...x, end: Number(e.target.value) } : x)))} className="w-24 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-zinc-100" />
            <span className="text-zinc-500">{formatDuration(p.start)} → {formatDuration(p.end)}</span>
            <button onClick={() => props.onChange(props.parts.filter((x) => x.id !== p.id))} className="text-zinc-500 hover:text-red-300" aria-label="Remove range">✕</button>
          </li>
        ))}
        {props.parts.length === 0 && <li className="mono text-[11px] text-zinc-600">No ranges. Only kept ranges become outputs.</li>}
      </ul>
    </div>
  );
}

function Joiner(props: { sources: SourceFileEntry[]; log: (s: string) => void; onJoin: (files: File[], cfg: JoinConfig) => void }) {
  const media = props.sources.filter((s) => s.metadata && !s.subtitle);
  const [ids, setIds] = useState<string[]>(media.slice(0, 2).map((s) => s.id));
  const [videoCodec, setVideoCodec] = useState<JoinConfig['videoCodec']>('avc');
  const [tier, setTier] = useState<QualityTier>('high');
  const [width, setWidth] = useState<number | null>(1280);
  const [audioCodec, setAudioCodec] = useState<JoinConfig['audioCodec']>('aac');
  const [audioKbps, setAudioKbps] = useState(128);
  const [container, setContainer] = useState<JoinConfig['container']>('mp4');
  const { caps, loading } = useEncodable();

  const picked = ids.map((id) => media.find((s) => s.id === id)).filter((s) => s != null);
  const compat = useMemo(
    () => joinCompatibility(picked.map((s) => ({ name: s.name, meta: s.metadata }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids.join(','), media.length],
  );

  const move = (id: string, dir: -1 | 1) => {
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    setIds(next);
  };

  const cfg: JoinConfig = {
    container, videoCodec, videoQuality: QUALITY_TIER_VALUE[tier],
    width, audioCodec, audioBitrate: audioKbps * 1000,
    label: `Join ${picked.length} files`,
  };

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-3">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Join order">
          <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">JOIN ORDER (SEQUENTIAL)</h3>
          <ul className="mt-2 space-y-1.5">
            {picked.map((s, i) => (
              <li key={s.id} className="mono flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5 text-[11px]">
                <span className="text-zinc-500">{String(i + 1).padStart(2, '0')}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-200">{s.name}</span>
                <span className="shrink-0 text-zinc-500">{formatDuration(s.metadata?.duration)} · {formatBytes(s.size)}</span>
                <button onClick={() => move(s.id, -1)} className="px-1 text-zinc-500 hover:text-zinc-200" aria-label="Move earlier">↑</button>
                <button onClick={() => move(s.id, 1)} className="px-1 text-zinc-500 hover:text-zinc-200" aria-label="Move later">↓</button>
                <button onClick={() => setIds(ids.filter((x) => x !== s.id))} className="px-1 text-zinc-500 hover:text-red-300" aria-label="Remove from join">✕</button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {media.filter((s) => !ids.includes(s.id)).map((s) => (
              <button key={s.id} onClick={() => setIds([...ids, s.id])} className="mono max-w-[220px] truncate rounded border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-600">+ {s.name}</button>
            ))}
          </div>
          {picked.length < 2 && <p className="mono mt-2 text-[11px] text-amber-300">Pick at least two files to join.</p>}
        </section>

        <section className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Join compatibility">
          <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">SOURCE CHECK (INFORMATIONAL — JOIN ALWAYS RE-ENCODES)</h3>
          <table className="mono mt-1.5 w-full text-[11px]">
            <thead><tr className="text-left text-zinc-500">
              <th className="py-1 pr-2 font-normal">File</th><th className="py-1 pr-2 font-normal">Video</th>
              <th className="py-1 pr-2 font-normal">Audio</th><th className="py-1 font-normal">Duration</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-800/60">
              {compat.map((c) => (
                <tr key={c.name}>
                  <td className="max-w-[200px] truncate py-1 pr-2 text-zinc-200">{c.name}</td>
                  <td className="py-1 pr-2 text-zinc-400">{c.video}</td>
                  <td className="py-1 pr-2 text-zinc-400">{c.audio}</td>
                  <td className="py-1 text-zinc-400">{c.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Join encoding">
          <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">JOIN ENCODING {loading ? '(checking encoders…)' : ''}</h3>
          <div className="mt-2 grid max-w-2xl grid-cols-2 gap-2 md:grid-cols-3">
            <label className="text-[12px] text-zinc-400">Video codec
              <select value={videoCodec} onChange={(e) => setVideoCodec(e.target.value as JoinConfig['videoCodec'])} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
                {(['avc', 'hevc', 'vp9', 'av1'] as const).map((c) => (
                  <option key={c} value={c} disabled={!caps.video.includes(c)}>{c.toUpperCase()}{caps.video.includes(c) ? '' : ' (no encoder)'}</option>
                ))}
              </select>
            </label>
            <label className="text-[12px] text-zinc-400">Quality
              <select value={tier} onChange={(e) => setTier(e.target.value as QualityTier)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
                <option value="balanced">Balanced</option><option value="high">High</option><option value="very-high">Very High</option>
              </select>
            </label>
            <label className="text-[12px] text-zinc-400">Width (blank = 1280)
              <input value={width ?? ''} onChange={(e) => setWidth(e.target.value === '' ? null : Number(e.target.value))} inputMode="numeric" className="mono mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100" />
            </label>
            <label className="text-[12px] text-zinc-400">Audio codec
              <select value={audioCodec} onChange={(e) => setAudioCodec(e.target.value as JoinConfig['audioCodec'])} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
                {(['aac', 'opus'] as const).map((c) => (
                  <option key={c} value={c} disabled={!caps.audio.includes(c)}>{c.toUpperCase()}{caps.audio.includes(c) ? '' : ' (no encoder)'}</option>
                ))}
              </select>
            </label>
            <label className="text-[12px] text-zinc-400">Audio kbps
              <input type="number" value={audioKbps} onChange={(e) => setAudioKbps(Number(e.target.value))} className="mono mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100" />
            </label>
            <label className="text-[12px] text-zinc-400">Container
              <select value={container} onChange={(e) => setContainer(e.target.value as JoinConfig['container'])} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
                <option value="mp4">MP4</option><option value="mkv">Matroska</option><option value="webm">WebM</option>
              </select>
            </label>
          </div>
          <p className="mono mt-2 break-all text-[11px] text-zinc-500">
            {picked.length >= 2
              ? `ffmpeg ${picked.map((s) => `-i "${s.name}"`).join(' ')} -filter_complex "${picked.map((_, i) => `[${i}:v][${i}:a]`).join('')}concat=n=${picked.length}:v=1:a=1" "${joinFileName(picked[0].name, container)}"`
              : '—'}
          </p>
          <p className="mono text-[10px] text-zinc-600">REFERENCE ONLY — BrowserFF joins by decoding and re-encoding sample streams with Mediabunny.</p>
          <button
            onClick={() => { props.onJoin(picked.map((s) => s.file), cfg); props.log(`queued join of ${picked.length} files (${describeJoinConfig(cfg)})`); }}
            disabled={picked.length < 2}
            className="mt-2 rounded bg-red-600 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-red-500 disabled:opacity-40"
          >
            Queue join job
          </button>
        </section>
      </div>
      <aside className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Join notes">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">WHY RE-ENCODE?</h3>
        <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">
          Packet timestamps are immutable in this engine, so same-codec stream
          concatenation is impossible. Join decodes every file and re-encodes one
          continuous timeline — canvas-timestamped video plus sequentially placed
          audio. Matching source codecs only reduce generational loss.
        </p>
      </aside>
    </div>
  );
}
