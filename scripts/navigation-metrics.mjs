/** Deterministic, data-free summary of synthetic browser interaction timings. */
export function summarizeNavigationMs(samples) {
  if (!Array.isArray(samples) || samples.length === 0 ||
      samples.some(ms => !Number.isFinite(ms) || ms < 0)) {
    throw new TypeError("Navigation samples must contain finite nonnegative milliseconds");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const nearestRank = percentile => sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)];
  return Object.freeze({
    count: sorted.length,
    p50: nearestRank(0.5),
    p95: nearestRank(0.95),
    max: sorted[sorted.length - 1]
  });
}
