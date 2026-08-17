// ─── Seeded Deterministic PRNG (Mulberry32) ───
// Enables 100% reproducible simulation runs across arbitrary seeds.

export class SeededPRNG {
  private state: number;

  constructor(seed: number = 42) {
    this.state = seed >>> 0;
  }

  /**
   * Generates pseudo-random float in [0, 1)
   */
  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let z = this.state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Generates integer in range [min, max]
   */
  public nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Returns true with probability p (0.0 to 1.0)
   */
  public chance(p: number): boolean {
    return this.next() < p;
  }

  /**
   * Picks a random element from an array
   */
  public pick<T>(arr: T[]): T {
    return arr[this.nextInt(0, arr.length - 1)];
  }
}
