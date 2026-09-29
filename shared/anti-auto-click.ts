export const MAX_CLICKS_PER_SECOND = 20;
export const CLICK_RATE_WINDOW_MS = 1_000;
export const CLICK_HISTORY_LIMIT = 32;
export const MACHINE_PATTERN_INTERVAL_COUNT = 20;

const MIN_MACHINE_INTERVAL_MS = 50;
const MAX_MACHINE_INTERVAL_MS = 900;
const MAX_MACHINE_INTERVAL_SPREAD_MS = 8;
const MAX_MACHINE_INTERVAL_COEFFICIENT_OF_VARIATION = 0.015;

export type AntiAutoClickReason = "rate-limit" | "machine-like-timing" | "client-flagged" | "challenge-active";

/**
 * Inspects server-received click timestamps. A rate-limit breach always wins;
 * the cadence heuristic only flags exceptionally uniform multi-click samples.
 */
export function detectSuspiciousClickPattern(
  timestamps: readonly number[],
  now: number = timestamps.at(-1) ?? Date.now(),
): AntiAutoClickReason | null {
  const valid = timestamps.filter((timestamp) => Number.isFinite(timestamp) && timestamp <= now);
  const recent = valid.filter((timestamp) => now - timestamp < CLICK_RATE_WINDOW_MS);
  if (recent.length > MAX_CLICKS_PER_SECOND) return "rate-limit";

  const latest = valid.at(-1);
  if (latest === undefined || now - latest >= CLICK_RATE_WINDOW_MS) return null;

  const sample = valid.slice(-(MACHINE_PATTERN_INTERVAL_COUNT + 1));
  if (sample.length < MACHINE_PATTERN_INTERVAL_COUNT + 1) return null;

  const intervals = sample.slice(1).map((timestamp, index) => timestamp - sample[index]);
  if (intervals.some((interval) => interval < MIN_MACHINE_INTERVAL_MS || interval > MAX_MACHINE_INTERVAL_MS)) {
    return null;
  }

  const mean = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  const variance = intervals.reduce((sum, interval) => sum + (interval - mean) ** 2, 0) / intervals.length;
  const coefficientOfVariation = Math.sqrt(variance) / mean;
  const spread = Math.max(...intervals) - Math.min(...intervals);

  return spread <= MAX_MACHINE_INTERVAL_SPREAD_MS &&
    coefficientOfVariation <= MAX_MACHINE_INTERVAL_COEFFICIENT_OF_VARIATION
    ? "machine-like-timing"
    : null;
}
