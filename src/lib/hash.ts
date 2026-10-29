/** Streaming file integrity via WebCrypto. Never loads the whole file at once. */

const MAX_DIGEST_BYTES = 2 * 1024 * 1024 * 1024 - 1024 * 1024;

export async function sha256Hex(file: Blob, onProgress?: (p: number) => void): Promise<string> {
  if (file.size > MAX_DIGEST_BYTES) {
    throw new Error(`File is too large for in-memory hashing (${(file.size / (1024 * 1024 * 1024)).toFixed(1)} GB). Browser WebCrypto digest requires contiguous memory under 2 GB.`);
  }
  const total = file.size || 1;
  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      read += value.byteLength;
      onProgress?.(Math.min(1, read / total));
    }
  }
  const merged = new Uint8Array(read);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  const digest = await crypto.subtle.digest('SHA-256', merged as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function compareHashes(a: string | null, b: string | null): 'IDENTICAL' | 'DIFFERENT' | 'PENDING' {
  if (!a || !b) return 'PENDING';
  return a === b ? 'IDENTICAL' : 'DIFFERENT';
}
