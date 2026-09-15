import { openDB, type IDBPDatabase } from 'idb';
import type { HistoryEntry, JobRecord, MediaMetadata, ProjectRecord } from '../types';

let dbp: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB('browserff', 2, {
      upgrade(d, oldVersion) {
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('history')) d.createObjectStore('history', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'key' });
        if (oldVersion < 2 && !d.objectStoreNames.contains('jobs')) d.createObjectStore('jobs', { keyPath: 'id' });
      },
    });
  }
  return dbp as Promise<IDBPDatabase>;
}

export async function saveProject(p: ProjectRecord): Promise<void> {
  const d = await db();
  await d.put('projects', p);
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const d = await db();
  const all = (await d.getAll('projects')) as ProjectRecord[];
  return all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
}

export async function appendHistory(projectId: string, e: HistoryEntry): Promise<void> {
  const d = await db();
  await d.put('history', { ...e, projectId } as never);
}

export async function listHistory(projectId: string): Promise<HistoryEntry[]> {
  const d = await db();
  const all = (await d.getAll('history')) as Array<HistoryEntry & { projectId: string }>;
  return all.filter((h) => h.projectId === projectId).sort((a, b) => b.at - a.at).slice(0, 50);
}

export async function cacheMetadata(key: string, meta: MediaMetadata): Promise<void> {
  try {
    const d = await db();
    await d.put('kv', { key: `meta:${key}`, value: meta });
  } catch { /* storage optional */ }
}

export interface PersistedJob extends JobRecord {
  payload?: unknown;
}

export async function saveJobs(jobs: JobRecord[]): Promise<void> {
  try {
    const d = await db();
    const tx = d.transaction('jobs', 'readwrite');
    await tx.store.clear();
    for (const j of jobs.slice(0, 30)) {
      const { outputUrl: _drop, ...rest } = j;
      await tx.store.put({ ...rest, outputUrl: null });
    }
    await tx.done;
  } catch { /* storage optional */ }
}

export async function listJobs(): Promise<PersistedJob[]> {
  try {
    const d = await db();
    const all = (await d.getAll('jobs')) as PersistedJob[];
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}
