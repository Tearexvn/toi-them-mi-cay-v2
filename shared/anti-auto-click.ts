export const MAX_CLICKS_PER_SECOND = 20;
export const CLICK_RATE_WINDOW_MS = 1_000;
export const CLICK_HISTORY_LIMIT = 32;
export const MACHINE_PATTERN_INTERVAL_COUNT = 20;

const MIN_MACHINE_INTERVAL_MS = 50;
const MAX_MACHINE_INTERVAL_MS = 900;
const MAX_MACHINE_INTERVAL_SPREAD_MS = 8;
const MAX_MACHINE_INTERVAL_COEFFICIENT_OF_VARIATION = 0.015;
const SUSTAINED_MACHINE_INTERVAL_COUNT = CLICK_HISTORY_LIMIT - 1;
const MAX_SUSTAINED_MACHINE_INTERVAL_SPREAD_MS = 20;
const MAX_SUSTAINED_MACHINE_INTERVAL_COEFFICIENT_OF_VARIATION = 0.04;

// Browser trust is enforced at the UI boundary; server-side timestamps remain heuristic,
// since a web server cannot cryptographically prove that a human physically clicked.

export type AntiAutoClickReason = "rate-limit" | "machine-like-timing" | "client-flagged" | "challenge-active";

/**
 * Inspects server-received click timestamps. A rate-limit breach always wins;
 * cadence heuristics flag exceptionally uniform bursts or sustained, low-jitter
 * patterns. The longer window catches scripts that stay under the rate limit.
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
  if (sample.length >= MACHINE_PATTERN_INTERVAL_COUNT + 1) {
    const intervals = sample.slice(1).map((timestamp, index) => timestamp - sample[index]);
    if (intervals.every((interval) => interval >= MIN_MACHINE_INTERVAL_MS && interval <= MAX_MACHINE_INTERVAL_MS)) {
      const mean = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
      const variance = intervals.reduce((sum, interval) => sum + (interval - mean) ** 2, 0) / intervals.length;
      const coefficientOfVariation = Math.sqrt(variance) / mean;
      const spread = Math.max(...intervals) - Math.min(...intervals);

      if (spread <= MAX_MACHINE_INTERVAL_SPREAD_MS &&
        coefficientOfVariation <= MAX_MACHINE_INTERVAL_COEFFICIENT_OF_VARIATION) {
        return "machine-like-timing";
      }
    }
  }

  const sustainedSample = valid.slice(-CLICK_HISTORY_LIMIT);
  if (sustainedSample.length < SUSTAINED_MACHINE_INTERVAL_COUNT + 1) return null;
  const sustainedIntervals = sustainedSample.slice(1).map((timestamp, index) => timestamp - sustainedSample[index]);
  if (sustainedIntervals.some((interval) => interval < MIN_MACHINE_INTERVAL_MS || interval > MAX_MACHINE_INTERVAL_MS)) {
    return null;
  }
  const sustainedMean = sustainedIntervals.reduce((sum, interval) => sum + interval, 0) / sustainedIntervals.length;
  const sustainedVariance = sustainedIntervals.reduce((sum, interval) => sum + (interval - sustainedMean) ** 2, 0) /
    sustainedIntervals.length;
  const sustainedCoefficientOfVariation = Math.sqrt(sustainedVariance) / sustainedMean;
  const sustainedSpread = Math.max(...sustainedIntervals) - Math.min(...sustainedIntervals);

  return sustainedSpread <= MAX_SUSTAINED_MACHINE_INTERVAL_SPREAD_MS &&
    sustainedCoefficientOfVariation <= MAX_SUSTAINED_MACHINE_INTERVAL_COEFFICIENT_OF_VARIATION
    ? "machine-like-timing"
    : null;
}
