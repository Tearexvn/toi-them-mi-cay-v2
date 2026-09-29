import { describe, expect, it } from "vitest";
import {
  CLICK_RATE_WINDOW_MS,
  detectSuspiciousClickPattern,
  MAX_CLICKS_PER_SECOND,
} from "../shared/anti-auto-click";

function timestampsAtInterval(count: number, intervalMs: number, startAt = 10_000) {
  return Array.from({ length: count }, (_, index) => startAt + index * intervalMs);
}

describe("detectSuspiciousClickPattern", () => {
  it("allows up to 20 clicks in the rolling one-second window", () => {
    const clicks = Array.from(
      { length: MAX_CLICKS_PER_SECOND },
      (_, index) => 50_000 + index * 44 + (index % 2 === 1 ? 8 : 0),
    );
    expect(detectSuspiciousClickPattern(clicks, clicks.at(-1))).toBeNull();
  });

  it("flags more than 20 clicks in the rolling one-second window", () => {
    const clicks = Array.from({ length: MAX_CLICKS_PER_SECOND + 1 }, (_, index) => 80_000 + index * 40);
    expect(detectSuspiciousClickPattern(clicks, 80_000 + 20 * 40)).toBe("rate-limit");
  });

  it("allows short regular streaks and flags twenty consecutive machine-regular intervals", () => {
    expect(detectSuspiciousClickPattern(timestampsAtInterval(9, 250))).toBeNull();
    expect(detectSuspiciousClickPattern(timestampsAtInterval(21, 250))).toBe("machine-like-timing");
  });

  it("does not flag varied human timing or small but non-machine jitter", () => {
    const varied = [0, 260, 590, 830, 1_160, 1_390, 1_710, 1_970, 2_290].map((value) => 100_000 + value);
    expect(detectSuspiciousClickPattern(varied)).toBeNull();
    const lightlyJittered = Array.from({ length: 21 }, (_, index) => 200_000 + index * 250 + (index % 2 === 0 ? 0 : 7));
    expect(detectSuspiciousClickPattern(lightlyJittered)).toBeNull();
  });

  it("ignores timestamps outside the rolling rate window", () => {
    const now = 200_000;
    const stale = Array.from({ length: 30 }, (_, index) => now - CLICK_RATE_WINDOW_MS - 2_000 + index * 20);
    expect(detectSuspiciousClickPattern(stale, now)).toBeNull();
  });
});
