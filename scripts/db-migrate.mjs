import "dotenv/config";
import { spawn } from "node:child_process";

if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL is required for schema migrations. Use Supabase Direct connection (or Session pooler when IPv4 is required).");
  process.exit(1);
}

const child = spawn("pnpm", ["exec", "drizzle-kit", "migrate"], {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  console.error("Could not start Drizzle migration runner:", error.message);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Migration runner stopped by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
