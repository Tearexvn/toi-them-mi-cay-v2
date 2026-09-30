import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { ENV } from "./_core/env";
import {
  getShadowBannedPlayers,
  getNoodleLeaderboard,
  joinNoodlePlayer,
  liftNoodleShadowban,
  NoodleIdentityError,
  normalizeNoodleName,
  NoodleBoard,
  NoodleMood,
  recordNoodleClick,
  confessAsRobot,
  resetRobotConfession,
  unlockBurnedFingerAchievement,
  activateHiddenNoodleBoost,
} from "./db";

const nameInput = z.string().trim().min(1, "Nhập tên trước đã nhé.").max(24, "Tên tối đa 24 ký tự thôi nhé.")
  .refine((value) => !/[<>\u0000-\u001f\u007f]/.test(value), "Tên có ký tự không hợp lệ.");
const tokenInput = z.string().min(32).max(128);
const moodInput = z.enum(["beef", "chicken", "octopus"]);
const boardInput = z.enum(["total", "beef", "chicken", "octopus"]);

const ownerProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ENV.ownerOpenId || ctx.user.openId !== ENV.ownerOpenId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Không có quyền quản lý hồ sơ mì cay." });
  }
  return next({ ctx });
});

function mapIdentityError(error: unknown): never {
  if (error instanceof NoodleIdentityError) {
    const code = error.reason === "name-taken" ? "CONFLICT" :
      error.reason === "not-found" ? "NOT_FOUND" :
      error.reason === "invalid-session" ? "UNAUTHORIZED" : "SERVICE_UNAVAILABLE";
    throw new TRPCError({ code, message: error.message, cause: error });
  }
  console.error("[Noodle leaderboard] Request failed", error);
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "BXH đang nghỉ ăn mì một chút. Thử lại sau nhé." });
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    isOwner: publicProcedure.query(({ ctx }) => Boolean(ENV.ownerOpenId && ctx.user?.openId === ENV.ownerOpenId)),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  noodle: router({
    leaderboard: publicProcedure
      .input(z.object({ token: tokenInput.optional(), board: boardInput.optional() }).optional())
      .query(async ({ input }) => {
        try {
          const token = input?.token;
          const board: NoodleBoard = input?.board ?? "total";
          return await getNoodleLeaderboard(token, board);
        } catch (error) {
          mapIdentityError(error);
        }
      }),
    join: publicProcedure
      .input(z.object({ name: nameInput, token: tokenInput.optional() }))
      .mutation(async ({ input }) => {
        const name = normalizeNoodleName(input.name);
        if (name.length > 24) throw new TRPCError({ code: "BAD_REQUEST", message: "Tên tối đa 24 ký tự thôi nhé." });
        try {
          return await joinNoodlePlayer(name, input.token);
        } catch (error) {
          mapIdentityError(error);
        }
      }),
    activateNoodleBoost: publicProcedure
      .input(z.object({ token: tokenInput, honeypotKey: z.string().min(32).max(64) }))
      .mutation(async ({ input }) => {
        await activateHiddenNoodleBoost(input.token, input.honeypotKey);
        return { activated: true } as const;
      }),
    shadowModeration: router({
      list: ownerProcedure.query(async () => {
        try {
          return await getShadowBannedPlayers();
        } catch (error) {
          mapIdentityError(error);
        }
      }),
      lift: ownerProcedure
        .input(z.object({ playerId: z.number().int().positive() }))
        .mutation(async ({ input }) => {
          try {
            const lifted = await liftNoodleShadowban(input.playerId);
            if (!lifted) throw new TRPCError({ code: "NOT_FOUND", message: "Hồ sơ không còn shadowban." });
            return { lifted: true } as const;
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            mapIdentityError(error);
          }
        }),
    }),
    unlockBurnedFinger: publicProcedure
      .input(z.object({ token: tokenInput }))
      .mutation(async ({ input }) => {
        try {
          const newlyUnlocked = await unlockBurnedFingerAchievement(input.token);
          if (newlyUnlocked === null) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "Phiên chơi không còn hợp lệ. Hãy nhập lại tên nhé." });
          }
          return { newlyUnlocked };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          mapIdentityError(error);
        }
      }),
    confessAsRobot: publicProcedure
      .input(z.object({ token: tokenInput }))
      .mutation(async ({ input }) => {
        try {
          const result = await confessAsRobot(input.token);
          if (!result) throw new TRPCError({ code: "UNAUTHORIZED", message: "Phiên chơi không còn hợp lệ. Hãy nhập lại tên nhé." });
          return result;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          mapIdentityError(error);
        }
      }),
    resetRobotConfession: publicProcedure
      .input(z.object({ token: tokenInput }))
      .mutation(async ({ input }) => {
        try {
          const reset = await resetRobotConfession(input.token);
          if (!reset) throw new TRPCError({ code: "UNAUTHORIZED", message: "Phiên chơi không còn hợp lệ. Hãy nhập lại tên nhé." });
          return { reset: true } as const;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          mapIdentityError(error);
        }
      }),
    click: publicProcedure
      .input(z.object({ token: tokenInput, mood: moodInput }))
      .mutation(async ({ input }) => {
        const mood: NoodleMood = input.mood;
        try {
          const result = await recordNoodleClick(input.token, mood);
          if (!result) throw new TRPCError({ code: "UNAUTHORIZED", message: "Phiên chơi không còn hợp lệ. Hãy nhập lại tên nhé." });
          const player = result.player;
          return {
            totalClicks: player.totalClicks,
            experience: player.experience,
            previousExperience: result.previousExperience,
            beefClicks: player.beefClicks,
            chickenClicks: player.chickenClicks,
            octopusClicks: player.octopusClicks,
            accepted: result.accepted,
            suspiciousReason: result.suspiciousReason,
            antiClickAchievementUnlocked: player.antiClickAchievementUnlocked,
            newlyUnlockedAntiClick: result.newlyUnlockedAntiClick,
          };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          mapIdentityError(error);
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
