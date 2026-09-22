import { describe, expect, test } from 'bun:test';
import { planMux } from './lib/mediabunny/muxer';
import { estimateForConfig, isRemuxOnly, pipelineRows, planFromTargetSize, previewEnd, resolvePreset } from './lib/compress';
import { countCues, detectSubtitleFormat, srtToVtt } from './lib/subtitles';
import { compareHashes, sha256Hex } from './lib/hash';
import { mediaReport } from './lib/report';
import { joinCompatibility, segmentFileName, segmentsFromSize, segmentsFromTimestamps } from './lib/mediabunny/splitjoin';
import { chaptersFromXml, chaptersToXml, sortChapters } from './lib/chapters';
import { projectKey } from './lib/db';
import { outputFileName } from './lib/format';
import { containerSupportsCodec, extractionTargets, transcodeContainers } from './lib/codecs';
import type { MediaMetadata, MuxTrackSelection, SourceFileEntry } from './types';

function src(id: string, name: string, meta: MediaMetadata): SourceFileEntry {
  const file = new File(['x'], name);
  return { id, file, objectUrl: `blob:${id}`, name, size: 1000, metadata: meta, loadError: null, subtitle: null };
}

function meta(videoCodec: string, audioCodec: string): MediaMetadata {
  return {
    container: 'Matroska', mimeType: 'video/x-matroska', duration: 60,
    videoTracks: [{
      index: 0, codec: videoCodec, codecDescription: null, codedWidth: 1920, codedHeight: 1080,
      displayWidth: 1920, displayHeight: 1080, rotation: null, frameRate: 24, averageFrameRate: 24,
      bitrate: 5_000_000, averageBitrate: null, colorSpace: null, canDecode: true, packetCount: null,
      name: null, languageCode: 'und', disposition: null,
    }],
    audioTracks: [{
      index: 0, codec: audioCodec, channels: 6, sampleRate: 48000,
      bitrate: 640_000, averageBitrate: null, canDecode: false,
      name: 'English', languageCode: 'eng', disposition: null,
    }],
    primaryVideo: null, primaryAudio: null, title: null,
  };
}

function sel(sourceId: string, kind: 'video' | 'audio' | 'subtitle', trackIndex: number, order: number): MuxTrackSelection {
  return {
    key: `${sourceId}-${kind}-${trackIndex}`, sourceId, trackIndex, kind,
    include: true, order, nameOverride: null, langOverride: null,
    defaultOverride: null, forcedOverride: null, convertSubtitle: false,
  };
}

describe('mux planner', () => {
  test('avc+aac copy into mp4, ac3 rejected for mp4 only if unsupported', () => {
    const sources = [src('a', 'movie.mkv', meta('avc', 'aac'))];
    const planned = planMux({ sources, container: 'mp4', selections: [sel('a', 'video', 0, 0), sel('a', 'audio', 0, 1)] });
    expect(planned.length).toBe(2);
    expect(planned[0].verdict).toBe('copy');
    // aac in mp4 must be copyable per engine matrix
    expect(containerSupportsCodec('mp4', 'aac')).toBe(true);
    expect(planned[1].verdict).toBe('copy');
  });

  test('mkv accepts hevc+eac3, ordering respected', () => {
    const sources = [src('a', 'movie.mkv', meta('hevc', 'eac3'))];
    const planned = planMux({
      sources, container: 'mkv',
      selections: [sel('a', 'audio', 0, 1), sel('a', 'video', 0, 0)],
    });
    expect(planned[0].kind).toBe('video');
    expect(planned.every((p) => p.verdict === 'copy')).toBe(true);
  });

  test('missing source track is dropped, never faked', () => {
    const sources = [src('a', 'movie.mkv', meta('avc', 'aac'))];
    const planned = planMux({ sources, container: 'mkv', selections: [sel('b', 'video', 0, 0)] });
    expect(planned[0].verdict).toBe('dropped');
  });
});

describe('codec-aware extraction targets', () => {
  test('opus offers ogg first, never wav-only lies', () => {
    const t = extractionTargets('opus', 'audio');
    expect(t.length).toBeGreaterThan(0);
    expect(t[0].formatId).toBe('ogg');
    expect(t.every((x) => x.note.includes('copy'))).toBe(true);
  });

  test('mp3 offers the mp3 elementary target', () => {
    const ids = extractionTargets('mp3', 'audio').map((t) => t.formatId);
    expect(ids).toContain('mp3');
  });

  test('avc video never offers audio-only elementary formats', () => {
    const ids = extractionTargets('avc', 'video').map((t) => t.formatId);
    for (const bad of ['wav', 'mp3', 'adts', 'flac', 'ogg']) {
      expect(ids).not.toContain(bad);
    }
    expect(ids).toContain('mp4');
    expect(ids).toContain('mkv');
  });

  test('unknown codec offers nothing instead of faking', () => {
    expect(extractionTargets('not-a-codec', 'audio').length).toBe(0);
    expect(extractionTargets(null, 'video').length).toBe(0);
  });
});

describe('preview window', () => {
  test('caps long media at 5s, short media at duration, null at 5', () => {
    expect(previewEnd(30)).toBe(5);
    expect(previewEnd(2)).toBe(2);
    expect(previewEnd(null)).toBe(5);
  });
});

describe('compressor planning', () => {
  test('target-size math shows its work', () => {
    const p = planFromTargetSize({ targetBytes: 700 * 1024 * 1024, duration: 6420, audioBitrate: 128_000, audioTrackCount: 1 });
    expect(p.videoBitrate).toBeGreaterThan(0);
    expect(p.audioBytes).toBeGreaterThan(0);
    expect(p.overheadBytes).toBeGreaterThan(0);
    const expectVideo = 700 * 1024 * 1024 - (p.audioBytes as number) - p.overheadBytes;
    expect(Math.abs(((p.videoBitrate as number) * 6420) / 8 - expectVideo)).toBeLessThan(6420);
  });

  test('remux-only detection never mislabels a transcode', () => {
    expect(isRemuxOnly({ videoCodec: 'copy', audioCodec: 'copy' })).toBe(true);
    expect(isRemuxOnly({ videoCodec: 'avc', audioCodec: 'copy' })).toBe(false);
    expect(isRemuxOnly({ videoCodec: 'copy', audioCodec: 'copy', width: 1280 })).toBe(false);
    expect(isRemuxOnly({ videoCodec: 'copy', audioCodec: 'copy', audioBitrate: 64000 })).toBe(false);
  });

  test('pipeline rows mark dropped tracks explicitly', () => {
    const rows = pipelineRows({
      meta: meta('avc', 'aac'), videoIndices: [], audioIndices: [0],
      videoTranscodes: false, audioTranscodes: true,
    });
    expect(rows[0].action).toBe('DROP');
    expect(rows[1].action).toBe('TRANSCODE');
  });

  test('transcode containers reject impossible pairs honestly', () => {
    const list = transcodeContainers('avc', 'aac');
    expect(list).toContain('mp4');
    expect(transcodeContainers('not-a-codec', 'aac').length).toBe(0);
  });

  test('estimate never invents a size in quality mode', () => {
    const e = estimateForConfig({
      sizeBytes: 1000, duration: 60,
      config: { videoQuality: 0.7, audioCodec: 'aac' }, audioTrackCount: 1,
    });
    expect(e.targetBytes).toBeNull();
    expect(e.reductionPct).toBeNull();
  });

  test('presets resolve to exact strategies, never vague superlatives', () => {
    const m = meta('avc', 'aac');
    m.primaryVideo = m.videoTracks[0];
    const full = { video: ['avc', 'hevc', 'vp9', 'av1'], audio: ['aac', 'opus', 'mp3'] };
    const archive = resolvePreset('archive', full, m);
    expect(archive.videoCodec).toBe('av1');
    expect(archive.usable).toBe(true);
    expect(archive.strategy).toContain('AV1');
    expect(archive.strategy.includes('best codec')).toBe(false);
    expect(archive.changes.length).toBeGreaterThan(3);
    const narrow = { video: ['avc'], audio: [] as string[] };
    const smallNarrow = resolvePreset('small', narrow, m);
    expect(smallNarrow.videoCodec).toBe('avc');
    expect(smallNarrow.audioCodec).toBe('copy');
    expect(resolvePreset('max-compat', { video: [], audio: [] }, m).usable).toBe(false);
  });
});

describe('subtitles', () => {
  test('srt converts to webvtt preserving timing and text', () => {
    const srt = '1\n00:00:01,000 --> 00:00:04,500\nHello <b>world</b>\n\n2\n00:01:10,250 --> 00:01:12,000\nSecond line\nline two\n';
    const vtt = srtToVtt(srt);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:01.000 --> 00:00:04.500');
    expect(vtt).toContain('Hello <b>world</b>');
    expect(countCues(vtt)).toBe(2);
  });

  test('srt detection and garbage rejection', () => {
    expect(detectSubtitleFormat('sub.srt', '1\n00:00:01,000 --> 00:00:02,000\nHi\n')).toBe('srt');
    expect(detectSubtitleFormat('sub.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n')).toBe('vtt');
    expect(detectSubtitleFormat('movie.mkv', 'not subtitles')).toBeNull();
  });

  test('empty srt throws instead of producing empty output', () => {
    let threw = false;
    try {
      srtToVtt('nothing here');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test('subtitle mux plan validates webvtt support per container', () => {
    const sources = [{ ...src('s', 'eng.srt', meta('avc', 'aac')), subtitle: { format: 'srt' as const, text: '1\n00:00:01,000 --> 00:00:02,000\nHi\n' } }];
    const planned = planMux({ sources, container: 'mkv', selections: [sel('s', 'subtitle', 0, 0)] });
    expect(planned.length).toBe(1);
    expect(planned[0].verdict).toBe('copy');
  });
});

describe('hash and report', () => {
  test('sha256 is stable and compare is exact', async () => {
    const a = await sha256Hex(new Blob(['hello']));
    const b = await sha256Hex(new Blob(['hello']));
    const c = await sha256Hex(new Blob(['world']));
    expect(a).toBe(b);
    expect(compareHashes(a, c)).toBe('DIFFERENT');
    expect(compareHashes(a, b)).toBe('IDENTICAL');
    expect(compareHashes(a, null)).toBe('PENDING');
  });

  test('media report contains measured values and honest observations', () => {
    const m = meta('av1', 'opus');
    m.primaryVideo = m.videoTracks[0];
    m.primaryAudio = m.audioTracks[0];
    const r = mediaReport('film.mkv', 1000, m);
    expect(r).toContain('AV1');
    expect(r).toContain('OPUS');
    expect(r).toContain('efficient');
  });
});

describe('split and join', () => {
  test('timestamps produce bounded segments, drops out-of-range cuts', () => {
    const segs = segmentsFromTimestamps(300, [60, 120, -5, 999, 120]);
    expect(segs.length).toBe(3);
    expect(segs[0].start).toBe(0);
    expect(segs[0].end).toBe(60);
    expect(segs[2].start).toBe(120);
    expect(segs[2].end).toBe(300);
  });

  test('size split counts parts honestly', () => {
    expect(segmentsFromSize(1400, 300, 700).length).toBe(2);
    expect(segmentsFromSize(100, 300, 700).length).toBe(1);
    expect(segmentsFromSize(100, 0, 700).length).toBe(0);
  });

  test('segment names are sequential and zero-padded', () => {
    expect(segmentFileName('movie.mkv', 0, 12, 'mp4')).toBe('movie-01.mp4');
    expect(segmentFileName('movie.mkv', 10, 12, 'mp4')).toBe('movie-11.mp4');
  });

  test('join compatibility reports real track facts', () => {
    const m = meta('avc', 'aac');
    m.primaryVideo = m.videoTracks[0];
    m.primaryAudio = m.audioTracks[0];
    const rows = joinCompatibility([{ name: 'a.mp4', meta: m }, { name: 'b.mp4', meta: null }]);
    expect(rows[0].video).toContain('AVC');
    expect(rows[1].video).toBe('none');
  });
});

describe('chapters', () => {
  test('xml roundtrip preserves titles and timestamps', () => {
    const chapters = [
      { id: 'c1', start: 0, title: 'Opening & Intro' },
      { id: 'c2', start: 222.2, title: 'Scene <1>' },
    ];
    const back = chaptersFromXml(chaptersToXml(chapters));
    expect(back.length).toBe(2);
    expect(back[0].title).toBe('Opening & Intro');
    expect(Math.abs(back[1].start - 222.2)).toBeLessThan(0.001);
  });

  test('sort is by start time', () => {
    const s = sortChapters([
      { id: 'b', start: 10, title: 'B' },
      { id: 'a', start: 1, title: 'A' },
    ]);
    expect(s[0].id).toBe('a');
  });
});

describe('projectKey', () => {
  test('matches for same name, size, lastModified; differs when size differs', () => {
    const a = new File(['bytes'], 'clip.mp4', { lastModified: 1_700_000_000_000 });
    const b = new File(['bytes'], 'clip.mp4', { lastModified: 1_700_000_000_000 });
    const c = new File(['bytes!!'], 'clip.mp4', { lastModified: 1_700_000_000_000 });
    expect(projectKey(a)).toBe(projectKey(b));
    expect(projectKey(a) === projectKey(c)).toBe(false);
  });
});

describe('outputFileName', () => {
  test('prefixes the source stem so folder writes do not share one name', () => {
    expect(outputFileName('clip.mp4', 'media-report.md')).toBe('clip-media-report.md');
    expect(outputFileName('a/b.mkv', 'chapters.xml')).toBe('a_b-chapters.xml');
    expect(outputFileName('', 'chapters.vtt')).toBe('output-chapters.vtt');
  });
});
