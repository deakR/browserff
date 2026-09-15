import { useEffect, useMemo, useState } from 'react';
import { canDecodeAudio, canDecodeVideo, canEncodeAudio, canEncodeVideo } from 'mediabunny';
import type { CodecExtensionInfo, MediaCapabilityRow } from '../types';
import { EXTENSIONS } from '../lib/mediabunny/extensions';
import { inputFormats, outputFormats } from '../lib/codecs';

async function probe(set: Array<{ codec: string; video: boolean }>): Promise<MediaCapabilityRow[]> {
  const rows: MediaCapabilityRow[] = [];
  for (const s of set) {
    if (s.video) {
      const [d, e] = await Promise.all([
        canDecodeVideo(s.codec as 'avc').catch(() => false),
        canEncodeVideo(s.codec as 'avc').catch(() => false),
      ]);
      rows.push({ codec: s.codec.toUpperCase(), label: s.codec, video: true, decode: !!d, encode: !!e });
    } else {
      const [d, e] = await Promise.all([
        canDecodeAudio(s.codec as 'aac').catch(() => false),
        canEncodeAudio(s.codec as 'aac').catch(() => false),
      ]);
      rows.push({ codec: s.codec.toUpperCase(), label: s.codec, video: false, decode: !!d, encode: !!e });
    }
  }
  return rows;
}

export { probe as probeCapabilities };

export function CodecsView(props: {
  native: MediaCapabilityRow[];
  nativeLoading: boolean;
  extensions: CodecExtensionInfo[];
  onLoadExtension: (id: string) => void;
  serverUrl: string | null;
}) {
  const inputs = useMemo(() => {
    try { return inputFormats(); } catch { return []; }
  }, []);
  const outputs = useMemo(() => {
    try { return outputFormats(); } catch { return []; }
  }, []);

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Native capabilities">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">BROWSER-NATIVE CODECS (MEASURED)</h3>
        {props.nativeLoading && <p className="mono mt-2 text-[11px] text-zinc-500">Probing WebCodecs…</p>}
        {!props.nativeLoading && (
          <table className="mono mt-2 w-full text-[11px]">
            <thead><tr className="text-left text-zinc-500"><th className="py-1 pr-2 font-normal">Codec</th><th className="py-1 pr-2 font-normal">Decode</th><th className="py-1 font-normal">Encode</th></tr></thead>
            <tbody className="divide-y divide-zinc-800/60">
              {props.native.map((r) => (
                <tr key={r.codec}>
                  <td className="py-1 pr-2 text-zinc-200">{r.codec}</td>
                  <td className="py-1 pr-2">{r.decode ? <span className="text-emerald-400">✓ native</span> : <span className="text-zinc-600">—</span>}</td>
                  <td className="py-1">{r.encode ? <span className="text-emerald-400">✓ native</span> : <span className="text-zinc-600">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Extension manager">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">WASM EXTENSION MANAGER</h3>
        <p className="mono mt-1 text-[10px] leading-relaxed text-zinc-600">
          Extensions load on demand into a separate bundle chunk — never in the initial page.
          Tradeoff: extra download ({EXTENSIONS.map((e) => e.id).join(', ')}) and CPU vs native speed.
        </p>
        <ul className="mt-2 space-y-1.5">
          {props.extensions.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-[12px] text-zinc-200">{e.label}</p>
                <p className="mono text-[10px] text-zinc-500">{e.pkg} · ~{e.sizeMB} MB · {e.codecs.join(', ')}</p>
                {e.error && <p className="mono text-[10px] text-red-300">{e.error}</p>}
              </div>
              {e.state === 'loaded'
                ? <span className="mono shrink-0 text-[11px] text-emerald-300">loaded ✓</span>
                : e.state === 'loading'
                  ? <span className="mono shrink-0 text-[11px] text-sky-300">loading…</span>
                  : (
                    <button onClick={() => props.onLoadExtension(e.id)} className="mono shrink-0 rounded border border-zinc-700 px-2 py-1 text-[11px] hover:border-zinc-500">
                      load
                    </button>
                  )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Format matrix">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">SUPPORTED FORMAT MATRIX (ENGINE)</h3>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <div>
            <p className="mono text-[10px] text-zinc-500">READ ({inputs.length} containers)</p>
            <ul className="mono mt-1 space-y-0.5 text-[11px] text-zinc-300">
              {inputs.map((f) => <li key={f.name}>{f.name} <span className="text-zinc-600">{f.mime}</span></li>)}
            </ul>
          </div>
          <div>
            <p className="mono text-[10px] text-zinc-500">WRITE</p>
            <ul className="mt-1 space-y-1.5">
              {outputs.map((o) => (
                <li key={o.id} className="mono text-[11px]">
                  <p className="text-zinc-200">{o.label}</p>
                  <p className="text-zinc-500">v: {o.videoCodecs.join(' ') || '—'}</p>
                  <p className="text-zinc-500">a: {o.audioCodecs.join(' ') || '—'}</p>
                  {o.subtitleCodecs.length > 0 && <p className="text-zinc-500">s: {o.subtitleCodecs.join(' ')}</p>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="Processing mode">
        <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">PROCESSING MODE</h3>
        <p className="mono mt-2 text-[11px] text-emerald-300">● LOCAL — active. Source media never leaves this browser.</p>
        {props.serverUrl
          ? <p className="mono mt-1 text-[11px] text-amber-300">○ SERVER configured at {props.serverUrl} — used only via explicit action.</p>
          : <p className="mono mt-1 text-[11px] leading-relaxed text-zinc-500">○ SERVER — not configured. Set VITE_MEDIABUNNY_SERVER_URL to enable optional server processing for files unsuitable locally. Server mode always requires explicit opt-in per job.</p>}
      </section>

      <SystemStatus serverUrl={props.serverUrl} extensions={props.extensions} />
      <ProcessingPath native={props.native} extensions={props.extensions} serverUrl={props.serverUrl} />
    </div>
  );
}

function browserName(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Unknown';
}

function SystemStatus({ serverUrl, extensions }: { serverUrl: string | null; extensions: CodecExtensionInfo[] }) {
  const [storage, setStorage] = useState('checking…');
  useEffect(() => {
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then((e) => {
        setStorage(e.quota ? `~${Math.round(e.quota / 1024 / 1024 / 1024)} GB quota` : 'available');
      }).catch(() => setStorage('unavailable'));
    } else {
      setStorage('unavailable');
    }
  }, []);
  const loaded = extensions.filter((e) => e.state === 'loaded').length;
  const wc = typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoDecoder' in window && 'AudioEncoder' in window;
  const rows: Array<[string, string]> = [
    ['Browser', `${browserName()} (${navigator.platform || 'unknown platform'})`],
    ['WebCodecs', wc ? 'Available' : 'Unavailable'],
    ['Mediabunny engine', typeof __MEDIABUNNY_VERSION__ !== 'undefined' ? __MEDIABUNNY_VERSION__ : 'bundled'],
    ['WASM extensions', `${loaded} loaded / ${extensions.length} available`],
    ['Workers', 'Worker' in window ? 'Available' : 'Unavailable'],
    ['Storage', storage],
    ['Server', serverUrl ?? 'not configured'],
  ];
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3" aria-label="System status">
      <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">SYSTEM STATUS</h3>
      <dl className="mono mt-1.5 space-y-0.5 text-[11px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-zinc-500">{k}</dt>
            <dd className="truncate text-right text-zinc-200">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const EXT_FOR_CODEC: Record<string, { ext: string; covers: string }> = {
  ac3: { ext: 'ac3', covers: 'decode + encode' },
  eac3: { ext: 'ac3', covers: 'decode + encode' },
  dts: { ext: 'dts', covers: 'decode + encode' },
  aac: { ext: 'aac-encoder', covers: 'encode only' },
  mp3: { ext: 'mp3-encoder', covers: 'encode only' },
  flac: { ext: 'flac-encoder', covers: 'encode only' },
  prores: { ext: 'prores', covers: 'decode only' },
};

function ProcessingPath({ native, extensions, serverUrl }: { native: MediaCapabilityRow[]; extensions: CodecExtensionInfo[]; serverUrl: string | null }) {
  const codecs = ['avc', 'hevc', 'vp9', 'av1', 'prores', 'aac', 'opus', 'mp3', 'vorbis', 'flac', 'ac3', 'eac3', 'dts'];
  const extState = new Map(extensions.map((e) => [e.id, e.state]));
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 xl:col-span-2" aria-label="Processing path">
      <h3 className="mono text-[10px] tracking-[0.18em] text-zinc-500">PROCESSING PATH — NATIVE VS WASM VS SERVER</h3>
      <div className="overflow-x-auto">
        <table className="mono mt-2 w-full min-w-[560px] text-[11px]">
          <thead><tr className="text-left text-zinc-500">
            <th className="py-1 pr-2 font-normal">Codec</th>
            <th className="py-1 pr-2 font-normal">Native</th>
            <th className="py-1 pr-2 font-normal">WASM extension</th>
            <th className="py-1 font-normal">Server</th>
          </tr></thead>
          <tbody className="divide-y divide-zinc-800/60">
            {codecs.map((c) => {
              const n = native.find((r) => r.label === c);
              const ext = EXT_FOR_CODEC[c];
              const loaded = ext ? extState.get(ext.ext) === 'loaded' : false;
              return (
                <tr key={c}>
                  <td className="py-1 pr-2 text-zinc-200">{c.toUpperCase()}</td>
                  <td className="py-1 pr-2">{n ? (n.decode || n.encode ? <span className="text-emerald-400">✓ {n.decode && n.encode ? 'dec+enc' : n.decode ? 'dec' : 'enc'}</span> : <span className="text-zinc-600">✗</span>) : <span className="text-zinc-600">?</span>}</td>
                  <td className="py-1 pr-2">
                    {!ext ? <span className="text-zinc-600">—</span>
                      : loaded ? <span className="text-emerald-300">✓ loaded ({ext.covers})</span>
                      : <span className="text-amber-300/90">available ({ext.covers})</span>}
                  </td>
                  <td className="py-1">{serverUrl ? <span className="text-amber-300/90">opt-in</span> : <span className="text-zinc-600">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mono mt-1 text-[10px] text-zinc-600">Native column is measured in this browser. Extension availability is per official @mediabunny packages. Server requires explicit configuration and per-job opt-in.</p>
    </section>
  );
}
