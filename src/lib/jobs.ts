import type { JobRecord, JobStatus } from '../types';
import { uid } from './format';

export type JobExecutor = (
  job: JobRecord,
  report: (progress: number) => void,
  isCancelled: () => boolean,
) => Promise<{ outputUrl: string | null; outputName: string | null; outputSize: number | null; detail: string }>;

type Listener = (jobs: JobRecord[]) => void;

class JobQueue {
  private jobs: JobRecord[] = [];
  private listeners = new Set<Listener>();
  private executors = new Map<string, JobExecutor>();
  private cancelFlags = new Map<string, boolean>();
  private running = false;
  private persist: ((jobs: JobRecord[]) => Promise<void>) | null = null;

  setPersist(fn: (jobs: JobRecord[]) => Promise<void>): void {
    this.persist = fn;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.jobs);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void {
    for (const l of this.listeners) l([...this.jobs]);
    this.persist?.(this.jobs).catch(() => undefined);
  }

  hydrate(jobs: JobRecord[]): void {
    this.jobs = jobs.map((j) => (j.status === 'running' || j.status === 'pending'
      ? { ...j, status: 'pending' as JobStatus, progress: 0 }
      : j));
    this.emit();
  }

  register(kind: string, fn: JobExecutor): void {
    this.executors.set(kind, fn);
  }

  enqueue(kind: JobRecord['kind'], label: string, detail: string, payload: unknown): JobRecord {
    const job: JobRecord = {
      id: uid('job'), kind, label, detail, status: 'pending',
      progress: 0, createdAt: Date.now(), error: null,
      outputUrl: null, outputName: null, outputSize: null,
    };
    (job as { payload?: unknown }).payload = payload;
    this.jobs = [job, ...this.jobs];
    this.emit();
    void this.pump();
    return job;
  }

  payloadOf<T>(job: JobRecord): T {
    return (job as { payload?: T }).payload as T;
  }

  cancel(id: string): void {
    this.cancelFlags.set(id, true);
    const j = this.jobs.find((x) => x.id === id);
    if (j && j.status === 'pending') {
      j.status = 'cancelled';
      this.emit();
    }
  }

  remove(id: string): void {
    const j = this.jobs.find((x) => x.id === id);
    if (j?.outputUrl) URL.revokeObjectURL(j.outputUrl);
    this.jobs = this.jobs.filter((x) => x.id !== id);
    this.emit();
  }

  duplicate(id: string): void {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return;
    const payload = (j as { payload?: unknown }).payload;
    const copy: JobRecord = {
      ...j, id: uid('job'), status: 'pending', progress: 0,
      createdAt: Date.now(), error: null, outputUrl: null, outputName: null, outputSize: null,
    };
    (copy as { payload?: unknown }).payload = payload;
    this.jobs = [copy, ...this.jobs];
    this.emit();
    void this.pump();
  }

  retry(id: string): void {
    const j = this.jobs.find((x) => x.id === id);
    if (!j || j.status === 'running' || j.status === 'pending') return;
    j.status = 'pending';
    j.progress = 0;
    j.error = null;
    this.cancelFlags.delete(id);
    this.emit();
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const next = this.jobs.find((j) => j.status === 'pending' && !this.cancelFlags.get(j.id));
        if (!next) return;
        const exec = this.executors.get(next.kind);
        if (!exec) {
          next.status = 'failed';
          next.error = `No executor registered for job kind "${next.kind}".`;
          this.emit();
          continue;
        }
        next.status = 'running';
        next.progress = 0;
        this.emit();
        try {
          const res = await exec(next, (p) => {
            next.progress = Math.min(1, Math.max(0, p));
            this.emit();
          }, () => !!this.cancelFlags.get(next.id));
          if (this.cancelFlags.get(next.id)) {
            next.status = 'cancelled';
            if (res.outputUrl) URL.revokeObjectURL(res.outputUrl);
          } else {
            next.status = 'completed';
            next.progress = 1;
            next.outputUrl = res.outputUrl;
            next.outputName = res.outputName;
            next.outputSize = res.outputSize;
            next.detail = res.detail;
          }
        } catch (e) {
          next.status = this.cancelFlags.get(next.id) ? 'cancelled' : 'failed';
          next.error = e instanceof Error ? e.message : 'Job failed';
        }
        this.cancelFlags.delete(next.id);
        this.emit();
      }
    } finally {
      this.running = false;
    }
  }
}

export const jobQueue = new JobQueue();
