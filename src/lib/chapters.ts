import type { Chapter } from '../types';
import { formatDuration, uid } from './format';

export function sortChapters(chapters: Chapter[]): Chapter[] {
  return [...chapters].sort((a, b) => a.start - b.start);
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function xmlUnescape(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function stamp(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

/** MKVToolNix-compatible chapter XML. Usable with mkvmerge --chapters. */
export function chaptersToXml(chapters: Chapter[]): string {
  const sorted = sortChapters(chapters);
  const atoms = sorted.map((c, i) => `  <ChapterAtom>
    <ChapterUID>${1000 + i}</ChapterUID>
    <ChapterTimeStart>${stamp(c.start)}</ChapterTimeStart>
    <ChapterDisplay>
      <ChapterString>${xmlEscape(c.title)}</ChapterString>
      <ChapterLanguage>eng</ChapterLanguage>
    </ChapterDisplay>
  </ChapterAtom>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Chapters>\n  <EditionEntry>\n${atoms}\n  </EditionEntry>\n</Chapters>\n`;
}

/** Parse MKVToolNix chapter XML (ChapterTimeStart + ChapterString). Unknown entries are skipped. */
export function chaptersFromXml(xml: string): Chapter[] {
  const out: Chapter[] = [];
  const atoms = xml.split(/<ChapterAtom>/i).slice(1);
  for (const atom of atoms) {
    const t = atom.match(/<ChapterTimeStart>([^<]+)<\/ChapterTimeStart>/i)?.[1].trim();
    const title = atom.match(/<ChapterString>([^<]*)<\/ChapterString>/i)?.[1] ?? 'Chapter';
    if (!t) continue;
    const m = t.match(/(\d+):(\d{2}):(\d{2})(?:\.(\d{1,9}))?/);
    if (!m) continue;
    const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4] ?? '0'}`);
    if (!Number.isFinite(sec) || sec < 0) continue;
    out.push({ id: uid('ch'), start: sec, title: xmlUnescape(title.trim()) || 'Chapter' });
  }
  return sortChapters(out);
}

export function chaptersToVtt(chapters: Chapter[], total: number | null): string {
  const sorted = sortChapters(chapters);
  const cues = sorted.map((c, i) => {
    const end = i + 1 < sorted.length ? sorted[i + 1].start : (total ?? c.start + 60);
    return `${formatDuration(c.start).replace('.', ',')} --> ${formatDuration(end).replace('.', ',')}\n${c.title}`;
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}
