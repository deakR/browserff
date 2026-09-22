import { useEffect, useRef, useState, type PointerEvent } from 'react';

export function WipeCompare(props: {
  originalUrl: string;
  previewUrl: string;
  split: number;
  onSplit: (n: number) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const originalRef = useRef<HTMLVideoElement>(null);
  const compressedRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const original = originalRef.current;
    const compressed = compressedRef.current;
    if (!original || !compressed) return;

    const syncTime = () => {
      if (Math.abs(original.currentTime - compressed.currentTime) > 0.12) {
        original.currentTime = compressed.currentTime;
      }
    };

    const syncPlay = () => {
      if (compressed.paused) {
        original.pause();
      } else {
        void original.play().catch(() => undefined);
      }
    };

    const onPlay = () => { setPlaying(true); syncTime(); syncPlay(); };
    const onPause = () => { setPlaying(false); original.pause(); };
    const onSeeking = () => { syncTime(); };
    const onTimeUpdate = () => { syncTime(); };

    compressed.addEventListener('play', onPlay);
    compressed.addEventListener('pause', onPause);
    compressed.addEventListener('seeking', onSeeking);
    compressed.addEventListener('seeked', onSeeking);
    compressed.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      compressed.removeEventListener('play', onPlay);
      compressed.removeEventListener('pause', onPause);
      compressed.removeEventListener('seeking', onSeeking);
      compressed.removeEventListener('seeked', onSeeking);
      compressed.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [props.originalUrl, props.previewUrl]);

  const setSplitFromClientX = (clientX: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0) return;
    const n = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    props.onSplit(n);
  };

  const onDividerPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setSplitFromClientX(e.clientX);
  };

  const onDividerPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    setSplitFromClientX(e.clientX);
  };

  const pct = props.split * 100;

  return (
    <div className="mt-2">
      <div ref={frameRef} className="relative aspect-video w-full overflow-hidden rounded border border-zinc-800 bg-black">
        <video
          ref={originalRef}
          src={props.originalUrl}
          muted
          playsInline
          preload="metadata"
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
        />
        <video
          ref={compressedRef}
          src={props.previewUrl}
          playsInline
          preload="metadata"
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          style={{ clipPath: `inset(0 0 0 ${pct}%)` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 bg-white/80"
          style={{ left: `${pct}%`, width: 2, marginLeft: -1 }}
          aria-hidden
        />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={1000}
          aria-valuenow={Math.round(props.split * 1000)}
          className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 touch-none cursor-ew-resize"
          style={{ left: `${pct}%` }}
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
        />
        <span className="pointer-events-none absolute left-2 top-2 mono text-[10px] tracking-[0.15em] text-white/80">ORIGINAL</span>
        <span className="pointer-events-none absolute right-2 top-2 mono text-[10px] tracking-[0.15em] text-white/80">COMPRESSED</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const el = compressedRef.current;
            if (!el) return;
            if (el.paused) void el.play().catch(() => undefined);
            else el.pause();
          }}
          className="rounded border border-zinc-700 px-2 py-1 text-[12px] text-zinc-200 hover:border-zinc-500"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(props.split * 1000)}
          aria-label="Compare original and compressed"
          onChange={(e) => props.onSplit(Number(e.target.value) / 1000)}
          className="min-w-0 flex-1"
        />
      </div>
    </div>
  );
}
