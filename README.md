# BrowserFF — Browser-Native Media Workbench

Inspect. Multiplex. Transform. A browser-native media engineering workbench inspired by
MKVToolNix GUI, powered by Mediabunny/WebCodecs, processed in this browser.

> “I built a browser-native MKVToolNix-style media workbench on Mediabunny/WebCodecs.
> It inspects real containers and tracks, remuxes selected streams without re-encoding,
> plans container/codec compatibility from the engine's own format data, lazy-loads WASM
> codec extensions, edits headers and chapters, extracts streams, queues jobs locally,
> and never uploads source media by default.”

## Tools

- **Multiplexer** — multi-file sources, track matrix (include/order), per-track
  name/language/default/forced overrides, container picker, live copy/blocked planner
  verdicts, dry-run validation via real `Conversion.init`, remux-vs-transcode explanation,
  FFmpeg reference preview, one-click mux job.
- **Inspector** — mkvinfo/MediaInfo-style tree (codec, resolution, FPS, bitrate, color,
  rotation, language, name, disposition flags), preview, timeline with thumbnails and
  markers, frame inspector with real decoded frames, contact sheets.
- **Chapters** — project-local editor with precise timestamps, MKVToolNix XML
  import/export (`mkvmerge --chapters` compatible) and WebVTT export.
- **Header** — container title via remux (streams copied); track properties via the
  Multiplexer packet-copy path. In-place editing is impossible browser-side, so a new
  file is always created — the UI says so.
- **Extract** — single-stream packet-copy extraction (no transcode) into MKV/MP4/WebM,
  plus frame extraction.
- **Compressor** — smart/target-size/reduction/quality/manual compression with
  capability-gated presets, per-track copy/transcode pipeline, planning estimates,
  measured results, and 3-preset benchmarks from real encodes.
- **Split & Join** — timestamp/size/parts/chapter splitting into queued segment jobs
  (stream-copy with keyframe snapping, or exact re-encode), plus sequential file
  appending through a decode/re-encode sample pipeline (packet timestamps are
  immutable, so same-codec concatenation is impossible — stated in-app).
- **Processor** — transcode/resize/trim/FPS/audio operations with live pipeline
  (demux → decode → transform → encode → mux), cancel, original-vs-output compare.
- **Analyzer** — measured size breakdown, generated explanations, recommendations
  with apply-to-processor.
- **Jobs** — persistent queue (pending/running/completed/failed/cancelled) with retry,
  cancel, remove, and downloads.
- **Codecs** — runtime native capability probes, WASM extension manager (lazy chunks),
  engine-derived format matrix, processing-mode indicator.

## Mental model

BrowserFF understands media at three levels:

- **Container** — what holds the streams (Matroska, MP4, WebM, Ogg, …).
- **Track** — the video/audio/subtitle streams inside it, each with language, name,
  and disposition flags.
- **Codec** — how each stream is encoded (HEVC, Opus, WebVTT, …).

And four operations:

- **Remux** — change container, selection, order, or metadata. Streams copied, no re-encoding.
- **Extract** — copy one stream into a codec-compatible container. Never silently transcoded.
- **Transcode** — decode and re-encode to change codec, resolution, bitrate, or FPS.
- **Compress** — intentional size reduction through lossy re-encoding, with planning
  estimates labeled as estimates and measured values after encoding.

Subtitle reality: the engine exposes no subtitle *input* tracks, so extraction and
attachment handling stay unavailable and are marked as such. Subtitle *files*
(SRT converted locally to WebVTT, the only subtitle codec the engine writes) can be
muxed as new tracks. Chapters are project-local with MKVToolNix-compatible XML
export, since the engine exposes no chapter write API.

Mechanically, remux uses `Conversion` copy mode or manual `EncodedPacketSink` →
`Encoded*PacketSource` packet copy. The planner tells you which path applies per
track, and blocks (never silently drops) unsupported container/codec combinations.

## Native WebCodecs vs WASM extensions

Mediabunny uses browser WebCodecs when available and official `@mediabunny/*` WASM
extensions otherwise (AC-3/E-AC-3, DTS, AAC/MP3/FLAC encoders, ProRes decode).
Extensions lazy-load on demand into separate bundle chunks (1.6 MB DTS … 200 KB ProRes
in this build) — never in the initial page. Registration is global; the capability
table re-probes after each load. Tradeoff shown in-app: download size and CPU vs
native speed.

## Privacy architecture

Local processing is the default and persistent in the UI (LOCAL badge). Files become
in-memory blob URLs; parsing, decoding, muxing, and transcoding run on-device.
IndexedDB holds projects, queue metadata, analysis, and history — never media bytes.
Supabase (optional) receives metadata rows only. Server mode stays disabled until
`VITE_MEDIABUNNY_SERVER_URL` is set and always requires explicit per-job opt-in.

## Supported containers/codecs

Read: whatever Mediabunny 1.56.2 parses (MP4/MOV, WebM/Matroska, Ogg, MP3, WAV, ADTS,
FLAC, MPEG-TS, …). Write: MKV, MP4, MOV, WebM, Ogg, MP3, WAV, FLAC — with per-format
codec lists read live from `OutputFormat.getSupportedCodecs()` in the Codecs tool.
Subtitle output is WebVTT-only per the engine.

## Architecture

```
Browser
├── React workbench (sidebar tools, dense panels, job queue)
├── Domain logic (planner, chapters, ffmpeg preview, analyzer)
├── Mediabunny adapter (src/lib/mediabunny — only Mediabunny import site,
│   except lazy extension chunks)
│   ├── reader / metadata / capabilities / frames
│   ├── muxer (plan, dry-run, single remux, manual packet-copy mux, extract)
│   ├── transcoder / exporter / sample / extensions
├── IndexedDB (projects, jobs, history, analysis cache)
└── Supabase (optional, metadata-only, RLS)
```

## Performance considerations

No base64 media, no media bytes in React state, lazy seeking, ≤12 cached thumbnails,
capped packet-stat scans, isolated progress state, large-file warnings, object-URL
cleanup, sequential job execution. Initial bundle ~915 KB (~250 KB gzip); WASM codecs
split into on-demand chunks.

## Known limitations (engine, Mediabunny 1.56.2)

- No subtitle input tracks → subtitle extraction unavailable; WebVTT authoring supported.
- No chapter or attachment read/write API → chapters are project-local with
  MKVToolNix-compatible export; attachments unavailable.
- No per-track copy/transcode reporting → remux-vs-transcode is derived from the plan
  (copy-forced conversions) and stated as such.
- Manual `Output` carries no container tags → title editing uses the single-file
  Conversion path.
- Job payloads (File handles) are session-local; queue metadata persists.

## Develop

```bash
bun install
bun run dev      # http://localhost:5173
bun test         # 12 tests: analyzer, planner, chapters, ffmpeg preview, format
bun run build    # typecheck + bundle
```

Optional env: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (sync),
`VITE_MEDIABUNNY_SERVER_URL` (server mode indicator).
See `supabase/schema.sql` for metadata-only tables with RLS.

## Future work

Waveform visualization, batch processing, subtitle-track support when the engine adds
it, worker-offloaded thumbnails, WebGPU transforms, collaborative projects.
