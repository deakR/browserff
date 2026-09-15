import { useState } from 'react';
import type { SourceFileEntry, TrackDisposition } from '../types';
import { aspectRatio, formatBitrate, formatBytes, formatDuration, formatFps, formatHz, formatResolution } from '../lib/format';

function flagsOf(d: TrackDisposition | null): string {
  if (!d) return 'N/A';
  const on = Object.entries(d).filter(([, v]) => v).map(([k]) => k);
  return on.length > 0 ? on.join(', ') : 'none';
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className="shrink-0 text-[12px] text-zinc-500">{k}</dt>
      <dd className="mono text-right text-[12px] text-zinc-200">{v}</dd>
    </div>
  );
}

function Node({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded border border-zinc-800/80 bg-zinc-950/40">
      <button onClick={() => setOpen((x) => !x)} aria-expanded={open} className="flex w-full items-center gap-1.5 px-2 py-1 text-left">
        <span className="mono text-[10px] text-zinc-600">{open ? '▾' : '▸'}</span>
        <span className="mono text-[11px] font-medium tracking-wide text-zinc-300">{title}</span>
      </button>
      {open && <dl className="px-2 pb-1.5">{children}</dl>}
    </div>
  );
}

export function Inspector(props: { source: SourceFileEntry }) {
  const { source } = props;
  const meta = source.metadata;
  return (
    <div className="space-y-1.5">
      <Node title={`${source.name}`}>
        <KV k="Size" v={formatBytes(source.size)} />
      </Node>
      {!meta && !source.loadError && <p className="mono py-2 text-[12px] text-zinc-500">Parsing media…</p>}
      {source.loadError && <div role="alert" className="rounded border border-red-900 bg-red-950/50 p-2 text-[12px] text-red-200">{source.loadError}</div>}
      {meta && (
        <>
          <Node title="Container">
            <KV k="Format" v={meta.container} />
            <KV k="Duration" v={formatDuration(meta.duration)} />
            <KV k="Size" v={formatBytes(source.size)} />
            <KV k="Title" v={meta.title ?? '—'} />
            <KV k="MIME" v={meta.mimeType ?? 'N/A'} />
          </Node>
          {meta.videoTracks.map((t) => (
            <Node key={`v${t.index}`} title={`Video #${t.index + 1}`}>
              <KV k="Codec" v={t.codec ?? 'N/A'} />
              <KV k="Codec details" v={t.codecDescription ?? 'N/A'} />
              <KV k="Resolution" v={formatResolution(t.displayWidth, t.displayHeight)} />
              <KV k="Aspect" v={aspectRatio(t.displayWidth, t.displayHeight)} />
              <KV k="FPS" v={formatFps(t.frameRate)} />
              <KV k="Avg FPS" v={formatFps(t.averageFrameRate)} />
              <KV k="Bitrate" v={formatBitrate(t.bitrate ?? t.averageBitrate)} />
              <KV k="Color" v={t.colorSpace ?? 'N/A'} />
              <KV k="Rotation" v={t.rotation != null ? `${t.rotation}°` : 'N/A'} />
              <KV k="Duration" v={formatDuration(meta.duration)} />
              <KV k="Name" v={t.name ?? '—'} />
              <KV k="Language" v={t.languageCode} />
              <KV k="Flags" v={flagsOf(t.disposition)} />
              <KV k="Decodable" v={t.canDecode ? 'yes' : 'no — browser lacks decoder'} />
            </Node>
          ))}
          {meta.audioTracks.map((t) => (
            <Node key={`a${t.index}`} title={`Audio #${t.index + 1}`}>
              <KV k="Codec" v={t.codec ?? 'N/A'} />
              <KV k="Channels" v={t.channels != null ? String(t.channels) : 'N/A'} />
              <KV k="Sample rate" v={formatHz(t.sampleRate)} />
              <KV k="Bitrate" v={formatBitrate(t.bitrate ?? t.averageBitrate)} />
              <KV k="Duration" v={formatDuration(meta.duration)} />
              <KV k="Name" v={t.name ?? '—'} />
              <KV k="Language" v={t.languageCode} />
              <KV k="Flags" v={flagsOf(t.disposition)} />
              <KV k="Decodable" v={t.canDecode ? 'yes' : 'no — browser lacks decoder'} />
            </Node>
          ))}
          {source.subtitle && (
            <Node title="Subtitle #1 (sidecar)">
              <KV k="Codec" v={source.subtitle.format.toUpperCase()} />
              <KV k="Muxes as" v="WebVTT" />
              <KV k="Size" v={formatBytes(source.subtitle.text.length)} />
            </Node>
          )}
          {meta.videoTracks.length === 0 && meta.audioTracks.length === 0 && !source.subtitle && (
            <Node title="Streams">
              <KV k="Tracks" v="none found" />
            </Node>
          )}
          <Node title="Attachments" defaultOpen={false}>
            <KV k="Status" v="not exposed by engine" />
            <KV k="Note" v="Mediabunny 1.56.2 has no attachment read/write API" />
          </Node>
        </>
      )}
    </div>
  );
}
