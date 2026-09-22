import { deleteDirHandle, getDirHandle, saveDirHandle } from './db';
import { downloadBlob } from './mediabunny/exporter';

type DirPerm = FileSystemDirectoryHandle & {
  queryPermission: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
};

type DirPickerWindow = Window & {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
};

let cache: FileSystemDirectoryHandle | null = null;

function safeName(filename: string): string {
  return filename.replace(/[/\\\0]/g, '_');
}

async function writeBlob(dir: FileSystemDirectoryHandle, blob: Blob, filename: string): Promise<void> {
  const handle = await dir.getFileHandle(safeName(filename), { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function loadFolder(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await getDirHandle();
  cache = handle ?? null;
  return cache;
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  const w = window as DirPickerWindow;
  if (typeof w.showDirectoryPicker !== 'function') return null;
  try {
    const handle = await w.showDirectoryPicker({ mode: 'readwrite' });
    const perm = await (handle as DirPerm).requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return null;
    await saveDirHandle(handle);
    cache = handle;
    return handle;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    if (e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'AbortError') return null;
    throw e;
  }
}

export async function clearFolder(): Promise<void> {
  await deleteDirHandle();
  cache = null;
}

export function folderHandle(): FileSystemDirectoryHandle | null {
  return cache;
}

export async function tryWriteGranted(blob: Blob, filename: string): Promise<boolean> {
  // No requestPermission: this runs after a job with no user gesture.
  if (!cache) return false;
  try {
    const perm = await (cache as DirPerm).queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return false;
    await writeBlob(cache, blob, filename);
    return true;
  } catch {
    return false;
  }
}

export async function saveOutput(blob: Blob, filename: string): Promise<'folder' | 'download'> {
  if (cache) {
    try {
      const perm = await (cache as DirPerm).requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        await writeBlob(cache, blob, filename);
        return 'folder';
      }
    } catch { /* fall through to download */ }
  }
  downloadBlob(blob, filename);
  return 'download';
}

export function canPickFolder(): boolean {
  return typeof (window as DirPickerWindow).showDirectoryPicker === 'function';
}
