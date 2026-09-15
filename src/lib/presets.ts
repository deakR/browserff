import type { MuxContainer, OperationConfig } from '../types';

export interface MuxPreset {
  id: string;
  name: string;
  container: MuxContainer;
  title: string;
  includeVideo: boolean;
  includeAudio: boolean;
  includeSubtitles: boolean;
  createdAt: number;
}

export interface CompressPreset {
  id: string;
  name: string;
  config: OperationConfig;
  createdAt: number;
}

const muxKey = 'browserff.presets.mux';
const compressKey = 'browserff.presets.compress';

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* presets optional */ }
}

export function listMuxPresets(): MuxPreset[] {
  return read<MuxPreset>(muxKey);
}

export function saveMuxPreset(p: MuxPreset): MuxPreset[] {
  const all = [p, ...read<MuxPreset>(muxKey)].slice(0, 20);
  write(muxKey, all);
  return all;
}

export function deleteMuxPreset(id: string): MuxPreset[] {
  const all = read<MuxPreset>(muxKey).filter((p) => p.id !== id);
  write(muxKey, all);
  return all;
}

export function listCompressPresets(): CompressPreset[] {
  return read<CompressPreset>(compressKey);
}

export function saveCompressPreset(p: CompressPreset): CompressPreset[] {
  const all = [p, ...read<CompressPreset>(compressKey)].slice(0, 20);
  write(compressKey, all);
  return all;
}

export function deleteCompressPreset(id: string): CompressPreset[] {
  const all = read<CompressPreset>(compressKey).filter((p) => p.id !== id);
  write(compressKey, all);
  return all;
}
