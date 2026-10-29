/**
 * True streaming SHA-256 (FIPS 180-4).
 * Processes stream chunks sequentially without accumulating the entire file in RAM.
 * Scales to multi-gigabyte media files with constant memory overhead (~64 bytes state).
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(n: number, b: number): number {
  return (n >>> b) | (n << (32 - b));
}

class Sha256Stream {
  private h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private block = new Uint8Array(64);
  private blockLen = 0;
  private total = 0;
  private w = new Uint32Array(64);

  update(chunk: Uint8Array): void {
    this.total += chunk.length;
    let offset = 0;
    while (offset < chunk.length) {
      const take = Math.min(64 - this.blockLen, chunk.length - offset);
      this.block.set(chunk.subarray(offset, offset + take), this.blockLen);
      this.blockLen += take;
      offset += take;
      if (this.blockLen === 64) {
        this.processBlock(this.block);
        this.blockLen = 0;
      }
    }
  }

  private processBlock(block: Uint8Array): void {
    const view = new DataView(block.buffer, block.byteOffset, 64);
    for (let i = 0; i < 16; i++) this.w[i] = view.getUint32(i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(this.w[i - 15], 7) ^ rotr(this.w[i - 15], 18) ^ (this.w[i - 15] >>> 3);
      const s1 = rotr(this.w[i - 2], 17) ^ rotr(this.w[i - 2], 19) ^ (this.w[i - 2] >>> 10);
      this.w[i] = (this.w[i - 16] + s0 + this.w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = this.h;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ ((~e) & g);
      const t1 = (h + s1 + ch + K[i] + this.w[i]) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    this.h[0] = (this.h[0] + a) | 0;
    this.h[1] = (this.h[1] + b) | 0;
    this.h[2] = (this.h[2] + c) | 0;
    this.h[3] = (this.h[3] + d) | 0;
    this.h[4] = (this.h[4] + e) | 0;
    this.h[5] = (this.h[5] + f) | 0;
    this.h[6] = (this.h[6] + g) | 0;
    this.h[7] = (this.h[7] + h) | 0;
  }

  digest(): string {
    const bits = this.total * 8;
    const padLen = this.blockLen < 56 ? (56 - this.blockLen) : (64 - this.blockLen + 56);
    const p = new Uint8Array(padLen + 8);
    p[0] = 0x80;
    const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
    v.setUint32(padLen, Math.floor(bits / 0x100000000), false);
    v.setUint32(padLen + 4, bits >>> 0, false);
    this.update(p);
    return Array.from(this.h).map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
}

export async function sha256Hex(file: Blob, onProgress?: (p: number) => void): Promise<string> {
  const total = file.size || 1;
  const reader = file.stream().getReader();
  const hasher = new Sha256Stream();
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      hasher.update(value);
      read += value.byteLength;
      onProgress?.(Math.min(1, read / total));
    }
  }
  return hasher.digest();
}

export function compareHashes(a: string | null, b: string | null): 'IDENTICAL' | 'DIFFERENT' | 'PENDING' {
  if (!a || !b) return 'PENDING';
  return a === b ? 'IDENTICAL' : 'DIFFERENT';
}
