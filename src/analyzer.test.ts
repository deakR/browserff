import { describe, expect, test } from 'bun:test';
import { analyzeSize, buildRecommendations } from './lib/analyzer';
import { ffmpegPreview } from './lib/ffmpeg';
import { formatBytes, formatDuration } from './lib/format';
import type { MediaMetadata } from './types';

function meta4k(): MediaMetadata {
  return {
    container: 'MP4',
    mimeType: 'video/mp4',
    duration: 60,
    title: null,
    videoTracks: [],
    audioTracks: [],
    primaryVideo: {
      index: 0, codec: 'avc', codecDescription: null,
      codedWidth: 3840, codedHeight: 2160, displayWidth: 3840, displayHeight: 2160,
      rotation: null, frameRate: 60, averageFrameRate: 60,
      bitrate: 25_000_000, averageBitrate: null, colorSpace: null, canDecode: true, packetCount: null,
      name: null, languageCode: 'und', disposition: null,
    },
    primaryAudio: {
      index: 0, codec: 'aac', channels: 2, sampleRate: 48000,
      bitrate: 320_000, averageBitrate: null, canDecode: true,
      name: null, languageCode: 'und', disposition: null,
    },
  };
}

describe('analyzer', () => {
  test('explains 4k60 high-bitrate file from metadata', () => {
    const b = analyzeSize(200 * 1024 * 1024, meta4k());
    expect(b.videoBitrate).toBe(25_000_000);
    expect(b.explanation).toMatch(/4K/);
    expect(b.factors.length).toBeGreaterThan(1);
  });

  test('handles missing duration without NaN', () => {
    const m = meta4k();
    m.duration = null;
    const b = analyzeSize(1000, m);
    expect(b.overallBitrate).toBeNull();
    expect(b.explanation.length).toBeGreaterThan(0);
  });

  test('recommends downscale + fps + audio for heavy file', () => {
    const recs = buildRecommendations(meta4k(), 500 * 1024 * 1024);
    const cats = recs.map((r) => r.category);
    expect(cats).toContain('resolution');
    expect(cats).toContain('fps');
    expect(cats).toContain('audio');
    for (const r of recs) {
      expect(r.operationConfig).toBeDefined();
      expect(r.estimatedNote).toMatch(/Estimated/);
    }
  });

  test('no fake percentages in recommendations', () => {
    const recs = buildRecommendations(meta4k(), 500 * 1024 * 1024);
    for (const r of recs) {
      expect(r.estimatedNote).not.toMatch(/\d+\.\d+%/);
    }
  });
});

describe('ffmpeg preview', () => {
  test('maps resize + codec config to reference command', () => {
    const cmd = ffmpegPreview('input.mp4', {
      kind: 'resize', container: 'mp4', width: 1920, height: 1080,
      videoCodec: 'avc', videoQuality: 0.7, audioCodec: 'aac', label: 'x',
    }, 'output.mp4');
    expect(cmd).toContain('scale=1920:1080');
    expect(cmd).toContain('libx264');
    expect(cmd.startsWith('ffmpeg')).toBe(true);
  });

  test('maps trim range to seek flags', () => {
    const cmd = ffmpegPreview('in.mp4', {
      kind: 'trim', container: 'mp4', start: 2, end: 10, label: 'x',
    }, 'out.mp4');
    expect(cmd).toContain('-ss');
    expect(cmd).toContain('-t');
  });
});

describe('format', () => {
  test('bytes and duration edge cases', () => {
    expect(formatBytes(null)).toBe('N/A');
    expect(formatBytes(1536)).toContain('KB');
    expect(formatDuration(null)).toBe('N/A');
    expect(formatDuration(84.2)).toContain('01:24');
  });
});
