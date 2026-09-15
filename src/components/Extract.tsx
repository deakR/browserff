import { useMemo } from 'react';
import type { SourceFileEntry } from '../types';
import { extractionTargets } from '../lib/codecs';
import { extractPreview } from '../lib/ffmpeg';
import { formatBitrate, formatBytes } from '../lib/format';

export interface ExtractTarget {
  sourceId: string;
  kind: 'video' | 'audio';
  trackIndex: number;
  targetId: string;
}

/**
 * Codec-aware track extraction. Output choices are derived per track from the
 * engine's own per-format supported-codec lists — never a generic dropdown.
 * Copy-only: when no target supports the codec, extraction is blocked, never
 * silently transcoded.
 */
export function Extract(props: {
  sources: SourceFileEntry[];
  selection: ExtractTarget | null;
  onSelect: (t: ExtractTarget) => void;
  onEnqueue: () => void;
  busy: boolean;
  onInspectFrame: () => void;
}) {
  const src = props.sources.find((s) => s.id === props.selection?.sourceId) ?? null;
  const track = props.selection && src?.metadata
    ? (props.selection.kind === 'video'
      ? src.metadata.videoTracks[props.selection.trackIndex]
      : src.metadata.audioTracks[props.selection.trackIndex])
    : null;
  const targets = useMemo(
    () => extractionTargets(track?.codec ?? null, props.selection?.kind ?? 'audio'),
    [track?.codec, props.selection?.kind],
  );
  const chosen = targets.find((t) => t.formatId === props.selection?.targetId) ?? null;

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Streams available for extraction">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">EXTRACTABLE STREAMS</h3>
        {props.sources.length === 0 && <p className="mono mt-2 text-[11px] text-zinc-600">Open files first (Multiplexer → Add files, or Home → Open Media).</p>}
        <div className="mt-2 space-y-3">
          {props.sources.map((s) => (
            <div key={s.id}>
              <p className="truncate text-[12px] text-zinc-300">{s.name} <span className="mono text-[10px] text-zinc-600">{formatBytes(s.size)}</span></p>
              <ul className="mt-1 space-y-1">
                {(s.metadata?.videoTracks ?? []).map((t) => (
                  <StreamRow
                    key={`v${t.index}`} label={`Video ${t.index + 1} — ${(t.codec ?? '?').toUpperCase()} ${t.displayWidth ?? '?'}×${t.displayHeight ?? '?'}`}
                    active={props.selection?.sourceId === s.id && props.selection.kind === 'video' && props.selection.trackIndex === t.index}
                    onPick={() => {
                      const first = extractionTargets(t.codec, 'video')[0];
                      props.onSelect({ sourceId: s.id, kind: 'video', trackIndex: t.index, targetId: first?.formatId ?? '' });
                    }}
                  />
                ))}
                {(s.metadata?.audioTracks ?? []).map((t) => (
                  <StreamRow
                    key={`a${t.index}`} label={`Audio ${t.index + 1} — ${(t.codec ?? '?').toUpperCase()} ${t.channels ?? '?'}ch ${formatBitrate(t.bitrate ?? t.averageBitrate)}`}
                    active={props.selection?.sourceId === s.id && props.selection.kind === 'audio' && props.selection.trackIndex === t.index}
                    onPick={() => {
                      const first = extractionTargets(t.codec, 'audio')[0];
                      props.onSelect({ sourceId: s.id, kind: 'audio', trackIndex: t.index, targetId: first?.formatId ?? '' });
                    }}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
      <aside className="space-y-3">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Extraction job">
          <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">EXTRACTION — COPY ONLY</h3>
          {!props.selection && <p className="mono mt-2 text-[11px] text-zinc-600">Pick a stream on the left.</p>}
          {props.selection && (
            <>
              <p className="mono mt-2 text-[11px] text-zinc-300">
                {src?.name} · {props.selection.kind} #{props.selection.trackIndex + 1} · {(track?.codec ?? '?').toUpperCase()}
              </p>
              {targets.length === 0 ? (
                <div role="alert" className="mt-2 rounded border border-red-900 bg-red-950/40 p-2 text-[12px] text-red-200">
                  No output format in this engine accepts {(track?.codec ?? 'this').toUpperCase()} for stream copy.
                  Extraction is blocked — BrowserFF will not transcode silently. Transcode in the Processor instead.
                </div>
              ) : (
                <>
                  <div className="mono mt-2 text-[10px] tracking-[0.15em] text-zinc-500">VALID COPY TARGETS (ENGINE)</div>
                  <ul className="mt-1 space-y-1">
                    {targets.map((t) => (
                      <li key={t.formatId}>
                        <button
                          onClick={() => props.onSelect({ ...props.selection as ExtractTarget, targetId: t.formatId })}
                          className={`mono w-full rounded border px-2.5 py-1.5 text-left text-[11px] ${chosen?.formatId === t.formatId ? 'border-sky-700 bg-sky-950/40 text-sky-100' : 'border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-zinc-600'}`}
                        >
                          {t.label} <span className="text-zinc-500">· {t.note}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {chosen && (
                    <>
                      <p className="mono mt-2 break-all text-[11px] text-zinc-500">
                        {extractPreview(src?.name ?? 'input', props.selection.kind, props.selection.trackIndex, `extract.${chosen.ext}`)}
                      </p>
                      <p className="mono text-[10px] text-zinc-600">REFERENCE ONLY — stream copied with Mediabunny, never re-encoded.</p>
                      <button onClick={props.onEnqueue} disabled={props.busy} className="mt-2 w-full rounded bg-red-600 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-red-500 disabled:opacity-40">
                        Extract stream (copy)
                      </button>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </section>
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Other extraction">
          <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">ALSO AVAILABLE</h3>
          <button onClick={props.onInspectFrame} className="mt-2 w-full rounded border border-zinc-700 px-3 py-1.5 text-left text-[12px] hover:border-zinc-500">
            Frame extraction <span className="mono block text-[10px] text-zinc-500">Inspector → Frame Inspector (real decoded frames)</span>
          </button>
          <div className="mt-2 rounded border border-zinc-800 bg-zinc-950/60 p-2">
            <p className="text-[12px] text-zinc-300">Subtitle extraction</p>
            <p className="mono mt-0.5 text-[10px] leading-relaxed text-zinc-500">Unavailable — Mediabunny 1.56.2 exposes no subtitle input tracks. WebVTT authoring into new files is supported via the engine.</p>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
            <p className="text-[12px] text-zinc-300">Attachment export</p>
            <p className="mono mt-0.5 text-[10px] leading-relaxed text-zinc-500">Unavailable — attached-file read API is not exposed by Mediabunny 1.56.2.</p>
          </div>
        </section>
      </aside>
    </div>
  );
}

function StreamRow({ label, active, onPick }: { label: string; active: boolean; onPick: () => void }) {
  return (
    <li>
      <button
        onClick={onPick}
        className={`mono w-full truncate rounded border px-2.5 py-1.5 text-left text-[11px] ${active ? 'border-sky-700 bg-sky-950/40 text-sky-100' : 'border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-zinc-600'}`}
      >
        {label}
      </button>
    </li>
  );
}
