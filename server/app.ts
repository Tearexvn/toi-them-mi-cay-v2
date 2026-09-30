import "dotenv/config";
import express, { type Express } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./_core/oauth";
import { registerStorageProxy } from "./_core/storageProxy";
import { createContext } from "./_core/context";
import { appRouter } from "./routers";

export function configureApp(app: Express) {
  // Vercel terminates HTTPS before forwarding the request to this Express app.
  app.set("trust proxy", 1);

  // Game requests are small JSON payloads; large uploads use object storage.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  // Avoid Express swallowing an unexpected error and leaving a warm serverless
  // instance in an unknown state. tRPC continues to format its own errors.
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[Express] Unhandled request error", error);
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

export function createApp() {
  return configureApp(express());
}
