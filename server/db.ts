import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { CLICK_HISTORY_LIMIT, detectSuspiciousClickPattern, type AntiAutoClickReason } from "../shared/anti-auto-click";
import { advanceRobotConfession, ROBOT_CONFESSION_TAPS_REQUIRED } from "../shared/noodle-achievements";
import { InsertUser, noodlePlayers, NoodlePlayer, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export class NoodleIdentityError extends Error {
  constructor(
    message: string,
    public readonly reason: "name-taken" | "invalid-session" | "not-found" | "database-unavailable",
  ) {
    super(message);
    this.name = "NoodleIdentityError";
  }
}

export type NoodleMood = "beef" | "chicken" | "octopus";
export type NoodleBoard = NoodleMood | "total";
export type NoodleClickResult = {
  player: NoodlePlayer;
  previousExperience: string;
  accepted: boolean;
  suspiciousReason: AntiAutoClickReason | null;
  newlyUnlockedAntiClick: boolean;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeNoodleName(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function noodleNameKey(name: string) {
  return normalizeNoodleName(name).toLocaleLowerCase("vi-VN");
}

function requireNoodleDb() {
  return getDb().then((db) => {
    if (!db) throw new NoodleIdentityError("Chưa kết nối được dữ liệu BXH.", "database-unavailable");
    return db;
  });
}

function issueToken() {
  return randomBytes(32).toString("base64url");
}

async function openPlayerSession(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  player: {
    id: number;
    displayName: string;
    loginTokenHash: string;
    burnedFingerUnlocked: boolean;
    antiClickAchievementUnlocked: boolean;
    robotEaterUnlocked: boolean;
    robotChallengeActive: boolean;
    robotConfessionCount: number;
    leaderboardHidden: boolean;
    honeypotKey: string;
  },
  suppliedToken?: string,
) {
  const honeypotKey = player.honeypotKey || randomBytes(24).toString("base64url");
  if (!player.honeypotKey) {
    await db.update(noodlePlayers).set({ honeypotKey }).where(eq(noodlePlayers.id, player.id));
  }
  if (suppliedToken && hashToken(suppliedToken) === player.loginTokenHash) {
    return {
      playerId: player.id,
      name: player.displayName,
      token: suppliedToken,
      returning: true,
      burnedFingerUnlocked: player.burnedFingerUnlocked,
      antiClickAchievementUnlocked: player.antiClickAchievementUnlocked,
      robotEaterUnlocked: player.robotEaterUnlocked,
      robotChallengeActive: player.robotChallengeActive,
      robotConfessionCount: player.robotConfessionCount,
      honeypotKey,
    };
  }

  // A known nickname is the passwordless identity for this friends-only site.
  // Issue a fresh device token so a returning player can recover the same score.
  const token = issueToken();
  await db.update(noodlePlayers).set({ loginTokenHash: hashToken(token) }).where(eq(noodlePlayers.id, player.id));
  return {
    playerId: player.id,
    name: player.displayName,
    token,
    returning: true,
    burnedFingerUnlocked: player.burnedFingerUnlocked,
    antiClickAchievementUnlocked: player.antiClickAchievementUnlocked,
    robotEaterUnlocked: player.robotEaterUnlocked,
    robotChallengeActive: player.robotChallengeActive,
    robotConfessionCount: player.robotConfessionCount,
    honeypotKey,
  };
}

export async function joinNoodlePlayer(name: string, existingToken?: string) {
  const db = await requireNoodleDb();
  const displayName = normalizeNoodleName(name);
  const nameKey = noodleNameKey(displayName);
  const existing = await db.select({
    id: noodlePlayers.id,
    displayName: noodlePlayers.displayName,
    loginTokenHash: noodlePlayers.loginTokenHash,
    burnedFingerUnlocked: noodlePlayers.burnedFingerUnlocked,
    antiClickAchievementUnlocked: noodlePlayers.antiClickAchievementUnlocked,
    robotEaterUnlocked: noodlePlayers.robotEaterUnlocked,
    robotChallengeActive: noodlePlayers.robotChallengeActive,
    robotConfessionCount: noodlePlayers.robotConfessionCount,
    leaderboardHidden: noodlePlayers.leaderboardHidden,
    honeypotKey: noodlePlayers.honeypotKey,
  }).from(noodlePlayers).where(eq(noodlePlayers.nameKey, nameKey)).limit(1);

  if (existing[0]) return openPlayerSession(db, existing[0], existingToken);

  const token = issueToken();
  try {
    await db.insert(noodlePlayers).values({
      displayName,
      nameKey,
      loginTokenHash: hashToken(token),
      totalClicks: 0,
      experience: "0",
      beefClicks: 0,
      chickenClicks: 0,
      octopusClicks: 0,
      clickTimestamps: "[]",
      leaderboardHidden: false,
      honeypotKey: randomBytes(24).toString("base64url"),
      antiClickAchievementUnlocked: false,
    });
  } catch (error) {
    // If two friends choose the same name at once, the second joins that same row
    // instead of receiving the old duplicate-name error.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY") {
      const racedPlayer = await db.select({
        id: noodlePlayers.id,
        displayName: noodlePlayers.displayName,
        loginTokenHash: noodlePlayers.loginTokenHash,
        burnedFingerUnlocked: noodlePlayers.burnedFingerUnlocked,
        antiClickAchievementUnlocked: noodlePlayers.antiClickAchievementUnlocked,
        robotEaterUnlocked: noodlePlayers.robotEaterUnlocked,
        robotChallengeActive: noodlePlayers.robotChallengeActive,
        robotConfessionCount: noodlePlayers.robotConfessionCount,
        leaderboardHidden: noodlePlayers.leaderboardHidden,
        honeypotKey: noodlePlayers.honeypotKey,
      }).from(noodlePlayers).where(eq(noodlePlayers.nameKey, nameKey)).limit(1);
      if (racedPlayer[0]) return openPlayerSession(db, racedPlayer[0]);
    }
    throw error;
  }

  const created = await db.select({
    id: noodlePlayers.id,
    displayName: noodlePlayers.displayName,
    burnedFingerUnlocked: noodlePlayers.burnedFingerUnlocked,
    antiClickAchievementUnlocked: noodlePlayers.antiClickAchievementUnlocked,
    robotEaterUnlocked: noodlePlayers.robotEaterUnlocked,
    robotChallengeActive: noodlePlayers.robotChallengeActive,
    robotConfessionCount: noodlePlayers.robotConfessionCount,
    leaderboardHidden: noodlePlayers.leaderboardHidden,
    honeypotKey: noodlePlayers.honeypotKey,
  })
    .from(noodlePlayers).where(eq(noodlePlayers.nameKey, nameKey)).limit(1);
  if (!created[0]) throw new Error("Could not load the newly created player");
  return {
    playerId: created[0].id,
    name: created[0].displayName,
    token,
    returning: false,
    burnedFingerUnlocked: created[0].burnedFingerUnlocked,
    antiClickAchievementUnlocked: created[0].antiClickAchievementUnlocked,
    robotEaterUnlocked: created[0].robotEaterUnlocked,
    robotChallengeActive: created[0].robotChallengeActive,
    robotConfessionCount: created[0].robotConfessionCount,
    honeypotKey: created[0].honeypotKey,
  };
}

function boardColumn(board: NoodleBoard) {
  switch (board) {
    case "beef": return noodlePlayers.beefClicks;
    case "chicken": return noodlePlayers.chickenClicks;
    case "octopus": return noodlePlayers.octopusClicks;
    default: return noodlePlayers.totalClicks;
  }
}

export async function getNoodleLeaderboard(token?: string, board: NoodleBoard = "total") {
  const db = await requireNoodleDb();
  const scoreColumn = boardColumn(board);
  const top = await db.select({
    playerId: noodlePlayers.id,
    name: noodlePlayers.displayName,
    score: scoreColumn,
    robotIconExpiresAt: noodlePlayers.robotIconExpiresAt,
  }).from(noodlePlayers).where(and(
    eq(noodlePlayers.leaderboardHidden, false),
    board === "total" ? undefined : gt(scoreColumn, 0),
  ))
    .orderBy(desc(scoreColumn), asc(noodlePlayers.id))
    .limit(10);
  const now = Date.now();
  const rankedTop = top.map(({ robotIconExpiresAt, ...entry }) => ({
    ...entry,
    robotIconActive: Number(robotIconExpiresAt ?? 0) > now,
  }));

  let me: { playerId: number; name: string; score: number; rank: number; robotIconActive: boolean } | null = null;
  let playerProgress: {
    playerId: number;
    name: string;
    totalClicks: number;
    experience: string;
    burnedFingerUnlocked: boolean;
    antiClickAchievementUnlocked: boolean;
    robotEaterUnlocked: boolean;
    robotIconActive: boolean;
    robotChallengeActive: boolean;
    robotConfessionCount: number;
    honeypotKey: string;
  } | null = null;
  if (token) {
    const tokenHash = hashToken(token);
    const playerRows = await db.select({
      playerId: noodlePlayers.id,
      name: noodlePlayers.displayName,
      score: scoreColumn,
      totalClicks: noodlePlayers.totalClicks,
      experience: noodlePlayers.experience,
      burnedFingerUnlocked: noodlePlayers.burnedFingerUnlocked,
      antiClickAchievementUnlocked: noodlePlayers.antiClickAchievementUnlocked,
      robotEaterUnlocked: noodlePlayers.robotEaterUnlocked,
      robotIconExpiresAt: noodlePlayers.robotIconExpiresAt,
      robotChallengeActive: noodlePlayers.robotChallengeActive,
      robotConfessionCount: noodlePlayers.robotConfessionCount,
      leaderboardHidden: noodlePlayers.leaderboardHidden,
      honeypotKey: noodlePlayers.honeypotKey,
    }).from(noodlePlayers).where(eq(noodlePlayers.loginTokenHash, tokenHash)).limit(1);
    const player = playerRows[0];
    if (player) {
      playerProgress = {
        playerId: player.playerId,
        name: player.name,
        totalClicks: player.totalClicks,
        experience: player.experience,
        burnedFingerUnlocked: player.burnedFingerUnlocked,
        antiClickAchievementUnlocked: player.antiClickAchievementUnlocked,
        robotEaterUnlocked: player.robotEaterUnlocked,
        robotIconActive: Number(player.robotIconExpiresAt ?? 0) > now,
        robotChallengeActive: player.robotChallengeActive,
        robotConfessionCount: player.robotConfessionCount,
        honeypotKey: player.honeypotKey,
      };
    }
    if (player && !player.leaderboardHidden && (board === "total" || player.score > 0)) {
      const ahead = await db.select({ value: count() }).from(noodlePlayers)
        .where(and(eq(noodlePlayers.leaderboardHidden, false), gt(scoreColumn, player.score)));
      const sameScoreAhead = await db.select({ value: count() }).from(noodlePlayers)
        .where(and(
          eq(noodlePlayers.leaderboardHidden, false),
          eq(scoreColumn, player.score),
          lt(noodlePlayers.id, player.playerId),
        ));
      me = {
        playerId: player.playerId,
        name: player.name,
        score: player.score,
        rank: Number(ahead[0]?.value ?? 0) + Number(sameScoreAhead[0]?.value ?? 0) + 1,
        robotIconActive: Number(player.robotIconExpiresAt ?? 0) > now,
      };
    }
  }

  return { top: rankedTop, me, player: playerProgress };
}

export async function recordNoodleClick(
  token: string,
  mood: NoodleMood,
  clientFlagged = false,
): Promise<NoodleClickResult | null> {
  const db = await requireNoodleDb();
  const tokenHash = hashToken(token);
  const receivedAt = Date.now();
  return db.transaction(async (tx) => {
    const playerRows = await tx.select({
      id: noodlePlayers.id,
      experience: noodlePlayers.experience,
      clickTimestamps: noodlePlayers.clickTimestamps,
      antiClickAchievementUnlocked: noodlePlayers.antiClickAchievementUnlocked,
      robotChallengeActive: noodlePlayers.robotChallengeActive,
    })
      .from(noodlePlayers).where(eq(noodlePlayers.loginTokenHash, tokenHash)).limit(1).for("update");
    const player = playerRows[0];
    if (!player) return null;

    const previousExperience = player.experience || "0";
    if (player.robotChallengeActive) {
      const activePlayer = await tx.select().from(noodlePlayers).where(eq(noodlePlayers.id, player.id)).limit(1);
      return activePlayer[0] ? {
        player: activePlayer[0],
        previousExperience,
        accepted: false,
        suspiciousReason: "challenge-active",
        newlyUnlockedAntiClick: false,
      } : null;
    }
    let previousClickTimestamps: number[] = [];
    try {
      const storedTimestamps: unknown = JSON.parse(player.clickTimestamps || "[]");
      if (Array.isArray(storedTimestamps)) {
        previousClickTimestamps = storedTimestamps.filter(
          (timestamp): timestamp is number => typeof timestamp === "number" && Number.isSafeInteger(timestamp),
        );
      }
    } catch {
      previousClickTimestamps = [];
    }
    const clickTimestamps = [...previousClickTimestamps, receivedAt]
      .sort((left, right) => left - right)
      .slice(-CLICK_HISTORY_LIMIT);
    const latestReceivedAt = clickTimestamps.at(-1) ?? receivedAt;
    const suspiciousReason = clientFlagged
      ? "client-flagged"
      : detectSuspiciousClickPattern(clickTimestamps, Math.max(receivedAt, latestReceivedAt));

    if (suspiciousReason) {
      await tx.update(noodlePlayers).set({
        clickTimestamps: JSON.stringify(clickTimestamps),
        antiClickAchievementUnlocked: true,
        robotChallengeActive: true,
        robotConfessionCount: 0,
      }).where(eq(noodlePlayers.id, player.id));
      const flagged = await tx.select().from(noodlePlayers).where(eq(noodlePlayers.id, player.id)).limit(1);
      return flagged[0] ? {
        player: flagged[0],
        previousExperience,
        accepted: false,
        suspiciousReason,
        newlyUnlockedAntiClick: !player.antiClickAchievementUnlocked,
      } : null;
    }

    const totalClicks = sql`${noodlePlayers.totalClicks} + 1`;
    const experience = (BigInt(previousExperience) + BigInt(1)).toString();
    const clickUpdate = { totalClicks, experience, clickTimestamps: JSON.stringify(clickTimestamps) };
    switch (mood) {
      case "beef":
        await tx.update(noodlePlayers).set({ ...clickUpdate, beefClicks: sql`${noodlePlayers.beefClicks} + 1` })
          .where(eq(noodlePlayers.id, player.id));
        break;
      case "chicken":
        await tx.update(noodlePlayers).set({ ...clickUpdate, chickenClicks: sql`${noodlePlayers.chickenClicks} + 1` })
          .where(eq(noodlePlayers.id, player.id));
        break;
      case "octopus":
        await tx.update(noodlePlayers).set({ ...clickUpdate, octopusClicks: sql`${noodlePlayers.octopusClicks} + 1` })
          .where(eq(noodlePlayers.id, player.id));
        break;
    }

    const updated = await tx.select().from(noodlePlayers).where(eq(noodlePlayers.id, player.id)).limit(1);
    return updated[0] ? {
      player: updated[0],
      previousExperience,
      accepted: true,
      suspiciousReason: null,
      newlyUnlockedAntiClick: false,
    } : null;
  });
}

export async function unlockBurnedFingerAchievement(token: string): Promise<boolean | null> {
  const db = await requireNoodleDb();
  const tokenHash = hashToken(token);
  return db.transaction(async (tx) => {
    const rows = await tx.select({ id: noodlePlayers.id, unlocked: noodlePlayers.burnedFingerUnlocked })
      .from(noodlePlayers).where(eq(noodlePlayers.loginTokenHash, tokenHash)).limit(1).for("update");
    const player = rows[0];
    if (!player) return null;
    if (player.unlocked) return false;
    await tx.update(noodlePlayers).set({ burnedFingerUnlocked: true }).where(eq(noodlePlayers.id, player.id));
    return true;
  });
}

export async function confessAsRobot(token: string) {
  const db = await requireNoodleDb();
  const tokenHash = hashToken(token);
  return db.transaction(async (tx) => {
    const rows = await tx.select({
      id: noodlePlayers.id,
      confessionCount: noodlePlayers.robotConfessionCount,
      unlocked: noodlePlayers.robotEaterUnlocked,
      challengeActive: noodlePlayers.robotChallengeActive,
    }).from(noodlePlayers).where(eq(noodlePlayers.loginTokenHash, tokenHash)).limit(1).for("update");
    const player = rows[0];
    if (!player || !player.challengeActive) return null;

    const result = advanceRobotConfession(player.confessionCount, player.unlocked);
    if (result.unlocked) {
      await tx.update(noodlePlayers).set({
        robotConfessionCount: ROBOT_CONFESSION_TAPS_REQUIRED,
        robotEaterUnlocked: true,
        robotChallengeActive: true,
        robotIconExpiresAt: result.robotIconExpiresAt,
      }).where(eq(noodlePlayers.id, player.id));
    } else {
      await tx.update(noodlePlayers).set({ robotConfessionCount: result.confessionCount })
        .where(eq(noodlePlayers.id, player.id));
    }
    return {
      confessionCount: result.unlocked ? ROBOT_CONFESSION_TAPS_REQUIRED : result.confessionCount,
      tapsRequired: ROBOT_CONFESSION_TAPS_REQUIRED,
      unlocked: result.unlocked,
      newlyUnlocked: result.newlyUnlocked,
      robotIconExpiresAt: result.robotIconExpiresAt,
    };
  });
}

export async function resetRobotConfession(token: string): Promise<boolean> {
  const db = await requireNoodleDb();
  const tokenHash = hashToken(token);
  return db.transaction(async (tx) => {
    const rows = await tx.select({ id: noodlePlayers.id })
      .from(noodlePlayers).where(eq(noodlePlayers.loginTokenHash, tokenHash)).limit(1).for("update");
    if (!rows[0]) return false;
    await tx.update(noodlePlayers).set({ robotConfessionCount: 0, robotChallengeActive: false })
      .where(eq(noodlePlayers.id, rows[0].id));
    return true;
  });
}

/** Silent honeypot action: hide only the profile authenticated by this token and per-profile key. */
export async function activateHiddenNoodleBoost(token: string, honeypotKey: string): Promise<void> {
  const db = await requireNoodleDb();
  await db.update(noodlePlayers).set({ leaderboardHidden: true }).where(and(
    eq(noodlePlayers.loginTokenHash, hashToken(token)),
    eq(noodlePlayers.honeypotKey, honeypotKey),
  ));
}
