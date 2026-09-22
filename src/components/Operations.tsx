import { useState } from 'react';
import type { OperationConfig } from '../types';
import { ffmpegPreview } from '../lib/ffmpeg';
import { saveOutput } from '../lib/folder';
import { outputFilename } from '../lib/mediabunny/exporter';
import type { ProcessedOutput } from '../types';
import { formatBytes } from '../lib/format';

export function Operations(props: {
  inputName: string;
  duration: number | null;
  range: { start: number | null; end: number | null };
  hasVideo: boolean;
  hasAudio: boolean;
  busy: boolean;
  initial: OperationConfig | null;
  onRun: (cfg: OperationConfig) => void;
}) {
  const [kind, setKind] = useState<OperationConfig['kind']>(props.initial?.kind ?? 'convert');
  const [container, setContainer] = useState<'mp4' | 'webm'>(props.initial?.container ?? 'mp4');
  const [width, setWidth] = useState<number>(props.initial?.width ?? 1280);
  const [keepSize, setKeepSize] = useState(!props.initial?.width);
  const [videoCodec, setVideoCodec] = useState<NonNullable<OperationConfig['videoCodec']>>(props.initial?.videoCodec ?? 'avc');
  const [quality, setQuality] = useState(props.initial?.videoQuality ?? 0.7);
  const [frameRate, setFrameRate] = useState<number | ''>(props.initial?.frameRate ?? '');
  const [audioCodec, setAudioCodec] = useState<NonNullable<OperationConfig['audioCodec']>>(props.initial?.audioCodec ?? 'aac');

  const cfg: OperationConfig = {
    kind,
    container,
    width: !keepSize && (kind === 'resize' || kind === 'transcode' || kind === 'convert' || kind === 'clip') ? width : undefined,
    height: !keepSize && kind === 'resize' ? Math.round((width * 9) / 16) : undefined,
    videoCodec: kind === 'extract-audio' ? undefined : kind === 'remove-audio' ? undefined : videoCodec,
    videoQuality: quality,
    frameRate: frameRate === '' ? undefined : Number(frameRate),
    audioCodec: kind === 'remove-audio' ? 'none' : kind === 'extract-audio' ? (audioCodec === 'none' ? 'aac' : audioCodec) : audioCodec,
    start: (kind === 'trim' || kind === 'clip') ? (props.range.start ?? undefined) : undefined,
    end: (kind === 'trim' || kind === 'clip') ? (props.range.end ?? undefined) : undefined,
    label: `${kind} → ${container}`,
  };

  const canRun = !props.busy && (kind !== 'trim' && kind !== 'clip' ? true : cfg.start != null && cfg.end != null && cfg.end > cfg.start);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">OPERATION</h3>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-[12px] text-zinc-400">Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as OperationConfig['kind'])} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
            <option value="convert">Convert</option>
            <option value="trim">Trim</option>
            <option value="clip">Clip (range)</option>
            <option value="resize">Resize</option>
            <option value="transcode">Transcode</option>
            <option value="extract-audio">Extract audio</option>
            <option value="remove-audio">Remove audio</option>
          </select>
        </label>
        <label className="text-[12px] text-zinc-400">Container
          <select value={container} onChange={(e) => setContainer(e.target.value as 'mp4' | 'webm')} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
            <option value="mp4">MP4</option>
            <option value="webm">WebM</option>
          </select>
        </label>
        {(kind === 'resize' || kind === 'transcode' || kind === 'convert' || kind === 'clip') && (
          <label className="col-span-2 flex items-center gap-2 text-[12px] text-zinc-400">
            <input type="checkbox" checked={keepSize} onChange={(e) => setKeepSize(e.target.checked)} />
            Keep original resolution
            {!keepSize && (
              <select value={width} onChange={(e) => setWidth(Number(e.target.value))} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100">
                <option value={640}>640w</option>
                <option value={854}>854w</option>
                <option value={1280}>1280w</option>
                <option value={1920}>1920w</option>
              </select>
            )}
          </label>
        )}
        {kind !== 'extract-audio' && kind !== 'remove-audio' && (
          <label className="text-[12px] text-zinc-400">Video codec
            <select value={videoCodec} onChange={(e) => setVideoCodec(e.target.value as NonNullable<OperationConfig['videoCodec']>)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
              <option value="avc">H.264</option>
              <option value="vp9">VP9</option>
              <option value="copy">Copy (no re-encode)</option>
            </select>
          </label>
        )}
        <label className="text-[12px] text-zinc-400">Audio
          <select value={audioCodec} onChange={(e) => setAudioCodec(e.target.value as NonNullable<OperationConfig['audioCodec']>)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100">
            <option value="aac">AAC</option>
            <option value="opus">Opus</option>
            <option value="copy">Copy</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="text-[12px] text-zinc-400">Quality
          <input type="range" min={0.1} max={1} step={0.05} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="mt-2 w-full" />
        </label>
        <label className="text-[12px] text-zinc-400">FPS (blank = keep)
          <input value={frameRate} onChange={(e) => setFrameRate(e.target.value === '' ? '' : Number(e.target.value))} placeholder="e.g. 30" inputMode="numeric" className="mono mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100" />
        </label>
      </div>

      {(kind === 'trim' || kind === 'clip') && !(cfg.start != null && cfg.end != null && cfg.end > cfg.start) && (
        <p className="mt-2 text-[12px] text-amber-300">Select a valid range on the timeline first (Set start / Set end).</p>
      )}

      <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950 p-2">
        <p className="mono text-[10px] tracking-[0.15em] text-zinc-500">COMMAND PREVIEW — REFERENCE ONLY</p>
        <p className="mono mt-1 break-all text-[11px] text-zinc-300">{ffmpegPreview(props.inputName, cfg, `output.${container}`)}</p>
        <p className="mono mt-1 text-[10px] text-zinc-600">BrowserFF performs this workflow using Mediabunny/WebCodecs, not FFmpeg.</p>
      </div>

      <button
        disabled={!canRun}
        onClick={() => props.onRun(cfg)}
        className="mt-3 w-full rounded-md bg-sky-500 px-4 py-2 text-[13px] font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {props.busy ? 'Processing…' : 'Run operation locally'}
      </button>
      {!props.hasVideo && <p className="mono mt-2 text-[10px] text-zinc-600">Audio-only input: video options are ignored.</p>}
      {!props.hasAudio && kind === 'extract-audio' && <p className="mt-2 text-[12px] text-amber-300">This file has no audio track.</p>}
    </div>
  );
}

export function Compare({ original, output, inputName }: { original: { size: number }; output: ProcessedOutput; inputName: string }) {
  const red = original.size > 0 ? ((original.size - output.size) / original.size) * 100 : 0;
  const ov = output.metadata?.primaryVideo;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">ORIGINAL VS OUTPUT</h3>
      <div className="mono mt-2 grid grid-cols-3 gap-2 text-center">
        <div className="rounded border border-zinc-800 p-2">
          <p className="text-[10px] text-zinc-500">ORIGINAL</p>
          <p className="text-[13px] text-zinc-100">{formatBytes(original.size)}</p>
        </div>
        <div className="rounded border border-sky-900 p-2">
          <p className="text-[10px] text-sky-400">OUTPUT</p>
          <p className="text-[13px] text-zinc-100">{formatBytes(output.size)}</p>
        </div>
        <div className="rounded border border-emerald-900 p-2">
          <p className="text-[10px] text-emerald-400">REDUCTION</p>
          <p className="text-[13px] text-zinc-100">{red.toFixed(1)}%</p>
        </div>
      </div>
      <p className="mono mt-2 text-[11px] text-zinc-400">
        {ov ? `${ov.displayWidth ?? '?'}×${ov.displayHeight ?? '?'} · ${(ov.codec ?? '?').toUpperCase()} · ` : ''}{output.container.toUpperCase()} · {Math.round(output.durationMs)}ms encode
      </p>
      <div className="mt-2 flex gap-2">
        <button className="rounded border border-zinc-700 px-3 py-1.5 text-[12px] hover:border-zinc-500" onClick={() => { void saveOutput(output.blob, outputFilename(inputName, output.container, output.config.kind)); }}>Export</button>
        <a className="rounded border border-zinc-700 px-3 py-1.5 text-[12px] text-zinc-200 hover:border-zinc-500" href={output.objectUrl} target="_blank" rel="noreferrer">Preview output</a>
      </div>
    </div>
  );
}
