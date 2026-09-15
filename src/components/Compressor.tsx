import { useEffect, useMemo, useState } from 'react';
import { canEncodeAudio, canEncodeVideo } from 'mediabunny';
import type {
  CodecExtensionInfo, CompressorMode, JobRecord, MediaMetadata, OperationConfig,
  QualityTier, SourceFileEntry,
} from '../types';
import { QUALITY_TIER_VALUE } from '../types';
import { estimateForConfig, isRemuxOnly, pipelineRows, planFromTargetSize, resolvePreset, smartAnalysis, type PresetId } from '../lib/compress';
import { transcodeContainers } from '../lib/codecs';
import { ffmpegPreview } from '../lib/ffmpeg';
import { deleteCompressPreset, listCompressPresets, saveCompressPreset } from '../lib/presets';
import { formatBitrate, formatBytes, formatDuration, formatFps, formatHz, uid } from '../lib/format';
import { openInput } from '../lib/mediabunny/reader';
import { extractMetadata } from '../lib/mediabunny/metadata';
import { jobQueue } from '../lib/jobs';

interface Caps {
  video: string[];
  audio: string[];
}

async function probeEncodable(): Promise<Caps> {
  const v: string[] = [];
  const a: string[] = [];
  for (const c of ['avc', 'hevc', 'vp9', 'av1'] as const) {
    if (await canEncodeVideo(c).catch(() => false)) v.push(c);
  }
  for (const c of ['aac', 'opus', 'mp3'] as const) {
    if (await canEncodeAudio(c).catch(() => false)) a.push(c);
  }
  return { video: v, audio: a };
}

function bestEfficient(v: string[]): string {
  if (v.includes('av1')) return 'av1';
  if (v.includes('hevc')) return 'hevc';
  return 'avc';
}

export function Compressor(props: {
  source: SourceFileEntry;
  extensions: CodecExtensionInfo[];
  onEnqueue: (config: OperationConfig) => void;
  onGotoMultiplexer: () => void;
  log: (s: string) => void;
}) {
  const { source } = props;
  const meta = source.metadata;
  const [mode, setMode] = useState<CompressorMode>('smart');
  const [caps, setCaps] = useState<Caps>({ video: [], audio: [] });
  const [capsLoading, setCapsLoading] = useState(true);
  const [videoCodec, setVideoCodec] = useState<'avc' | 'vp9' | 'av1' | 'hevc' | 'copy'>('avc');
  const [audioCodec, setAudioCodec] = useState<'aac' | 'opus' | 'mp3' | 'copy' | 'none'>('aac');
  const [width, setWidth] = useState<number | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [tier, setTier] = useState<QualityTier>('high');
  const [videoBitrate, setVideoBitrate] = useState<number | null>(null);
  const [audioBitrate, setAudioBitrate] = useState<number>(128_000);
  const [channels, setChannels] = useState<number | null>(null);
  const [sampleRate, setSampleRate] = useState<number | null>(null);
  const [container, setContainer] = useState<'mp4' | 'webm'>('mp4');
  const [targetMB, setTargetMB] = useState(700);
  const [reductionPct, setReductionPct] = useState(50);
  const [keepRes, setKeepRes] = useState(false);
  const [keepFps, setKeepFps] = useState(true);
  const [keepAudio, setKeepAudio] = useState(false);
  const [videoSel, setVideoSel] = useState<number[] | null>(null);
  const [audioSel, setAudioSel] = useState<number[] | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [myJobs, setMyJobs] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [measured, setMeasured] = useState<{ jobId: string; meta: MediaMetadata; size: number; ms: number } | null>(null);
  const [view, setView] = useState<'original' | 'compressed' | 'side'>('compressed');

  useEffect(() => {
    setCapsLoading(true);
    probeEncodable().then(setCaps).catch(() => setCaps({ video: [], audio: [] })).finally(() => setCapsLoading(false));
  }, [props.extensions]);
  useEffect(() => jobQueue.subscribe(setJobs), []);

  const v = meta?.primaryVideo ?? null;
  const a = meta?.primaryAudio ?? null;
  const srcCodec = v?.codec ?? null;

  const advice = useMemo(() => (meta ? smartAnalysis(meta, source.size) : []), [meta, source.size]);

  // Effective knobs after keep-flags
  const effWidth = keepRes ? null : width;
  const effFps = keepFps ? null : fps;
  const effAudioCodec = keepAudio ? 'copy' as const : audioCodec;

  // Mode-derived rate control
  let effVideoBitrate: number | null = null;
  let effTier: QualityTier | null = null;
  let sizePlan: ReturnType<typeof planFromTargetSize> | null = null;
  if (mode === 'target-size' && meta?.duration) {
    sizePlan = planFromTargetSize({ targetBytes: targetMB * 1024 * 1024, duration: meta.duration, audioBitrate: effAudioCodec === 'none' ? 0 : audioBitrate, audioTrackCount: keptAudio(meta, audioSel).length || 1 });
    effVideoBitrate = sizePlan.videoBitrate;
  } else if (mode === 'reduction') {
    const target = Math.round(source.size * (1 - reductionPct / 100));
    if (meta?.duration) {
      sizePlan = planFromTargetSize({ targetBytes: target, duration: meta.duration, audioBitrate: effAudioCodec === 'none' ? 0 : audioBitrate, audioTrackCount: keptAudio(meta, audioSel).length || 1 });
      effVideoBitrate = sizePlan.videoBitrate;
    }
  } else if (mode === 'smart') {
    effVideoBitrate = smartBitrate(meta, source.size);
  } else if (mode === 'quality') {
    effTier = tier;
  } else {
    effVideoBitrate = videoBitrate;
    effTier = videoBitrate == null ? tier : null;
  }

  const config: OperationConfig = {
    kind: 'compress',
    container,
    width: effWidth ?? undefined,
    videoCodec,
    videoQuality: effTier ? QUALITY_TIER_VALUE[effTier] : 0.7,
    videoBitrate: effVideoBitrate,
    frameRate: effFps ?? undefined,
    audioCodec: effAudioCodec,
    audioBitrate: effAudioCodec === 'copy' || effAudioCodec === 'none' ? null : audioBitrate,
    audioChannels: channels,
    audioSampleRate: sampleRate,
    videoIndices: videoSel,
    audioIndices: audioSel,
    label: `Compress ${source.name}`,
  };

  const estimate = useMemo(() => estimateForConfig({
    sizeBytes: source.size,
    duration: meta?.duration ?? null,
    config,
    audioTrackCount: meta ? keptAudio(meta, audioSel).length : 0,
  }), [source.size, meta, config, audioSel]);

  const validContainers = useMemo(() => {
    const vc = videoCodec === 'copy' ? srcCodec : videoCodec;
    const ac = effAudioCodec === 'copy' ? (a?.codec ?? null) : effAudioCodec;
    return transcodeContainers(vc, ac).filter((c) => c === 'mp4' || c === 'webm');
  }, [videoCodec, effAudioCodec, srcCodec, a?.codec]);

  useEffect(() => {
    if (!validContainers.includes(container) && validContainers.length > 0) {
      setContainer(validContainers[0] as 'mp4' | 'webm');
    }
  }, [validContainers, container]);

  const remuxOnly = isRemuxOnly(config);
  const videoTranscodes = videoCodec !== 'copy' || effWidth != null || effFps != null;
  const audioTranscodes = effAudioCodec !== 'copy' && effAudioCodec !== 'none' && (audioBitrate != null || channels != null || sampleRate != null);
  const rows = meta ? pipelineRows({ meta, videoIndices: videoSel, audioIndices: audioSel, videoTranscodes, audioTranscodes }) : [];
  const dropped = rows.filter((r) => r.action === 'DROP');

  const presets = useMemo(() => (['max-compat', 'balanced', 'small', 'archive', 'mobile'] as PresetId[]).map((id) => resolvePreset(id, caps, meta)), [caps, meta]);

  const applyPreset = (id: PresetId) => {
    const p = resolvePreset(id, caps, meta);
    if (!p.usable) return;
    setVideoCodec(p.videoCodec);
    setAudioCodec(p.audioCodec);
    setWidth(p.width);
    setKeepRes(p.width == null);
    setTier(p.tier);
    setVideoBitrate(null);
    if (p.mode === 'reduction' && p.reductionPct != null) setReductionPct(p.reductionPct);
    setMode(p.mode);
    setContainer(p.container);
    props.log(`compressor preset applied: ${p.label} (${p.videoCodec.toUpperCase()}/${p.audioCodec.toUpperCase()})`);
  };

  const enqueue = () => {
    if (remuxOnly) return;
    if (!validContainers.includes(container)) return;
    props.onEnqueue(config);
    props.log(`queued compression (${mode}, ${videoCodec}/${effAudioCodec}, ${container})`);
  };

  const applySavedConfig = (c: OperationConfig) => {
    if (c.videoCodec) setVideoCodec(c.videoCodec);
    if (c.audioCodec) setAudioCodec(c.audioCodec);
    setWidth(c.width ?? null);
    setFps(c.frameRate ?? null);
    if (c.videoQuality != null) { setTier(closestTier(c.videoQuality)); setVideoBitrate(null); }
    if (c.videoBitrate != null) setVideoBitrate(c.videoBitrate);
    if (c.audioBitrate != null) setAudioBitrate(c.audioBitrate);
    setChannels(c.audioChannels ?? null);
    setSampleRate(c.audioSampleRate ?? null);
    if (c.container === 'mp4' || c.container === 'webm') setContainer(c.container);
    setKeepRes(c.width == null);
    setKeepFps(c.frameRate == null);
    setKeepAudio(c.audioCodec === 'copy');
    setMode('manual');
    props.log(`compression preset applied: ${c.label}`);
  };

  const enqueueBenchmark = () => {
    const eff = bestEfficient(caps.video.length > 0 ? caps.video : ['avc']);
    const au = caps.audio.includes('aac') ? 'aac' : 'copy';
    const variants: Array<{ name: string; cfg: Partial<OperationConfig> }> = [
      { name: 'A · 1080p balanced', cfg: { videoCodec: 'avc', videoQuality: 0.55, width: 1920, audioCodec: au } },
      { name: `B · 1080p ${eff}`, cfg: { videoCodec: eff as OperationConfig['videoCodec'], videoQuality: 0.6, width: 1920, audioCodec: au } },
      { name: 'C · 720p small', cfg: { videoCodec: eff as OperationConfig['videoCodec'], videoQuality: 0.55, width: 1280, audioCodec: au } },
    ];
    const ids = new Set(myJobs);
    for (const variant of variants) {
      const c: OperationConfig = { ...config, ...variant.cfg, kind: 'compress', label: `Benchmark ${variant.name} — ${source.name}` };
      const job = jobQueue.enqueue('transcode', c.label, 'benchmark variant', { file: source.file, config: c, label: c.label });
      ids.add(job.id);
    }
    setMyJobs(ids);
    props.log('queued 3-variant compression benchmark; values populate from real encodes only');
  };

  // Measured results for our jobs
  useEffect(() => {
    const done = jobs.find((j) => myJobs.has(j.id) && j.status === 'completed' && j.outputUrl && (!measured || measured.jobId !== j.id));
    if (!done?.outputUrl || !done.outputSize) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(done.outputUrl as string);
        const blob = await res.blob();
        const input = await openInput(blob);
        try {
          const m = await extractMetadata(input);
          if (!cancelled) setMeasured({ jobId: done.id, meta: m, size: done.outputSize as number, ms: Date.now() });
        } finally {
          input.dispose();
        }
      } catch { /* measured compare optional */ }
    })();
    return () => { cancelled = true; };
  }, [jobs, myJobs, measured]);

  const benchJobs = jobs.filter((j) => myJobs.has(j.id));

  if (!meta) {
    return <p className="mono text-[12px] text-zinc-500">Parsing media…</p>;
  }

  return (
    <div className="space-y-3">
      {/* INPUT SUMMARY */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Compressor input">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">INPUT</h3>
        <div className="mono mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] md:grid-cols-4">
          <div className="text-zinc-500">FILE <p className="truncate text-zinc-200">{source.name}</p></div>
          <div className="text-zinc-500">CONTAINER <p className="text-zinc-200">{meta.container}</p></div>
          <div className="text-zinc-500">DURATION <p className="text-zinc-200">{formatDuration(meta.duration)}</p></div>
          <div className="text-zinc-500">SIZE <p className="text-zinc-200">{formatBytes(source.size)}</p></div>
          <div className="text-zinc-500">VIDEO <p className="text-zinc-200">{(v?.codec ?? '?').toUpperCase()} {v?.displayWidth ?? '?'}×{v?.displayHeight ?? '?'} {formatFps(v?.frameRate)} {formatBitrate(v?.bitrate ?? v?.averageBitrate)}</p></div>
          <div className="text-zinc-500">AUDIO <p className="text-zinc-200">{(a?.codec ?? '?').toUpperCase()} {a?.channels ?? '?'}ch {formatHz(a?.sampleRate)} {formatBitrate(a?.bitrate ?? a?.averageBitrate)}</p></div>
          <div className="text-zinc-500">TRACKS <p className="text-zinc-200">{meta.videoTracks.length}V + {meta.audioTracks.length}A</p></div>
          <div className="text-zinc-500">TITLE <p className="truncate text-zinc-200">{meta.title ?? '—'}</p></div>
        </div>
        {source.size > 500 * 1024 * 1024 && (
          <p className="mt-2 text-[12px] text-amber-300">Large file detected. Compression may consume significant browser CPU and memory.</p>
        )}
      </section>

      {/* SMART ANALYSIS */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Smart analysis">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">SMART ANALYSIS</h3>
        <ul className="mt-1.5 space-y-1">
          {advice.map((d, i) => <li key={i} className="text-[12px] leading-relaxed text-zinc-300">• {d.text}</li>)}
        </ul>
      </section>

      {/* PRESETS */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Presets">
        <div className="flex items-center justify-between">
          <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">PRESETS {capsLoading ? '(checking encoders…)' : ''}</h3>
          <CodecPathNote />
        </div>
        <div className="mt-2 space-y-1.5">
          {presets.map((p) => (
            <div key={p.id} className={`rounded border px-2.5 py-1.5 ${p.usable ? 'border-zinc-800 bg-zinc-950/60' : 'border-zinc-800/50 opacity-50'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] font-medium text-zinc-100">{p.label}</p>
                <button onClick={() => applyPreset(p.id)} disabled={!p.usable} title={p.usable ? p.strategy : p.disabledReason ?? undefined} className="mono shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-200 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40">
                  {p.usable ? 'apply' : 'unavailable'}
                </button>
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">{p.usable ? p.strategy : p.disabledReason}</p>
              <ul className="mono mt-1 space-y-0.5 text-[10px] text-zinc-500">
                {p.changes.map((c) => <li key={c}>→ {c}</li>)}
              </ul>
            </div>
          ))}
        </div>
        {!capsLoading && caps.video.length === 0 && (
          <p className="mt-2 text-[12px] text-amber-300">No video encoders reported by this browser. Transcode presets are disabled; load an extension in Codecs if one covers your codec.</p>
        )}
        <CustomCompressPresets getConfig={() => config} onApply={(c) => applySavedConfig(c)} log={props.log} />
      </section>

      {/* MODES */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Compression mode">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Modes">
          {(['smart', 'target-size', 'reduction', 'quality', 'manual'] as CompressorMode[]).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`mono rounded px-2.5 py-1 text-[11px] ${mode === m ? 'bg-red-600/20 text-red-100' : 'text-zinc-500 hover:text-zinc-200'}`}>
              {m === 'smart' ? 'Smart Compress' : m === 'target-size' ? 'Target Size' : m === 'reduction' ? 'Target Reduction' : m === 'quality' ? 'Quality' : 'Manual'}
            </button>
          ))}
        </div>

        {mode === 'target-size' && (
          <label className="mt-2 block max-w-xs text-[12px] text-zinc-400">Target size (MB)
            <input type="number" min={10} value={targetMB} onChange={(e) => setTargetMB(Number(e.target.value))} className="mono mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100" />
          </label>
        )}
        {mode === 'reduction' && (
          <label className="mt-2 block max-w-xs text-[12px] text-zinc-400">Target reduction (%)
            <input type="range" min={5} max={95} value={reductionPct} onChange={(e) => setReductionPct(Number(e.target.value))} className="mt-2 w-full" />
            <span className="mono text-[11px] text-zinc-300">{reductionPct}% → ~{formatBytes(source.size * (1 - reductionPct / 100))} (estimate)</span>
          </label>
        )}
        {mode === 'quality' && (
          <div className="mt-2 flex gap-1">
            {(['low', 'balanced', 'high', 'very-high'] as QualityTier[]).map((t) => (
              <button key={t} onClick={() => setTier(t)} className={`mono rounded border px-2.5 py-1 text-[11px] ${tier === t ? 'border-sky-700 bg-sky-950/40 text-sky-100' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'}`}>{t}</button>
            ))}
          </div>
        )}
        {mode === 'manual' && (
          <div className="mt-2 grid max-w-2xl grid-cols-2 gap-2 md:grid-cols-3">
            <label className="text-[12px] text-zinc-400">Video codec
              <select value={videoCodec} onChange={(e) => setVideoCodec(e.target.value as typeof videoCodec)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
                {(['avc', 'hevc', 'vp9', 'av1'] as const).map((c) => (
                  <option key={c} value={c} disabled={!caps.video.includes(c)}>{c.toUpperCase()}{caps.video.includes(c) ? '' : ' (no encoder)'}</option>
                ))}
                <option value="copy">Copy</option>
              </select>
            </label>
            <label className="text-[12px] text-zinc-400">Video bitrate (kbps, blank = quality)
              <input value={videoBitrate != null ? Math.round(videoBitrate / 1000) : ''} onChange={(e) => setVideoBitrate(e.target.value === '' ? null : Number(e.target.value) * 1000)} placeholder="e.g. 2500" inputMode="numeric" className="mono mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100" />
            </label>
            <label className="text-[12px] text-zinc-400">Quality tier
              <select value={tier} onChange={(e) => setTier(e.target.value as QualityTier)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
                <option value="low">Low</option><option value="balanced">Balanced</option>
                <option value="high">High</option><option value="very-high">Very High</option>
              </select>
            </label>
            <label className="text-[12px] text-zinc-400">Audio codec
              <select value={audioCodec} onChange={(e) => setAudioCodec(e.target.value as typeof audioCodec)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
                {(['aac', 'opus', 'mp3'] as const).map((c) => (
                  <option key={c} value={c} disabled={!caps.audio.includes(c)}>{c.toUpperCase()}{caps.audio.includes(c) ? '' : ' (no encoder)'}</option>
                ))}
                <option value="copy">Copy</option><option value="none">Remove</option>
              </select>
            </label>
            <label className="text-[12px] text-zinc-400">Audio bitrate (kbps)
              <input type="number" value={Math.round(audioBitrate / 1000)} onChange={(e) => setAudioBitrate(Number(e.target.value) * 1000)} className="mono mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100" />
            </label>
            <label className="text-[12px] text-zinc-400">Resolution width (blank = keep/scale by preset)
              <input value={width ?? ''} onChange={(e) => setWidth(e.target.value === '' ? null : Number(e.target.value))} placeholder="e.g. 1280" inputMode="numeric" className="mono mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100" />
            </label>
            <label className="text-[12px] text-zinc-400">FPS (blank = keep)
              <input value={fps ?? ''} onChange={(e) => setFps(e.target.value === '' ? null : Number(e.target.value))} placeholder="e.g. 30" inputMode="numeric" className="mono mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100" />
            </label>
          </div>
        )}

        {/* KEEP FLAGS */}
        <div className="mono mt-3 flex flex-wrap gap-3 text-[11px] text-zinc-400">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={keepRes} onChange={(e) => setKeepRes(e.target.checked)} /> Keep original resolution</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={keepFps} onChange={(e) => setKeepFps(e.target.checked)} /> Keep original FPS</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={keepAudio} onChange={(e) => setKeepAudio(e.target.checked)} /> Keep original audio</label>
        </div>

        {/* TRACK SELECTION */}
        <div className="mt-3">
          <TrackPicker meta={meta} videoSel={videoSel} audioSel={audioSel} onVideo={setVideoSel} onAudio={setAudioSel} />
          {dropped.length > 0 && (
            <p className="mono mt-1 text-[11px] text-amber-300">
              Explicitly excluded by you: {dropped.map((d) => d.label).join(', ')}. Nothing else is dropped.
            </p>
          )}
        </div>

        {/* ADVANCED */}
        <button onClick={() => setAdvanced((x) => !x)} className="mono mt-3 text-[11px] text-zinc-500 hover:text-zinc-300" aria-expanded={advanced}>
          {advanced ? '▾' : '▸'} advanced audio
        </button>
        {advanced && (
          <div className="mt-2 grid max-w-2xl grid-cols-2 gap-2 md:grid-cols-3">
            <label className="text-[12px] text-zinc-400">Channels (blank = keep; no silent downmix shown)
              <input value={channels ?? ''} onChange={(e) => setChannels(e.target.value === '' ? null : Number(e.target.value))} placeholder="e.g. 2" inputMode="numeric" className="mono mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100" />
            </label>
            <label className="text-[12px] text-zinc-400">Sample rate (blank = keep)
              <input value={sampleRate ?? ''} onChange={(e) => setSampleRate(e.target.value === '' ? null : Number(e.target.value))} placeholder="e.g. 48000" inputMode="numeric" className="mono mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100" />
            </label>
            <label className="text-[12px] text-zinc-400">Container
              <select value={container} onChange={(e) => setContainer(e.target.value as 'mp4' | 'webm')} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
                {validContainers.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
              </select>
            </label>
          </div>
        )}
      </section>

      {/* REMUX DETECTION + LOSSY BANNER */}
      {remuxOnly ? (
        <div className="rounded-lg border border-emerald-900 bg-emerald-950/30 p-3">
          <p className="text-[13px] text-emerald-200">✓ LOSSLESS — this configuration needs no re-encoding.</p>
          <p className="mt-1 text-[12px] text-emerald-200/80">This operation can be performed as a remux without re-encoding. It is not a compression.</p>
          <button onClick={props.onGotoMultiplexer} className="mt-2 rounded border border-emerald-800 px-3 py-1.5 text-[12px] text-emerald-100 hover:border-emerald-600">Switch to Multiplexer</button>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-900 bg-amber-950/30 p-3">
          <p className="text-[13px] text-amber-200">⚠ LOSSY / RE-ENCODE — compression requires decoding and re-encoding and may reduce quality.</p>
        </div>
      )}

      {/* PIPELINE */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Compression pipeline">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">PIPELINE — COPY VS TRANSCODE</h3>
        <ul className="mono mt-1.5 space-y-0.5 text-[11px]">
          {rows.map((r) => (
            <li key={r.label} className="flex justify-between">
              <span className="text-zinc-300">{r.label}</span>
              <span className={r.action === 'COPY' ? 'text-emerald-300' : r.action === 'TRANSCODE' ? 'text-amber-300' : 'text-zinc-600'}>{r.action}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ESTIMATE */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Compression estimate">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">COMPRESSION ESTIMATE (NOT MEASURED)</h3>
        {sizePlan && (
          <div className="mono mt-1.5 text-[11px] leading-relaxed text-zinc-400">
            <p>Target <span className="text-zinc-100">{formatBytes(sizePlan.targetBytes)}</span> · Duration <span className="text-zinc-100">{formatDuration(meta.duration)}</span></p>
            <p>Estimated audio <span className="text-zinc-100">~{formatBytes(sizePlan.audioBytes ?? 0)}</span> · Video budget <span className="text-zinc-100">~{formatBytes((sizePlan.targetBytes ?? 0) - (sizePlan.audioBytes ?? 0) - sizePlan.overheadBytes)}</span></p>
            <p>Target video bitrate <span className="text-zinc-100">~{formatBitrate(sizePlan.videoBitrate)}</span> · Complexity <span className="text-zinc-100">{sizePlan.complexity}</span></p>
          </div>
        )}
        <div className="mono mt-1.5 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
          <div className="text-zinc-500">ORIGINAL <p className="text-[13px] text-zinc-100">{formatBytes(source.size)}</p></div>
          <div className="text-zinc-500">EST. OUTPUT <EstimateOutput estimate={estimate} config={config} /></div>
          <div className="text-zinc-500">EST. REDUCTION <p className="text-[13px] text-zinc-100">{estimate.reductionPct != null ? `~${estimate.reductionPct.toFixed(1)}%` : 'content-dependent'}</p></div>
          <div className="text-zinc-500">VIDEO/AUDIO <p className="text-[13px] text-zinc-100">{formatBitrate(estimate.videoBitrate)} / {formatBitrate(estimate.audioBitrate)}</p></div>
        </div>
        {estimate.notes.map((n, i) => <p key={i} className="mono mt-1 text-[10px] text-zinc-600">{n}</p>)}
        <p className="mono mt-1.5 break-all text-[11px] text-zinc-500">{ffmpegPreview(source.name, config, `compressed.${container}`)}</p>
        <p className="mono text-[10px] text-zinc-600">REFERENCE ONLY — encoded with Mediabunny/WebCodecs.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={enqueue} disabled={remuxOnly || !validContainers.includes(container)} className="rounded bg-red-600 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-red-500 disabled:opacity-40">
            Queue compression job
          </button>
          <button onClick={enqueueBenchmark} className="rounded border border-zinc-700 px-3 py-1.5 text-[12px] hover:border-zinc-500">
            Benchmark 3 presets
          </button>
        </div>
        {validContainers.length === 0 && (
          <p role="alert" className="mt-2 text-[12px] text-red-300">No container accepts this codec combination. Change codecs or container.</p>
        )}
      </section>

      {/* BENCHMARK RESULTS */}
      {benchJobs.length > 0 && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Benchmark results">
          <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">BENCHMARK — REAL RESULTS ONLY</h3>
          <table className="mono mt-2 w-full text-[11px]">
            <thead><tr className="text-left text-zinc-500">
              <th className="py-1 pr-2 font-normal">Config</th><th className="py-1 pr-2 font-normal">Size</th>
              <th className="py-1 pr-2 font-normal">Reduction</th><th className="py-1 font-normal">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-800/60">
              {benchJobs.map((j) => (
                <tr key={j.id}>
                  <td className="max-w-[280px] truncate py-1 pr-2 text-zinc-200">{j.label}</td>
                  <td className="py-1 pr-2 text-zinc-300">{j.outputSize != null ? formatBytes(j.outputSize) : '—'}</td>
                  <td className="py-1 pr-2 text-zinc-300">{j.outputSize != null ? `${(((source.size - j.outputSize) / source.size) * 100).toFixed(1)}%` : '—'}</td>
                  <td className="py-1 text-zinc-400">{j.status}{j.status === 'running' ? ` ${Math.round(j.progress * 100)}%` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* MEASURED RESULT */}
      {measured && (
        <section className="rounded-lg border border-emerald-900 bg-emerald-950/20 p-3" aria-label="Measured result">
          <h3 className="mono text-[10px] tracking-[0.18em] text-emerald-400/80">ACTUAL RESULT (MEASURED)</h3>
          <MeasuredCompare source={source} meta={meta} outMeta={measured.meta} outSize={measured.size} view={view} onView={setView} />
        </section>
      )}
    </div>
  );
}

function keptAudio(meta: MediaMetadata, sel: number[] | null): MediaMetadata['audioTracks'] {
  return sel == null ? meta.audioTracks : meta.audioTracks.filter((t) => sel.includes(t.index));
}

/** Resolution-ladder planning bitrate. Labeled estimate, not a promise. */
function smartBitrate(meta: MediaMetadata | null, _size: number): number | null {
  const w = meta?.primaryVideo?.displayWidth ?? null;
  if (w == null) return null;
  if (w >= 3000) return 8_000_000;
  if (w >= 1900) return 5_000_000;
  if (w >= 1200) return 2_500_000;
  return 1_200_000;
}

function closestTier(q: number): QualityTier {
  const entries: QualityTier[] = ['low', 'balanced', 'high', 'very-high'];
  let best: QualityTier = 'high';
  let bestD = Infinity;
  for (const t of entries) {
    const d = Math.abs(QUALITY_TIER_VALUE[t] - q);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

function CustomCompressPresets(props: { getConfig: () => OperationConfig; onApply: (c: OperationConfig) => void; log: (s: string) => void }) {
  const [presets, setPresets] = useState(() => listCompressPresets());
  const [name, setName] = useState('');
  return (
    <div className="mt-2 border-t border-zinc-800 pt-2">
      <p className="mono text-[10px] tracking-[0.15em] text-zinc-500">SAVED CONFIGURATIONS (NO MEDIA)</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <span key={p.id} className="mono flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[11px] text-zinc-200">
            <button onClick={() => props.onApply(p.config)} title={p.config.label}>{p.name}</button>
            <button onClick={() => setPresets(deleteCompressPreset(p.id))} className="text-zinc-600 hover:text-red-300" aria-label={`Delete ${p.name}`}>✕</button>
          </span>
        ))}
        {presets.length === 0 && <span className="mono text-[10px] text-zinc-600">none saved</span>}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Save current as…" aria-label="Preset name" className="mono min-w-0 max-w-[220px] flex-1 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-[11px] text-zinc-100" />
        <button
          onClick={() => {
            if (!name.trim()) return;
            setPresets(saveCompressPreset({ id: uid('preset'), name: name.trim(), config: { ...props.getConfig(), label: name.trim() }, createdAt: Date.now() }));
            setName('');
            props.log('compression preset saved (configuration only)');
          }}
          className="mono shrink-0 rounded border border-zinc-700 px-2 py-1 text-[11px] hover:border-zinc-500"
        >
          save
        </button>
      </div>
    </div>
  );
}

function CodecPathNote() {
  return <span className="mono text-[10px] text-zinc-600">paths: native first · extensions lazy in Codecs</span>;
}

function TrackPicker(props: {
  meta: MediaMetadata;
  videoSel: number[] | null;
  audioSel: number[] | null;
  onVideo: (v: number[] | null) => void;
  onAudio: (v: number[] | null) => void;
}) {
  const { meta } = props;
  const allV = meta.videoTracks.map((t) => t.index);
  const allA = meta.audioTracks.map((t) => t.index);
  const vOn = props.videoSel ?? allV;
  const aOn = props.audioSel ?? allA;
  const toggle = (list: number[], i: number) => (list.includes(i) ? list.filter((x) => x !== i) : [...list, i]);
  return (
    <div className="mono text-[11px] text-zinc-400">
      <span className="text-[10px] tracking-[0.15em] text-zinc-500">TRACKS (UNCHECKED = DROPPED BY YOU)</span>
      <div className="mt-1 flex flex-wrap gap-2">
        {meta.videoTracks.map((t) => (
          <label key={`v${t.index}`} className="flex items-center gap-1.5 rounded border border-zinc-800 px-2 py-1">
            <input type="checkbox" checked={vOn.includes(t.index)} onChange={() => props.onVideo(toggle(vOn, t.index))} />
            V{t.index + 1} {(t.codec ?? '?').toUpperCase()}
          </label>
        ))}
        {meta.audioTracks.map((t) => (
          <label key={`a${t.index}`} className="flex items-center gap-1.5 rounded border border-zinc-800 px-2 py-1">
            <input type="checkbox" checked={aOn.includes(t.index)} onChange={() => props.onAudio(toggle(aOn, t.index))} />
            A{t.index + 1} {(t.codec ?? '?').toUpperCase()} {t.languageCode}
          </label>
        ))}
        <button onClick={() => { props.onVideo(null); props.onAudio(null); }} className="rounded border border-zinc-700 px-2 py-1 hover:border-zinc-500">keep all</button>
      </div>
      {meta.videoTracks.length + meta.audioTracks.length > 2 && (
        <p className="mt-1 text-[10px] text-zinc-600">One shared audio configuration applies to all kept audio tracks.</p>
      )}
    </div>
  );
}

function EstimateOutput({ estimate, config }: { estimate: { targetBytes: number | null }; config: OperationConfig }) {
  if (estimate.targetBytes != null) {
    return <p className="text-[13px] text-zinc-100">~{formatBytes(estimate.targetBytes)}</p>;
  }
  const params = [
    `video ${(config.videoCodec ?? 'copy').toUpperCase()}`,
    config.videoQuality != null ? `quality ${config.videoQuality.toFixed(2)}` : null,
    config.width ? `${config.width}w` : 'keep resolution',
    config.frameRate ? `${config.frameRate}fps` : 'keep fps',
    `audio ${(config.audioCodec ?? 'copy').toUpperCase()}${config.audioBitrate ? ` ${Math.round(config.audioBitrate / 1000)}k` : ''}`,
  ].filter(Boolean).join(' · ');
  return (
    <div>
      <p className="text-[13px] text-zinc-100">Content-dependent</p>
      <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">Quality mode has no predictable size — output depends on content complexity. Encoding with: {params}.</p>
    </div>
  );
}

function MeasuredCompare(props: {
  source: SourceFileEntry;
  meta: MediaMetadata;
  outMeta: MediaMetadata;
  outSize: number;
  view: 'original' | 'compressed' | 'side';
  onView: (v: 'original' | 'compressed' | 'side') => void;
}) {
  const { meta, outMeta } = props;
  const red = ((props.source.size - props.outSize) / props.source.size) * 100;
  const ov = outMeta.primaryVideo;
  const v = meta.primaryVideo;
  const oa = outMeta.primaryAudio;
  const a = meta.primaryAudio;
  return (
    <div>
      <div className="mono mt-1.5 grid grid-cols-3 gap-2 text-center text-[11px]">
        <div className="rounded border border-zinc-800 p-2"><p className="text-[10px] text-zinc-500">ORIGINAL</p><p className="text-[13px] text-zinc-100">{formatBytes(props.source.size)}</p></div>
        <div className="rounded border border-sky-900 p-2"><p className="text-[10px] text-sky-400">OUTPUT</p><p className="text-[13px] text-zinc-100">{formatBytes(props.outSize)}</p></div>
        <div className="rounded border border-emerald-900 p-2"><p className="text-[10px] text-emerald-400">ACTUAL REDUCTION</p><p className="text-[13px] text-zinc-100">{red.toFixed(1)}%</p></div>
      </div>
      <div className="mono mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
        <div>VIDEO <p className="text-zinc-200">{(v?.codec ?? '?').toUpperCase()} {v?.displayWidth ?? '?'}×{v?.displayHeight ?? '?'} {formatBitrate(v?.bitrate ?? v?.averageBitrate)} → {(ov?.codec ?? '?').toUpperCase()} {ov?.displayWidth ?? '?'}×{ov?.displayHeight ?? '?'} {formatBitrate(ov?.bitrate ?? ov?.averageBitrate)}</p></div>
        <div>AUDIO <p className="text-zinc-200">{(a?.codec ?? '?').toUpperCase()} {formatBitrate(a?.bitrate ?? a?.averageBitrate)} → {(oa?.codec ?? '?').toUpperCase()} {formatBitrate(oa?.bitrate ?? oa?.averageBitrate)}</p></div>
      </div>
      <div className="mt-2 flex gap-1">
        {(['original', 'compressed', 'side'] as const).map((x) => (
          <button key={x} onClick={() => props.onView(x)} className={`mono rounded border px-2 py-1 text-[11px] ${props.view === x ? 'border-sky-700 bg-sky-950/40 text-sky-100' : 'border-zinc-700 text-zinc-400'}`}>{x === 'side' ? 'Side by Side' : x[0].toUpperCase() + x.slice(1)}</button>
        ))}
      </div>
      <CompareVideos source={props.source} outSize={props.outSize} view={props.view} />
    </div>
  );
}

function CompareVideos({ source, outSize, view }: { source: SourceFileEntry; outSize: number; view: 'original' | 'compressed' | 'side' }) {
  const [outUrl, setOutUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Latest completed compressor output for this source size.
    const unsub = jobQueue.subscribe((jobs) => {
      const hit = jobs.find((j) => j.kind === 'transcode' && j.status === 'completed' && j.outputUrl && j.outputSize === outSize);
      if (hit?.outputUrl && !cancelled) setOutUrl(hit.outputUrl);
    });
    return () => { cancelled = true; unsub(); };
  }, [outSize]);
  if (view === 'side') {
    return (
      <div className="mt-2 grid grid-cols-2 gap-2">
        <video src={source.objectUrl} controls playsInline preload="metadata" className="aspect-video w-full rounded border border-zinc-800 bg-black" />
        {outUrl
          ? <video src={outUrl} controls playsInline preload="metadata" className="aspect-video w-full rounded border border-sky-900 bg-black" />
          : <div className="flex aspect-video items-center justify-center rounded border border-zinc-800 text-[12px] text-zinc-600">compressed preview pending</div>}
      </div>
    );
  }
  return (
    <video
      src={view === 'original' ? source.objectUrl : (outUrl ?? source.objectUrl)}
      controls playsInline preload="metadata" className="mt-2 aspect-video w-full rounded border border-zinc-800 bg-black"
    />
  );
}
