export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return 'N/A';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[u]}`;
}

export function formatBitrate(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) return 'N/A';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  return `${(bps / 1000).toFixed(0)} kbps`;
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return 'N/A';
  const ms = Math.round(sec * 1000);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  const mss = String(r).padStart(3, '0');
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${ss}.${mss}`;
  }
  return `${mm}:${ss}.${mss}`;
}

export function formatFps(fps: number | null | undefined): string {
  if (fps == null || !Number.isFinite(fps) || fps <= 0) return 'N/A';
  return `${fps >= 100 ? fps.toFixed(0) : fps.toFixed(2)} FPS`;
}

export function formatHz(hz: number | null | undefined): string {
  if (hz == null || !Number.isFinite(hz) || hz <= 0) return 'N/A';
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${hz} Hz`;
}

export function formatResolution(w: number | null | undefined, h: number | null | undefined): string {
  if (w == null || h == null) return 'N/A';
  return `${w} × ${h}`;
}

export function aspectRatio(w: number | null, h: number | null): string {
  if (!w || !h) return 'N/A';
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
