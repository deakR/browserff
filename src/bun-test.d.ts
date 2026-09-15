declare module 'bun:test' {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(actual: unknown): {
    toBe(expected: unknown): void;
    toContain(expected: unknown): void;
    toBeNull(): void;
    toBeDefined(): void;
    toBeGreaterThan(n: number): void;
    toBeLessThan(n: number): void;
    toMatch(re: RegExp): void;
    not: {
      toMatch(re: RegExp): void;
      toContain(expected: unknown): void;
    };
  };
}
