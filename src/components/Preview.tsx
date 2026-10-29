import { useEffect, useRef, useState } from 'react';
import type { Marker } from '../types';
import { formatDuration } from '../lib/format';
import { openInput } from '../lib/mediabunny/reader';
import { canvasToBlob, grabCanvas, trackAt } from '../lib/mediabunny/frames';

export function Preview(props: {
  url: string;
  markers: Marker[];
  range: { start: number | null; end: number | null };
  currentTime: number;
  onTime: (t: number) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  file?: File;
}) {
  const { videoRef, file, currentTime } = props;
  const [videoError, setVideoError] = useState(false);
  const [canvasUrl, setCanvasUrl] = useState<string | null>(null);
  const [decoding, setDecoding] = useState(false);

  useEffect(() => {
    setVideoError(false);
    setCanvasUrl(null);
  }, [props.url]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const fn = () => props.onTime(el.currentTime);
    el.addEventListener('timeupdate', fn);
    el.addEventListener('seeked', fn);
    return () => { el.removeEventListener('timeupdate', fn); el.removeEventListener('seeked', fn); };
  }, [videoRef, props]);

  useEffect(() => {
    if (!videoError || !file) return;
    let cancelled = false;
    setDecoding(true);
    (async () => {
      try {
        const input = await openInput(file);
        try {
          const track = await trackAt(input);
          if (!track || cancelled) return;
          const got = await grabCanvas(track, currentTime, 854);
          if (got && !cancelled) {
            const blob = await canvasToBlob(got.canvas, 'image/jpeg', 0.85);
            setCanvasUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return URL.createObjectURL(blob);
            });
          }
        } finally {
          input.dispose();
        }
      } catch {
        /* fallback best-effort */
      } finally {
        if (!cancelled) setDecoding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [videoError, file, currentTime]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-zinc-800 bg-black">
      {videoError ? (
        <div className="relative aspect-video w-full bg-zinc-950 flex flex-col items-center justify-center">
          {canvasUrl ? (
            <img src={canvasUrl} alt="Decoded preview frame" className="h-full w-full object-contain" />
          ) : (
            <p className="mono text-[12px] text-zinc-500">{decoding ? 'Decoding frame…' : 'Native video playback unsupported for this container (MKV)'}</p>
          )}
          <div className="absolute top-2 left-2 rounded bg-black/75 px-2 py-1 text-[11px] mono text-amber-300 border border-zinc-800">
            Mediabunny Frame Fallback · {formatDuration(currentTime)}
          </div>
        </div>
      ) : (
        <video
          ref={videoRef}
          src={props.url}
          controls
          playsInline
          preload="metadata"
          onError={() => setVideoError(true)}
          className="aspect-video w-full bg-black"
        />
      )}
    </div>
  );
}

export function Timeline(props: {
  duration: number | null;
  currentTime: number;
  range: { start: number | null; end: number | null };
  markers: Marker[];
  pins?: Marker[];
  thumbs: Array<{ t: number; url: string | null }>;
  onSeek: (t: number) => void;
  onSetRange: (r: { start: number | null; end: number | null }) => void;
  onAddMarker: () => void;
  onRemoveMarker: (id: string) => void;
}) {
  const dur = props.duration && props.duration > 0 ? props.duration : 0;
  const barRef = useRef<HTMLDivElement>(null);

  const seekFromClientX = (clientX: number) => {
    if (!dur || !barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const t = Math.min(dur, Math.max(0, ((clientX - rect.left) / rect.width) * dur));
    props.onSeek(t);
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-center justify-between">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">TIMELINE</h3>
        <div className="mono flex items-center gap-3 text-[11px] text-zinc-400">
          <span>t=<span className="text-zinc-100">{formatDuration(props.currentTime)}</span></span>
          <span>range=<span className="text-zinc-100">{formatDuration(props.range.start)} → {formatDuration(props.range.end)}</span></span>
        </div>
      </div>

      <div
        ref={barRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={Math.round(props.currentTime)}
        tabIndex={0}
        className="relative mt-2 h-16 cursor-pointer overflow-hidden rounded bg-zinc-950 touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          seekFromClientX(e.clientX);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') props.onSeek(Math.max(0, props.currentTime - 1));
          if (e.key === 'ArrowRight') props.onSeek(Math.min(dur, props.currentTime + 1));
          if (e.key === 'Home') props.onSeek(0);
        }}
      >
        <div className="absolute inset-0 flex">
          {props.thumbs.map((th, i) => (
            <div key={i} className="h-full flex-1 overflow-hidden border-r border-black/60">
              {th.url
                ? <img src={th.url} alt="" className="h-full w-full object-cover opacity-80" draggable={false} />
                : <div className="h-full w-full bg-zinc-900" />}
            </div>
          ))}
        </div>
        {props.range.start != null && props.range.end != null && dur > 0 && (
          <div
            className="absolute top-0 h-full border-x border-sky-400/80 bg-sky-400/15"
            style={{ left: `${(props.range.start / dur) * 100}%`, width: `${((props.range.end - props.range.start) / dur) * 100}%` }}
          />
        )}
        {dur > 0 && (
          <div className="absolute top-0 h-full w-px bg-white" style={{ left: `${(props.currentTime / dur) * 100}%` }} />
        )}
        {[...props.markers, ...(props.pins ?? [])].map((m) => (
          <div key={m.id} className="absolute top-0 h-full w-px bg-amber-400" style={{ left: dur ? `${(m.time / dur) * 100}%` : '0%' }} title={m.label} />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className="rounded border border-zinc-700 px-2 py-1 text-[12px] hover:border-zinc-500" onClick={() => props.onSetRange({ start: props.currentTime, end: props.range.end })}>Set start</button>
        <button className="rounded border border-zinc-700 px-2 py-1 text-[12px] hover:border-zinc-500" onClick={() => props.onSetRange({ start: props.range.start, end: props.currentTime })}>Set end</button>
        <button className="rounded border border-zinc-700 px-2 py-1 text-[12px] hover:border-zinc-500" onClick={() => props.onSetRange({ start: null, end: null })}>Clear range</button>
        <button className="rounded border border-zinc-700 px-2 py-1 text-[12px] hover:border-zinc-500" onClick={props.onAddMarker}>Add marker</button>
        {props.markers.map((m) => (
          <button key={m.id} className="mono rounded border border-amber-900 bg-amber-950/40 px-2 py-1 text-[11px] text-amber-200" title="Remove marker" onClick={() => props.onRemoveMarker(m.id)}>
            ◆ {formatDuration(m.time)} ✕
          </button>
        ))}
      </div>
    </div>
  );
}
