import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { normalizeNoodleName } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createPublicCaller() {
  const ctx: TrpcContext = {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

async function expectBadRequest(action: () => Promise<unknown>) {
  await expect(action()).rejects.toMatchObject({
    code: "BAD_REQUEST",
    name: "TRPCError",
  } satisfies Partial<TRPCError>);
}

describe("noodle player names", () => {
  it("normalizes spacing without changing Vietnamese characters", () => {
    expect(normalizeNoodleName("  Mì   Cay\tClub  ")).toBe("Mì Cay Club");
  });

  it("rejects empty names before accessing the database", async () => {
    const caller = createPublicCaller();
    await expectBadRequest(() => caller.noodle.join({ name: "   " }));
  });

  it("rejects names longer than 24 characters", async () => {
    const caller = createPublicCaller();
    await expectBadRequest(() => caller.noodle.join({ name: "m".repeat(25) }));
  });

  it("rejects markup and control characters in names", async () => {
    const caller = createPublicCaller();
    await expectBadRequest(() => caller.noodle.join({ name: "<script>" }));
  });

  it("requires a valid player token for click requests", async () => {
    const caller = createPublicCaller();
    await expectBadRequest(() => caller.noodle.click({ token: "short", mood: "beef" }));
  });

  it("rejects short tokens before attempting to unlock an achievement", async () => {
    const caller = createPublicCaller();
    await expectBadRequest(() => caller.noodle.unlockBurnedFinger({ token: "short" }));
  });

  it("rejects unsupported topping values", async () => {
    const caller = createPublicCaller();
    await expectBadRequest(() => caller.noodle.click({ token: "a".repeat(32), mood: "pizza" as never }));
  });

  it("rejects unsupported leaderboard names before querying the database", async () => {
    const caller = createPublicCaller();
    await expectBadRequest(() => caller.noodle.leaderboard({ board: "dessert" as never }));
  });

  it("requires a valid session token for robot confessions and challenge resets", async () => {
    const caller = createPublicCaller();
    await expectBadRequest(() => caller.noodle.confessAsRobot({ token: "short" }));
    await expectBadRequest(() => caller.noodle.resetRobotConfession({ token: "short" }));
  });

  it("rejects malformed tokens and missing honeypot keys before the hidden noodle boost action", async () => {
    const caller = createPublicCaller();
    await expectBadRequest(() => caller.noodle.activateNoodleBoost({ token: "short" }));
    await expectBadRequest(() => caller.noodle.activateNoodleBoost({ token: "a".repeat(32), honeypotKey: "short" }));
  });

  it("keeps shadowban moderation unavailable to unauthenticated visitors", async () => {
    const caller = createPublicCaller();
    await expect(caller.noodle.shadowModeration.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.noodle.shadowModeration.lift({ playerId: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
