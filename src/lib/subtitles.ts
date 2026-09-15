/** Subtitle helpers. The engine reads/writes WebVTT only; SRT is converted locally. */

export function detectSubtitleFormat(name: string, text: string): 'srt' | 'vtt' | null {
  const head = text.slice(0, 200);
  if (/^WEBVTT/m.test(head)) return 'vtt';
  if (/\.vtt$/i.test(name)) return 'vtt';
  if (/\.srt$/i.test(name)) return 'srt';
  if (/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(head)) return 'srt';
  return null;
}

function srtStampToSec(stamp: string): number | null {
  const m = stamp.trim().match(/(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

function secToVtt(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

/** Convert SRT subtitle text to WebVTT. Cue numbers and positions are dropped; timing and text preserved. */
export function srtToVtt(srt: string): string {
  const blocks = srt.replace(/^\uFEFF/, '').split(/\r?\n\s*\r?\n/);
  const cues: string[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    let i = 0;
    if (/^\d+$/.test(lines[0])) i = 1;
    if (i >= lines.length) continue;
    const range = lines[i].match(/(.+?)\s*-->\s*(.+)/);
    if (!range) continue;
    const start = srtStampToSec(range[1]);
    const end = srtStampToSec(range[2].split(/\s/)[0]);
    if (start == null || end == null || end <= start) continue;
    const text = lines.slice(i + 1).join('\n');
    if (!text) continue;
    cues.push(`${secToVtt(start)} --> ${secToVtt(end)}\n${text}`);
  }
  if (cues.length === 0) throw new Error('No subtitle cues found. Expected SRT with timestamp ranges.');
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

export function countCues(vtt: string): number {
  return vtt.split(/\r?\n\s*\r?\n/).filter((b) => /-->/.test(b)).length;
}
