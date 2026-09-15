import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Chapter, CodecExtensionInfo, HistoryEntry, JobRecord, MediaCapabilityRow,
  MuxContainer, MuxTrackSelection, OperationConfig, OptimizationRecommendation, PlannedTrack, SourceFileEntry,
} from './types';
import { extensionOf, formatBytes, formatDuration, uid } from './lib/format';
import { openInput, describeOpenError } from './lib/mediabunny/reader';
import { extractMetadata } from './lib/mediabunny/metadata';
import { countCues, detectSubtitleFormat } from './lib/subtitles';
import { generateSample } from './lib/mediabunny/sample';
import { runOperation } from './lib/mediabunny/transcoder';
import { dryRunSingleRemux, muxFileName, newSelectionId, planMux, remuxManualCopy, remuxSingleFile, type ManualCopyTrack } from './lib/mediabunny/muxer';
import { joinFiles, joinFileName } from './lib/mediabunny/splitjoin';
import type { JoinConfig } from './lib/mediabunny/splitjoin';
import { EXTENSIONS, loadExtension } from './lib/mediabunny/extensions';
import { extractionTargets, formatExt } from './lib/codecs';
import { mediaReport } from './lib/report';
import { jobQueue } from './lib/jobs';
import { appendHistory, listHistory, listJobs, listProjects, saveJobs, saveProject } from './lib/db';
import { Analyzer, IntegrityPanel, MediaReportPanel, Recommendations, TrackContrib } from './components/Analyzer';
import { ChapterEditor } from './components/Chapters';
import { CodecsView, probeCapabilities } from './components/CodecsView';
import { Compressor } from './components/Compressor';
import { Extract, type ExtractTarget } from './components/Extract';
import { HeaderEditor } from './components/HeaderEditor';
import { JobsView } from './components/JobsView';
import { Multiplexer } from './components/Multiplexer';
import { ProcessorView } from './components/ProcessorView';
import { SplitJoin } from './components/SplitJoin';
import { BentoCard, BentoGrid } from './components/aceternity/Bento';
import { MovingBorderButton } from './components/aceternity/MovingBorder';
import { TextGenerate } from './components/aceternity/TextGenerate';
import { AppBackdrop } from './components/aceternity/AppBackdrop';
import { WorkspaceView } from './components/WorkspaceView';
import type { ProjectRecord } from './types';

type ToolId = 'multiplexer' | 'inspector' | 'chapters' | 'header' | 'extract' | 'compressor' | 'splitjoin' | 'processor' | 'analyzer' | 'jobs' | 'codecs';

// Placeholder to keep ExtractTarget import shape stable if Extract evolves.

const TOOLS: Array<{ id: ToolId; label: string; hint: string }> = [
  { id: 'multiplexer', label: 'Multiplexer', hint: 'Remux tracks' },
  { id: 'inspector', label: 'Inspector', hint: 'Tracks + frames' },
  { id: 'chapters', label: 'Chapters', hint: 'Edit + export' },
  { id: 'header', label: 'Header', hint: 'Title + flags' },
  { id: 'extract', label: 'Extract', hint: 'Streams' },
  { id: 'compressor', label: 'Compressor', hint: 'Smart size reduction' },
  { id: 'splitjoin', label: 'Split & Join', hint: 'Cut · append' },
  { id: 'processor', label: 'Processor', hint: 'Transcode' },
  { id: 'analyzer', label: 'Analyzer', hint: 'Size + advice' },
  { id: 'jobs', label: 'Jobs', hint: 'Queue' },
  { id: 'codecs', label: 'Codecs', hint: 'Caps + formats' },
];

interface RemuxPayload {
  mode: 'single' | 'manual';
  file?: File;
  videoIdx?: number[];
  audioIdx?: number[];
  tracks?: ManualCopyTrack[];
  container: MuxContainer;
  title: string | null;
  label: string;
}

interface ExtractPayload {
  file: File;
  kind: 'video' | 'audio';
  trackIndex: number;
  targetId: string;
  label: string;
}

interface TranscodePayload {
  file: File;
  config: OperationConfig;
  label: string;
  outputName?: string;
}

interface JoinPayload {
  files: File[];
  config: JoinConfig;
  label: string;
}

interface AnalyzePayload {
  file: File;
  name: string;
  size: number;
}

export default function App() {
  const [tool, setTool] = useState<ToolId | 'home'>('home');
  const [sources, setSources] = useState<SourceFileEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selections, setSelections] = useState<MuxTrackSelection[]>([]);
  const [muxContainer, setMuxContainer] = useState<MuxContainer>('mkv');
  const [muxTitle, setMuxTitle] = useState('');
  const [selectedSelKey, setSelectedSelKey] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [native, setNative] = useState<MediaCapabilityRow[]>([]);
  const [nativeLoading, setNativeLoading] = useState(true);
  const [extensions, setExtensions] = useState<CodecExtensionInfo[]>(EXTENSIONS.map((e) => ({ ...e, state: 'available', error: null })));
  const [extractSel, setExtractSel] = useState<ExtractTarget | null>(null);
  const [pendingOp, setPendingOp] = useState<OperationConfig | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [recent, setRecent] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [dryRunMsg, setDryRunMsg] = useState<string | null>(null);
  const [muxBusy, setMuxBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectIds = useRef(new Map<string, string>());

  const log = useCallback((s: string) => {
    setLines((prev) => [...prev.slice(-199), `${new Date().toLocaleTimeString()}  ${s}`]);
  }, []);

  const active = useMemo(() => sources.find((s) => s.id === activeId) ?? sources[0] ?? null, [sources, activeId]);

  const plan: PlannedTrack[] = useMemo(
    () => (sources.length === 0 ? [] : planMux({ sources, selections, container: muxContainer })),
    [sources, selections, muxContainer],
  );

  // ---- init: capabilities, jobs, recent ----
  useEffect(() => {
    probeCapabilities([
      { codec: 'avc', video: true }, { codec: 'hevc', video: true },
      { codec: 'vp9', video: true }, { codec: 'av1', video: true },
      { codec: 'aac', video: false }, { codec: 'opus', video: false },
      { codec: 'mp3', video: false }, { codec: 'vorbis', video: false },
    ]).then(setNative).catch(() => setNative([])).finally(() => setNativeLoading(false));
    jobQueue.setPersist(saveJobs);
    listJobs().then((j) => jobQueue.hydrate(j)).catch(() => undefined);
    const unsub = jobQueue.subscribe(setJobs);
    listProjects().then(setRecent).catch(() => undefined);
    return unsub;
  }, []);

  // ---- executors ----
  useEffect(() => {
    jobQueue.register('remux', async (job, report, isCancelled) => {
      const p = jobQueue.payloadOf<RemuxPayload>(job);
      if (!p) throw new Error('Session reloaded; payloads are session-local. Re-queue this job.');
      const onProgress = (pr: { progress: number }) => report(pr.progress);
      const handle = p.mode === 'single' && p.file
        ? remuxSingleFile(p.file, p.videoIdx ?? [], p.audioIdx ?? [], p.container, p.title, onProgress as never)
        : remuxManualCopy(p.tracks ?? [], p.container, onProgress as never, p.title);
      const cancelCheck = setInterval(() => { if (isCancelled()) void handle.cancel(); }, 300);
      try {
        const { blob, size } = await handle.promise;
        const name = muxFileName(p.title, p.container);
        return { outputUrl: URL.createObjectURL(blob), outputName: name, outputSize: size, detail: `${p.label} → ${name}` };
      } finally {
        clearInterval(cancelCheck);
      }
    });
    jobQueue.register('extract', async (job, report) => {
      const p = jobQueue.payloadOf<ExtractPayload>(job);
      if (!p) throw new Error('Session reloaded; payloads are session-local. Re-queue this job.');
      const handle = remuxManualCopy(
        [{ file: p.file, sourceName: p.file.name, kind: p.kind, trackIndex: p.trackIndex, name: null, languageCode: null, makeDefault: null, makeForced: null, subtitleText: null }],
        p.targetId, (pr) => report(pr.progress),
      );
      try {
        const { blob, size } = await handle.promise;
        const ext = formatExt(p.targetId, p.kind);
        const name = `extract-${p.kind}${p.trackIndex + 1}.${ext}`;
        return { outputUrl: URL.createObjectURL(blob), outputName: name, outputSize: size, detail: `${p.label} → ${name}` };
      } catch (e) {
        if (e instanceof Error && /no output|Missing|Unknown/.test(e.message)) {
          throw new Error(`Extraction failed: ${e.message} This container/codec combination may be unsupported.`);
        }
        throw e;
      }
    });
    jobQueue.register('analyze', async (job, report) => {
      const p = jobQueue.payloadOf<AnalyzePayload>(job);
      if (!p) throw new Error('Session reloaded; payloads are session-local. Re-queue this job.');
      report(0.2);
      const input = await openInput(p.file);
      try {
        const meta = await extractMetadata(input);
        report(0.8);
        const text = mediaReport(p.name, p.size, meta);
        const blob = new Blob([text], { type: 'text/markdown' });
        return { outputUrl: URL.createObjectURL(blob), outputName: 'media-report.md', outputSize: blob.size, detail: `Analyzed ${p.name}` };
      } finally {
        input.dispose();
      }
    });
    jobQueue.register('transcode', async (job, report, isCancelled) => {
      const p = jobQueue.payloadOf<TranscodePayload>(job);
      if (!p) throw new Error('Session reloaded; payloads are session-local. Re-queue this job.');
      const handle = runOperation(p.file, p.config, (pr) => report(pr.progress));
      const cancelCheck = setInterval(() => { if (isCancelled()) void handle.cancel(); }, 300);
      try {
        const { blob, size } = await handle.promise;
        const name = p.outputName ?? `${p.config.kind}-output.${p.config.container}`;
        return { outputUrl: URL.createObjectURL(blob), outputName: name, outputSize: size, detail: `${p.label} → ${name}` };
      } finally {
        clearInterval(cancelCheck);
      }
    });
    jobQueue.register('join', async (job, report, isCancelled) => {
      const p = jobQueue.payloadOf<JoinPayload>(job);
      if (!p) throw new Error('Session reloaded; payloads are session-local. Re-queue this job.');
      const handle = joinFiles(p.files, p.config, (pr) => report(pr.progress < 0 ? 0 : pr.progress));
      const cancelCheck = setInterval(() => { if (isCancelled()) void handle.cancel(); }, 300);
      try {
        const { blob, size } = await handle.promise;
        const name = joinFileName(p.files[0]?.name ?? 'joined', p.config.container);
        return { outputUrl: URL.createObjectURL(blob), outputName: name, outputSize: size, detail: `${p.label} → ${name}` };
      } finally {
        clearInterval(cancelCheck);
      }
    });
  }, []);

  // ---- file intake ----
  const loadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setLoading(true);
    setHomeError(null);
    if (files.length > 1) log(`${files.length} media sources detected → opening in Multiplexer`);
    for (const file of files) {
      const id = uid('src');
      const url = URL.createObjectURL(file);
      const entry: SourceFileEntry = { id, file, objectUrl: url, name: file.name, size: file.size, metadata: null, loadError: null, subtitle: null };
      setSources((prev) => [...prev, entry]);
      setActiveId((prev) => prev ?? id);
      log(`open ${file.name} (${formatBytes(file.size)})`);
      // Subtitle sidecars are text, not media containers.
      if (/\.(srt|vtt)$/i.test(file.name)) {
        try {
          const text = await file.text();
          const format = detectSubtitleFormat(file.name, text);
          if (!format) throw new Error('Could not recognize this as SRT or WebVTT.');
          if (format === 'vtt' || true) {
            const cues = format === 'vtt' ? countCues(text) : -1;
            setSources((prev) => prev.map((s) => (s.id === id ? { ...s, subtitle: { format, text } } : s)));
            setSelections((prev) => [...prev, {
              key: newSelectionId(), sourceId: id, trackIndex: 0, kind: 'subtitle' as const,
              include: true, order: prev.length > 0 ? Math.max(...prev.map((p) => p.order)) + 1 : 0,
              nameOverride: null, langOverride: null, defaultOverride: null, forcedOverride: null, convertSubtitle: format === 'srt',
            }]);
            log(`subtitle ${file.name}: ${format.toUpperCase()}${cues >= 0 ? `, ~${cues} cues` : ''}`);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Could not read subtitle file';
          setSources((prev) => prev.map((s) => (s.id === id ? { ...s, loadError: msg } : s)));
          log(`error: ${msg}`);
        }
        continue;
      }
      if (file.size > 500 * 1024 * 1024) log('warning: large file — operations may use significant memory');
      try {
        const input = await openInput(file);
        let meta;
        try {
          meta = await extractMetadata(input);
        } finally {
          input.dispose();
        }
        setSources((prev) => prev.map((s) => (s.id === id ? { ...s, metadata: meta } : s)));
        log(`parsed ${file.name}: ${meta.container} ${formatDuration(meta.duration)} (${meta.videoTracks.length}v+${meta.audioTracks.length}a)`);
        const pid = uid('proj');
        projectIds.current.set(id, pid);
        const rec: ProjectRecord = {
          id: pid, name: file.name, filename: file.name, size: file.size,
          duration: meta.duration, container: meta.container, metadata: meta, updatedAt: Date.now(),
        };
        saveProject(rec).catch(() => undefined);
        setRecent((prev) => [rec, ...prev].slice(0, 12));
        listHistory(pid).then(setHistory).catch(() => undefined);
        setSelections((prev) => {
          const base = prev.length > 0 ? Math.max(...prev.map((p) => p.order)) + 1 : 0;
          const add: MuxTrackSelection[] = [
            ...meta.videoTracks.map((t, i) => ({
              key: newSelectionId(), sourceId: id, trackIndex: t.index, kind: 'video' as const,
              include: true, order: base + i, nameOverride: null, langOverride: null,
              defaultOverride: null, forcedOverride: null, convertSubtitle: false,
            })),
            ...meta.audioTracks.map((t, i) => ({
              key: newSelectionId(), sourceId: id, trackIndex: t.index, kind: 'audio' as const,
              include: true, order: base + meta.videoTracks.length + i, nameOverride: null, langOverride: null,
              defaultOverride: null, forcedOverride: null, convertSubtitle: false,
            })),
          ];
          return [...prev, ...add];
        });
      } catch (e) {
        const msg = describeOpenError(e);
        setSources((prev) => prev.map((s) => (s.id === id ? { ...s, loadError: msg } : s)));
        log(`error: ${msg}`);
      }
    }
    setLoading(false);
  }, [log]);

  const onSample = useCallback(async () => {
    setLoading(true);
    try {
      log('generating synthetic sample via Mediabunny…');
      const f = await generateSample();
      await loadFiles([f]);
      setTool('inspector');
    } catch (e) {
      setHomeError(e instanceof Error ? e.message : 'Sample generation failed');
    } finally {
      setLoading(false);
    }
  }, [loadFiles, log]);

  const removeSource = useCallback((id: string) => {
    setSources((prev) => {
      const s = prev.find((x) => x.id === id);
      if (s) URL.revokeObjectURL(s.objectUrl);
      return prev.filter((x) => x.id !== id);
    });
    setSelections((prev) => prev.filter((s) => s.sourceId !== id));
    setActiveId((prev) => (prev === id ? null : prev));
  }, []);

  // ---- multiplexer actions ----
  const included = useMemo(() => plan.filter((p) => p.verdict !== 'dropped'), [plan]);

  const enqueueMux = useCallback(() => {
    if (included.length === 0) return;
    const byId = new Map(sources.map((s) => [s.id, s]));
    const single = new Set(included.map((t) => t.sourceId)).size === 1;
    const hasSubs = included.some((t) => t.kind === 'subtitle');
    const hasOverrides = included.some((t) => t.nameOverride || t.langOverride || t.defaultOverride != null || t.forcedOverride != null);
    if (single && !hasOverrides && !hasSubs) {
      const sid = included[0].sourceId;
      const src = byId.get(sid);
      if (!src) return;
      const payload: RemuxPayload = {
        mode: 'single', file: src.file,
        videoIdx: included.filter((t) => t.kind === 'video').map((t) => t.trackIndex),
        audioIdx: included.filter((t) => t.kind === 'audio').map((t) => t.trackIndex),
        container: muxContainer, title: muxTitle.trim() || null,
        label: `Remux ${src.name} → ${muxContainer.toUpperCase()}`,
      };
      jobQueue.enqueue('remux', payload.label, `${included.length} streams copied · title ${payload.title ?? 'kept'}`, payload);
    } else {
      const tracks: ManualCopyTrack[] = included.map((t) => {
        const src = byId.get(t.sourceId);
        if (!src) throw new Error('Source file missing');
        return {
          file: src.file, sourceName: src.name, kind: t.kind, trackIndex: t.trackIndex,
          name: t.nameOverride, languageCode: t.langOverride,
          makeDefault: t.defaultOverride, makeForced: t.forcedOverride,
          subtitleText: t.kind === 'subtitle' ? (src.subtitle?.text ?? null) : null,
        };
      });
      const payload: RemuxPayload = {
        mode: 'manual', tracks, container: muxContainer, title: muxTitle.trim() || null,
        label: `Mux ${included.length} streams → ${muxContainer.toUpperCase()}`,
      };
      jobQueue.enqueue('remux', payload.label, hasOverrides ? 'with track property overrides' : 'multi-source packet copy', payload);
    }
    setMuxBusy(true);
    setTimeout(() => setMuxBusy(false), 800);
    log(`queued mux job (${included.length} streams → ${muxContainer.toUpperCase()})`);
    setTool('jobs');
  }, [included, sources, muxContainer, muxTitle, log]);

  const dryRun = useCallback(async () => {
    setDryRunMsg('Validating…');
    try {
      const single = new Set(included.map((t) => t.sourceId)).size === 1;
      if (single && included.length > 0) {
        const src = sources.find((s) => s.id === included[0].sourceId);
        if (!src) return;
        const res = await dryRunSingleRemux(
          src.file,
          included.filter((t) => t.kind === 'video').map((t) => t.trackIndex),
          included.filter((t) => t.kind === 'audio').map((t) => t.trackIndex),
          muxContainer,
        );
        setDryRunMsg(res.valid
          ? `Valid: ${res.copied} stream(s) will copy without re-encoding.`
          : `Invalid: ${res.discarded.map((d) => `${d.track} (${d.reason})`).join('; ')}`);
      } else {
        const bad = included.filter((t) => t.verdict === 'unsupported');
        setDryRunMsg(bad.length === 0
          ? `Valid: ${included.length} stream(s) copyable into ${muxContainer.toUpperCase()} per engine format matrix.`
          : `Blocked: ${bad.map((t) => `${t.kind} #${t.trackIndex + 1}`).join(', ')}`);
      }
    } catch (e) {
      setDryRunMsg(e instanceof Error ? e.message : 'Validation failed');
    }
  }, [included, sources, muxContainer]);

  const applyTitle = useCallback(() => {
    if (!active || !muxTitle.trim()) return;
    const payload: RemuxPayload = {
      mode: 'single', file: active.file,
      videoIdx: (active.metadata?.videoTracks ?? []).map((t) => t.index),
      audioIdx: (active.metadata?.audioTracks ?? []).map((t) => t.index),
      container: extensionOf(active.name) === 'webm' ? 'webm' : 'mkv',
      title: muxTitle.trim(), label: `Retitle ${active.name}`,
    };
    jobQueue.enqueue('remux', payload.label, `title → "${payload.title}" (streams copied)`, payload);
    log(`queued retitle job for ${active.name}`);
    setTool('jobs');
  }, [active, muxTitle, log]);

  const enqueueExtract = useCallback(() => {
    if (!extractSel) return;
    const src = sources.find((s) => s.id === extractSel.sourceId);
    if (!src?.metadata) return;
    const track = extractSel.kind === 'video'
      ? src.metadata.videoTracks[extractSel.trackIndex]
      : src.metadata.audioTracks[extractSel.trackIndex];
    const valid = extractionTargets(track?.codec ?? null, extractSel.kind);
    if (!valid.some((t) => t.formatId === extractSel.targetId)) {
      log(`refused: ${(track?.codec ?? '?').toUpperCase()} cannot be stream-copied into that target. No silent transcode.`);
      return;
    }
    const payload: ExtractPayload = {
      file: src.file, kind: extractSel.kind, trackIndex: extractSel.trackIndex,
      targetId: extractSel.targetId, label: `Extract ${extractSel.kind} #${extractSel.trackIndex + 1} from ${src.name}`,
    };
    jobQueue.enqueue('extract', payload.label, 'single-stream copy', payload);
    log(`queued extraction (${payload.label})`);
    setTool('jobs');
  }, [extractSel, sources, log]);

  const loadExt = useCallback(async (id: string) => {
    setExtensions((prev) => prev.map((e) => (e.id === id ? { ...e, state: 'loading', error: null } : e)));
    log(`loading extension ${id}…`);
    try {
      await loadExtension(id);
      setExtensions((prev) => prev.map((e) => (e.id === id ? { ...e, state: 'loaded' } : e)));
      log(`extension ${id} loaded`);
      probeCapabilities([
        { codec: 'avc', video: true }, { codec: 'hevc', video: true },
        { codec: 'vp9', video: true }, { codec: 'av1', video: true },
        { codec: 'aac', video: false }, { codec: 'opus', video: false },
        { codec: 'mp3', video: false }, { codec: 'vorbis', video: false },
      ]).then(setNative).catch(() => undefined);
    } catch (e) {
      setExtensions((prev) => prev.map((e) => (e.id === id ? { ...e, state: 'failed', error: e instanceof Error ? e.message : 'Load failed' } : e)));
      log(`extension ${id} failed to load`);
    }
  }, [log]);

  const enqueueTranscode = useCallback((config: OperationConfig) => {
    if (!active) return;
    const payload: TranscodePayload = { file: active.file, config, label: config.label };
    jobQueue.enqueue('transcode', config.label, `${config.videoCodec ?? 'copy'}/${config.audioCodec ?? 'copy'} → ${config.container}`, payload);
    log(`queued compression job (${config.label})`);
    setTool('jobs');
  }, [active, log]);

  const applyRec = useCallback((r: OptimizationRecommendation) => {
    setPendingOp(r.operationConfig);
    log(`recommendation staged: ${r.action}`);
    setTool('processor');
  }, [log]);

  // ---- keyboard ----
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        fileInputRef.current?.click();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (tool === 'multiplexer') enqueueMux();
      } else if (e.key === ' ') {
        const v = document.querySelector('video');
        if (v && tool === 'inspector') {
          e.preventDefault();
          if (v.paused) void v.play().catch(() => undefined);
          else v.pause();
        }
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [tool, enqueueMux]);

  const runningJobs = jobs.filter((j) => j.status === 'running').length;

  if (tool === 'home') {
    return (
      <div className="min-h-full">
        <AppBackdrop />
        <div className="relative z-10">
          <Home
          recent={recent}
          jobs={jobs}
          loading={loading}
          error={homeError}
          onFiles={(f, dest) => { void loadFiles(f).then(() => setTool(dest === 'inspect' ? 'inspector' : 'multiplexer')); }}
          onSample={onSample}
          onNavigate={(t) => setTool(t)}
          fileInputRef={fileInputRef}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <AppBackdrop />
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-zinc-800/80 bg-black/55 px-3 py-1.5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button onClick={() => setTool('home')} className="flex items-center gap-2" aria-label="BrowserFF home">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-red-600 text-[11px] font-bold text-white">B</span>
            <span className="text-[13px] font-semibold tracking-tight text-zinc-100">BrowserFF</span>
          </button>
          <nav className="mono hidden items-center gap-1 text-[11px] md:flex" aria-label="Sources">
            {sources.map((s) => (
              <button
                key={s.id}
                onClick={() => { setActiveId(s.id); setTool('inspector'); }}
                className={`max-w-[160px] truncate rounded px-2 py-1 ${s.id === active?.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
                title={s.name}
              >
                {s.name}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {runningJobs > 0 && (
            <button onClick={() => setTool('jobs')} className="mono rounded border border-sky-900 bg-sky-950/50 px-2 py-0.5 text-[11px] text-sky-200">
              {runningJobs} running
            </button>
          )}
          <span className="mono flex items-center gap-1.5 rounded border border-emerald-900 bg-emerald-950/40 px-2 py-0.5 text-[10px] text-emerald-300">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" /> LOCAL
          </span>
          <button onClick={() => fileInputRef.current?.click()} className="mono rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-500">
            + open <span className="text-zinc-600">⌃O</span>
          </button>
        </div>
      </header>
      <input ref={fileInputRef} type="file" multiple accept="video/*,audio/*,.mkv,.mov,.srt,.vtt" className="hidden" onChange={(e) => { if (e.target.files) void loadFiles([...e.target.files]); e.target.value = ''; }} />

      <div className="relative z-10 flex flex-1">
        <aside className="hidden w-44 shrink-0 border-r border-zinc-800/80 bg-black/35 p-2 backdrop-blur-md md:block" aria-label="Tools">
          <ul className="space-y-0.5">
            {TOOLS.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => setTool(t.id)}
                  title={`${t.label} — ${t.hint}`}
                  className={`w-full rounded px-2.5 py-1.5 text-left ${tool === t.id ? 'bg-red-600/15 text-red-100' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}`}
                >
                  <span className="block text-[12px] font-medium">{t.label}</span>
                  <span className="mono block text-[10px] opacity-60">{t.hint}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mono mt-3 px-2 text-[10px] leading-relaxed text-zinc-600">⌃O open<br />⌃↵ start mux<br />space play</p>
        </aside>

        <main className="min-w-0 flex-1 p-3">
          <nav className="mb-2 flex gap-1 overflow-x-auto md:hidden" aria-label="Tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTool(t.id)}
                className={`mono shrink-0 rounded border px-2 py-1 text-[11px] ${tool === t.id ? 'border-red-800 bg-red-950/40 text-red-100' : 'border-zinc-800 text-zinc-400'}`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {sources.length === 0 && tool !== 'codecs' && tool !== 'jobs' && (
            <EmptyState onOpen={() => fileInputRef.current?.click()} />
          )}
          {tool === 'multiplexer' && (
            <Multiplexer
              sources={sources}
              selections={[...selections].sort((a, b) => a.order - b.order)}
              container={muxContainer}
              title={muxTitle}
              plan={plan}
              busy={muxBusy}
              dryRun={dryRunMsg}
              onToggle={(key) => setSelections((prev) => prev.map((s) => (s.key === key ? { ...s, include: !s.include } : s)))}
              onMove={(key, dir) => setSelections((prev) => {
                const sorted = [...prev].sort((a, b) => a.order - b.order);
                const i = sorted.findIndex((s) => s.key === key);
                const j = i + dir;
                if (i < 0 || j < 0 || j >= sorted.length) return prev;
                const next = [...sorted];
                [next[i], next[j]] = [next[j], next[i]];
                return next.map((s, order) => ({ ...s, order }));
              })}
              onReorder={(keys) => setSelections((prev) => {
                const map = new Map(prev.map((s) => [s.key, s]));
                return keys.map((k, order) => ({ ...(map.get(k) as MuxTrackSelection), order }))
                  .concat(prev.filter((s) => !keys.includes(s.key)).map((s, i) => ({ ...s, order: keys.length + i })));
              })}
              onContainer={setMuxContainer}
              onTitle={(t) => { setMuxTitle(t); setDryRunMsg(null); }}
              onSelectTrack={setSelectedSelKey}
              selectedKey={selectedSelKey}
              onPropChange={(key, patch) => setSelections((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))}
              onRemoveSource={removeSource}
              onAddFiles={(f) => void loadFiles(f)}
              onEnqueue={enqueueMux}
              onDryRun={() => void dryRun()}
              onApplyMuxPreset={(p) => {
                setMuxContainer(p.container);
                setMuxTitle(p.title);
                setSelections((prev) => prev.map((s) => ({
                  ...s,
                  include: s.kind === 'video' ? p.includeVideo : s.kind === 'audio' ? p.includeAudio : p.includeSubtitles,
                })));
                log(`mux preset applied: ${p.name}`);
              }}
            />
          )}
          {tool === 'inspector' && (active ? <WorkspaceView source={active} onLog={log} extraMarkers={chapters.map((c) => ({ id: c.id, time: c.start, label: c.title }))} /> : <EmptyState onOpen={() => fileInputRef.current?.click()} />)}
          {tool === 'chapters' && (
            <ChapterEditor
              chapters={chapters}
              duration={active?.metadata?.duration ?? null}
              currentTime={0}
              onChange={setChapters}
              onSeek={() => setTool('inspector')}
            />
          )}
          {tool === 'header' && (
            <HeaderEditor source={active} title={muxTitle} onTitle={setMuxTitle} onApplyTitle={applyTitle} busy={false} />
          )}
          {tool === 'extract' && (
            <Extract sources={sources} selection={extractSel} onSelect={setExtractSel} onEnqueue={enqueueExtract} busy={false} onInspectFrame={() => setTool('inspector')} />
          )}
          {tool === 'compressor' && (active ? (
            <Compressor source={active} extensions={extensions} onEnqueue={enqueueTranscode} onGotoMultiplexer={() => setTool('multiplexer')} log={log} />
          ) : <EmptyState onOpen={() => fileInputRef.current?.click()} />)}
          {tool === 'splitjoin' && (
            <SplitJoin
              sources={sources}
              chapters={chapters}
              log={log}
              onSplit={(file, plan) => {
                plan.configs.forEach((config, i) => {
                  const label = config.label;
                  jobQueue.enqueue('transcode', label, `split segment ${i + 1}/${plan.configs.length}`, { file, config, label, outputName: plan.names[i] });
                });
                setTool('jobs');
              }}
              onJoin={(files, cfg) => {
                jobQueue.enqueue('join', cfg.label, `${files.length} files → ${cfg.container.toUpperCase()}`, { files, config: cfg, label: cfg.label });
                log(`queued join (${cfg.label})`);
                setTool('jobs');
              }}
            />
          )}
          {tool === 'processor' && (active ? (            <ProcessorView
              source={active}
              projectId={projectIds.current.get(active.id) ?? null}
              initial={pendingOp}
              history={history}
              onHistory={(h) => {
                setHistory((prev) => [h, ...prev].slice(0, 50));
                const pid = projectIds.current.get(active.id);
                if (pid) appendHistory(pid, h).catch(() => undefined);
              }}
              onLog={log}
              lines={lines}
            />
          ) : <EmptyState onOpen={() => fileInputRef.current?.click()} />)}
          {tool === 'analyzer' && (active?.metadata ? (
            <div className="grid gap-3 xl:grid-cols-2">
              <div className="space-y-3">
                <Analyzer size={active.size} meta={active.metadata} />
                <TrackContrib meta={active.metadata} size={active.size} onOpenMux={() => setTool('multiplexer')} onOpenCompressor={() => setTool('compressor')} />
              </div>
              <div className="space-y-3">
                <Recommendations meta={active.metadata} size={active.size} onApply={applyRec} />
                <MediaReportPanel
                  source={active}
                  onQueue={() => {
                    jobQueue.enqueue('analyze', `Analyze ${active.name}`, 'media report', { file: active.file, name: active.name, size: active.size });
                    log(`queued analysis job for ${active.name}`);
                    setTool('jobs');
                  }}
                />
                <IntegrityPanel source={active} />
              </div>
            </div>
          ) : <EmptyState onOpen={() => fileInputRef.current?.click()} />)}
          {tool === 'jobs' && (
            <JobsView jobs={jobs} onCancel={(id) => jobQueue.cancel(id)} onRetry={(id) => jobQueue.retry(id)} onRemove={(id) => jobQueue.remove(id)} onDuplicate={(id) => jobQueue.duplicate(id)} />
          )}
          {tool === 'codecs' && (
            <CodecsView native={native} nativeLoading={nativeLoading} extensions={extensions} onLoadExtension={(id) => void loadExt(id)} serverUrl={import.meta.env.VITE_MEDIABUNNY_SERVER_URL ?? null} />
          )}
        </main>
      </div>
    </div>
  );
}

function EmptyState({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-700 p-10 text-center">
      <p className="text-[14px] text-zinc-300">No media loaded</p>
      <button onClick={onOpen} className="mt-3 rounded bg-red-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-red-500">Open media</button>
    </div>
  );
}

function Home(props: {
  recent: ProjectRecord[];
  jobs: JobRecord[];
  loading: boolean;
  error: string | null;
  onFiles: (f: File[], dest: 'mux' | 'inspect') => void;
  onSample: () => void;
  onNavigate: (t: ToolId) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const dest = useRef<'mux' | 'inspect'>('mux');
  const pick = (d: 'mux' | 'inspect') => { dest.current = d; props.fileInputRef.current?.click(); };
  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-12">
      <section className="relative flex flex-col justify-center overflow-hidden px-2 py-14 md:px-8 md:py-20">
        <div className="relative z-10">
          <p className="mono text-[11px] tracking-[0.25em] text-red-500">BROWSER-NATIVE MEDIA WORKBENCH</p>
          <h1 className="mt-3 text-5xl font-semibold tracking-tight text-zinc-50">
            <TextGenerate text="Analyze. Remux. Extract. Compress." />
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-zinc-400">
            A browser-native media engineering lab powered by Mediabunny and WebCodecs.
            Inspect real containers, copy streams without re-encoding, and process everything locally.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <MovingBorderButton onClick={() => pick('mux')} disabled={props.loading}>
              Open media
            </MovingBorderButton>
            <button onClick={props.onSample} disabled={props.loading} className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-5 py-2.5 text-[13px] font-medium text-zinc-200 transition-colors hover:border-zinc-500 disabled:opacity-50">
              Try sample
            </button>
            <button onClick={() => pick('inspect')} disabled={props.loading} className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-5 py-2.5 text-[13px] font-medium text-zinc-200 transition-colors hover:border-zinc-500 disabled:opacity-50">
              Inspect file
            </button>
          </div>
          <p className="mono mt-4 flex items-center gap-2 text-[11px] text-emerald-300/90">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" /> LOCAL PROCESSING — no source media uploaded.
          </p>
        </div>
      </section>
      <input ref={props.fileInputRef} type="file" multiple accept="video/*,audio/*,.mkv,.mov,.srt,.vtt" className="hidden" onChange={(e) => { if (e.target.files) props.onFiles([...e.target.files], dest.current); e.target.value = ''; }} />

      {props.error && <div role="alert" className="mt-4 rounded-md border border-red-900 bg-red-950/50 p-3 text-[13px] text-red-200">{props.error}</div>}

      <BentoGrid className="mt-6">
        <BentoCard title="Multiplexer" description="Build outputs from tracks across files. Copy streams, reorder, rename, set flags." meta="REMUX · NO RE-ENCODE" accent="bg-emerald-500" span onClick={() => props.onNavigate('multiplexer')} />
        <BentoCard title="Inspector" description="mkvinfo-style trees, timeline, frames." meta="MEDIAINFO · FRAMES" onClick={() => props.onNavigate('inspector')} />
        <BentoCard title="Split & Join" description="Cut on keyframes, split by size, append files." meta="CUT · APPEND" onClick={() => props.onNavigate('splitjoin')} />
        <BentoCard title="Compressor" description="Smart presets with resolved strategies and measured results." meta="SIZE · QUALITY" onClick={() => props.onNavigate('compressor')} />
        <BentoCard title="Extract" description="Codec-aware stream copy into valid containers." meta="COPY ONLY" accent="bg-sky-500" onClick={() => props.onNavigate('extract')} />
        <BentoCard title="Analyzer" description="Why is this file large? Measured breakdowns." meta="DIAGNOSE" accent="bg-violet-500" onClick={() => props.onNavigate('analyzer')} />
      </BentoGrid>

      <div className="mt-8 grid gap-3 md:grid-cols-2">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Recent">
          <h2 className="mono text-[10px] tracking-[0.18em] text-zinc-500">RECENT PROJECTS</h2>
          {props.recent.length === 0 && <p className="mono mt-2 text-[11px] text-zinc-600">None yet.</p>}
          <ul className="mt-2 space-y-1">
            {props.recent.slice(0, 6).map((r) => (
              <li key={r.id} className="mono flex justify-between text-[11px] text-zinc-400">
                <span className="truncate">{r.name}</span>
                <span className="shrink-0 text-zinc-600">{formatBytes(r.size)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Recent jobs">
          <h2 className="mono text-[10px] tracking-[0.18em] text-zinc-500">RECENT JOBS</h2>
          {props.jobs.length === 0 && <p className="mono mt-2 text-[11px] text-zinc-600">No jobs yet.</p>}
          <ul className="mt-2 space-y-1">
            {props.jobs.slice(0, 6).map((j) => (
              <li key={j.id} className="mono flex justify-between text-[11px] text-zinc-400">
                <span className="truncate">{j.label}</span>
                <span className="shrink-0 text-zinc-600">{j.status}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
