import { useEffect, useRef, useState } from 'react';
import type { Marker, SourceFileEntry } from '../types';
import { formatDuration, uid } from '../lib/format';
import { openInput } from '../lib/mediabunny/reader';
import { cachedThumbnail, clearThumbCache, trackAt } from '../lib/mediabunny/frames';
import { Inspector } from './Inspector';
import { Preview, Timeline } from './Preview';
import { ContactSheet, FrameInspector } from './Frames';

/** Single-file inspector workspace: preview, timeline, frames, metadata tree. */
export function WorkspaceView({ source, onLog, extraMarkers = [] }: { source: SourceFileEntry; onLog: (s: string) => void; extraMarkers?: Marker[] }) {
  const [currentTime, setCurrentTime] = useState(0);
  const [range, setRange] = useState<{ start: number | null; end: number | null }>({ start: null, end: null });
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [thumbs, setThumbs] = useState<Array<{ t: number; url: string | null }>>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const meta = source.metadata;
  const dur = meta?.duration ?? null;

  useEffect(() => {
    setCurrentTime(0);
    setRange({ start: null, end: null });
    setMarkers([]);
    setThumbs([]);
    clearThumbCache();
    if (!meta?.duration || !(meta.duration > 0) || (meta.videoTracks.length ?? 0) === 0) return;
    const n = Math.min(12, Math.max(4, Math.floor(meta.duration / 10)));
    const times = Array.from({ length: n }, (_, i) => (meta.duration as number) * ((i + 0.5) / n));
    setThumbs(times.map((t) => ({ t, url: null })));
    let cancelled = false;
    (async () => {
      try {
        const inp = await openInput(source.file);
        try {
          const track = await trackAt(inp);
          if (!track) return;
          for (const t of times) {
            if (cancelled) return;
            try {
              const url = await cachedThumbnail(track, source.id, t, 160);
              if (!cancelled) setThumbs((prev) => prev.map((p) => (Math.abs(p.t - t) < 1e-6 ? { ...p, url } : p)));
            } catch { /* per-thumb failure is non-fatal */ }
          }
        } finally {
          inp.dispose();
        }
      } catch { /* thumbnail strip optional */ }
    })();
    return () => { cancelled = true; };
  }, [source.id, source.file, meta?.duration, meta?.videoTracks.length]);

  const seek = (t: number) => {
    const el = videoRef.current;
    if (el) { try { el.currentTime = t; } catch { /* ignore */ } }
    setCurrentTime(t);
  };

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="space-y-3">
        <Preview url={source.objectUrl} markers={[...markers, ...extraMarkers]} range={range} currentTime={currentTime} onTime={setCurrentTime} videoRef={videoRef} />
        <Timeline
          duration={dur}
          currentTime={currentTime}
          range={range}
          markers={[...markers, ...extraMarkers]}
          thumbs={thumbs}
          onSeek={seek}
          onSetRange={setRange}
          onAddMarker={() => {
            setMarkers((prev) => [...prev, { id: uid('m'), time: currentTime, label: formatDuration(currentTime) }]);
            onLog(`marker ${formatDuration(currentTime)}`);
          }}
          onRemoveMarker={(id) => setMarkers((prev) => prev.filter((m) => m.id !== id))}
        />
        <div className="grid gap-3 lg:grid-cols-2">
          <FrameInspector file={source.file} time={currentTime} />
          <ContactSheet file={source.file} duration={dur} />
        </div>
      </section>
      <aside className="space-y-3">
        <Inspector source={source} />
      </aside>
    </div>
  );
}
