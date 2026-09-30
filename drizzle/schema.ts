import { bigint, boolean, integer, pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Core user table backing the optional Manus OAuth flow.
 * The noodle leaderboard intentionally uses a separate, passwordless nickname identity.
 */
export const userRole = pgEnum("user_role", ["user", "admin"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRole("role").default("user").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const noodlePlayers = pgTable("noodle_players", {
  id: serial("id").primaryKey(),
  displayName: varchar("displayName", { length: 48 }).notNull(),
  nameKey: varchar("nameKey", { length: 96 }).notNull().unique(),
  loginTokenHash: varchar("loginTokenHash", { length: 64 }).notNull().unique(),
  totalClicks: bigint("totalClicks", { mode: "number" }).default(0).notNull(),
  experience: text("experience").notNull(),
  beefClicks: bigint("beefClicks", { mode: "number" }).default(0).notNull(),
  chickenClicks: bigint("chickenClicks", { mode: "number" }).default(0).notNull(),
  octopusClicks: bigint("octopusClicks", { mode: "number" }).default(0).notNull(),
  burnedFingerUnlocked: boolean("burnedFingerUnlocked").default(false).notNull(),
  clickTimestamps: varchar("clickTimestamps", { length: 768 }).default("[]").notNull(),
  leaderboardHidden: boolean("leaderboardHidden").default(false).notNull(),
  honeypotKey: varchar("honeypotKey", { length: 64 }).default("").notNull(),
  antiClickAchievementUnlocked: boolean("antiClickAchievementUnlocked").default(false).notNull(),
  robotChallengeActive: boolean("robotChallengeActive").default(false).notNull(),
  robotConfessionCount: integer("robotConfessionCount").default(0).notNull(),
  robotEaterUnlocked: boolean("robotEaterUnlocked").default(false).notNull(),
  robotIconExpiresAt: bigint("robotIconExpiresAt", { mode: "number" }),
  shadowBanned: boolean("shadowBanned").default(false).notNull(),
  shadowBanReason: varchar("shadowBanReason", { length: 32 }),
  shadowBannedAt: timestamp("shadowBannedAt", { withTimezone: true, mode: "date" }),
  shadowTotalClicks: bigint("shadowTotalClicks", { mode: "number" }).default(0).notNull(),
  shadowBeefClicks: bigint("shadowBeefClicks", { mode: "number" }).default(0).notNull(),
  shadowChickenClicks: bigint("shadowChickenClicks", { mode: "number" }).default(0).notNull(),
  shadowOctopusClicks: bigint("shadowOctopusClicks", { mode: "number" }).default(0).notNull(),
  shadowExperience: text("shadowExperience"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type NoodlePlayer = typeof noodlePlayers.$inferSelect;
