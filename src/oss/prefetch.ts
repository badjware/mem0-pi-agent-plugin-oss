/**
 * Two-phase prefetch: `queue()` kicks off the fetch on `input` while the user
 * is still assembling the turn, `consume()` races the in-flight promise against
 * a timeout on `before_agent_start`. Slow local embedding/search degrades to
 * "no recall this turn" instead of blocking the turn.
 */
export class Prefetch<T> {
  private pending: Promise<T | null> | null = null;

  queue(fn: () => Promise<T>): void {
    this.pending = fn().catch(() => null);
  }

  async consume(timeoutMs: number, fallback: T): Promise<T> {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return fallback;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
    });
    try {
      const result = await Promise.race([
        pending.then((v) => (v == null ? fallback : v)),
        timeout,
      ]);
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
