import { bigint, boolean, int, longtext, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing the optional Manus OAuth flow.
 * The noodle leaderboard intentionally uses a separate, passwordless nickname identity.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const noodlePlayers = mysqlTable("noodle_players", {
  id: int("id").autoincrement().primaryKey(),
  displayName: varchar("displayName", { length: 48 }).notNull(),
  nameKey: varchar("nameKey", { length: 96 }).notNull().unique(),
  loginTokenHash: varchar("loginTokenHash", { length: 64 }).notNull().unique(),
  totalClicks: int("totalClicks", { unsigned: true }).default(0).notNull(),
  experience: longtext("experience").notNull(),
  beefClicks: int("beefClicks", { unsigned: true }).default(0).notNull(),
  chickenClicks: int("chickenClicks", { unsigned: true }).default(0).notNull(),
  octopusClicks: int("octopusClicks", { unsigned: true }).default(0).notNull(),
  burnedFingerUnlocked: boolean("burnedFingerUnlocked").default(false).notNull(),
  clickTimestamps: varchar("clickTimestamps", { length: 768 }).default("[]").notNull(),
  leaderboardHidden: boolean("leaderboardHidden").default(false).notNull(),
  honeypotKey: varchar("honeypotKey", { length: 64 }).default("").notNull(),
  antiClickAchievementUnlocked: boolean("antiClickAchievementUnlocked").default(false).notNull(),
  robotChallengeActive: boolean("robotChallengeActive").default(false).notNull(),
  robotConfessionCount: int("robotConfessionCount", { unsigned: true }).default(0).notNull(),
  robotEaterUnlocked: boolean("robotEaterUnlocked").default(false).notNull(),
  robotIconExpiresAt: bigint("robotIconExpiresAt", { mode: "number", unsigned: true }),
  shadowBanned: boolean("shadowBanned").default(false).notNull(),
  shadowBanReason: varchar("shadowBanReason", { length: 32 }),
  shadowBannedAt: timestamp("shadowBannedAt"),
  shadowTotalClicks: int("shadowTotalClicks", { unsigned: true }).default(0).notNull(),
  shadowBeefClicks: int("shadowBeefClicks", { unsigned: true }).default(0).notNull(),
  shadowChickenClicks: int("shadowChickenClicks", { unsigned: true }).default(0).notNull(),
  shadowOctopusClicks: int("shadowOctopusClicks", { unsigned: true }).default(0).notNull(),
  shadowExperience: longtext("shadowExperience"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NoodlePlayer = typeof noodlePlayers.$inferSelect;
