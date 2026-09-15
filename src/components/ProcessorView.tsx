import { useRef, useState } from 'react';
import type { HistoryEntry, OperationConfig, ProcessedOutput, ProcessingProgress, SourceFileEntry } from '../types';
import { formatBytes, formatDuration, uid } from '../lib/format';
import { describeRunError, runOperation, type RunHandle } from '../lib/mediabunny/transcoder';
import { appendHistory } from '../lib/db';
import { Compare, Operations } from './Operations';
import { Console, Pipeline } from './Pipeline';

/** Dedicated transcode/transform tool. Immediate local run with progress, compare, history. */
export function ProcessorView(props: {
  source: SourceFileEntry;
  projectId: string | null;
  initial: OperationConfig | null;
  history: HistoryEntry[];
  onHistory: (h: HistoryEntry) => void;
  onLog: (s: string) => void;
  lines: string[];
}) {
  const [progress, setProgress] = useState<ProcessingProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<ProcessedOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runRef = useRef<RunHandle | null>(null);
  const meta = props.source.metadata;

  const run = async (cfg: OperationConfig) => {
    if (runRef.current) return;
    setBusy(true);
    setError(null);
    setProgress({ stage: 'demux', progress: 0, processedSeconds: null, elapsedMs: 0, fps: null });
    props.onLog(`transcode ${cfg.kind} → ${cfg.container}`);
    const handle = runOperation(props.source.file, cfg, setProgress);
    runRef.current = handle;
    try {
      const result = await handle.promise;
      setOutput(result);
      props.onLog(`done: ${formatBytes(props.source.size)} → ${formatBytes(result.size)}`);
      const entry: HistoryEntry = {
        id: uid('h'), at: Date.now(), title: cfg.label,
        detail: `${formatBytes(props.source.size)} → ${formatBytes(result.size)}${cfg.start != null ? ` · ${formatDuration(cfg.start)}→${formatDuration(cfg.end)}` : ''}`,
        config: cfg,
      };
      props.onHistory(entry);
      if (props.projectId) appendHistory(props.projectId, entry).catch(() => undefined);
    } catch (e) {
      const msg = describeRunError(e);
      setError(msg);
      props.onLog(`error: ${msg}`);
    } finally {
      runRef.current = null;
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <Operations
          inputName={props.source.name}
          duration={meta?.duration ?? null}
          range={{ start: null, end: null }}
          hasVideo={(meta?.videoTracks.length ?? 0) > 0}
          hasAudio={(meta?.audioTracks.length ?? 0) > 0}
          busy={busy}
          initial={props.initial}
          onRun={run}
        />
        <div className="space-y-3">
          <Pipeline
            progress={progress}
            onCancel={() => { void runRef.current?.cancel().then(() => { runRef.current = null; setBusy(false); setProgress(null); props.onLog('cancelled; resources released'); }); }}
          />
          {error && <div role="alert" className="rounded-md border border-red-900 bg-red-950/50 p-3 text-[13px] text-red-200">{error}</div>}
          {output && <Compare original={{ size: props.source.size }} output={output} inputName={props.source.name} />}
        </div>
      </div>
      <Console lines={props.lines} history={props.history} />
    </div>
  );
}
