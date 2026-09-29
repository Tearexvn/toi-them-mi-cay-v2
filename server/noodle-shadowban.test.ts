import { describe, expect, it } from "vitest";
import { getVisibleClickSnapshot, includePrivateLeaderboardEntry, incrementClickSnapshot } from "../shared/noodle-shadowban";

const actual = { totalClicks: 80, beefClicks: 40, chickenClicks: 25, octopusClicks: 15, experience: "500" };

describe("shadowban decoy click stats", () => {
  it("shows actual stats before moderation", () => {
    expect(getVisibleClickSnapshot(actual, null, false)).toEqual(actual);
  });

  it("starts a new decoy snapshot from the player's existing scores", () => {
    expect(getVisibleClickSnapshot(actual, null, true)).toEqual(actual);
  });

  it("increments only the selected flavor and XP in the decoy snapshot", () => {
    const shadow = incrementClickSnapshot(actual, "octopus");
    expect(shadow).toEqual({ totalClicks: 81, beefClicks: 40, chickenClicks: 25, octopusClicks: 16, experience: "501" });
    expect(actual.totalClicks).toBe(80);
    expect(actual.experience).toBe("500");
  });

  it("keeps the x2 honeypot believable in the local decoy stats without changing the frozen snapshot", () => {
    const decoy = incrementClickSnapshot(actual, "beef", 2);
    expect(decoy).toEqual({ totalClicks: 82, beefClicks: 42, chickenClicks: 25, octopusClicks: 15, experience: "502" });
    expect(actual).toEqual({ totalClicks: 80, beefClicks: 40, chickenClicks: 25, octopusClicks: 15, experience: "500" });
  });

  it("falls back to the real snapshot for any missing decoy fields", () => {
    expect(getVisibleClickSnapshot(actual, { totalClicks: 81, experience: "501" }, true)).toEqual({
      totalClicks: 81, beefClicks: 40, chickenClicks: 25, octopusClicks: 15, experience: "501",
    });
  });

  it("shows a decoy row in the shadowbanned player's own top ten only", () => {
    const publicRows = Array.from({ length: 10 }, (_, index) => ({ playerId: index + 1, score: 100 - index }));
    const privateRow = { playerId: 99, score: 95 };
    const privateView = includePrivateLeaderboardEntry(publicRows, privateRow, 7);
    expect(privateView).toHaveLength(10);
    expect(privateView[6]).toEqual(privateRow);
    expect(publicRows.some((row) => row.playerId === 99)).toBe(false);
  });

  it("does not expose a decoy row when its private rank is outside the top ten", () => {
    const publicRows = Array.from({ length: 10 }, (_, index) => ({ playerId: index + 1, score: 100 - index }));
    expect(includePrivateLeaderboardEntry(publicRows, { playerId: 99, score: 5 }, 12)).toEqual(publicRows);
  });
});
