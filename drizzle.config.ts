import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Prefer Supabase's direct URL for schema migrations. The placeholder lets
// `drizzle-kit generate` run without credentials; `db:migrate` validates it.
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:5432/noodle_app";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/postgres",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
