/** Fixed-window limiter, shared by cookie and token requests for the same user. */
export function createRateLimiter() {
  const buckets = new Map<string, { count: number; until: number }>();
  return (key: string, limit: number, now: number): number => {
    if (buckets.size >= 10_000) {
      for (const [id, bucket] of buckets) if (bucket.until <= now) buckets.delete(id);
      if (buckets.size >= 10_000 && !buckets.has(key)) return 60;
    }
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) { bucket = { count: 0, until: now + 60_000 }; buckets.set(key, bucket); }
    if (bucket.count >= limit) return Math.max(1, Math.ceil((bucket.until - now) / 1000));
    bucket.count++; return 0;
  };
}
