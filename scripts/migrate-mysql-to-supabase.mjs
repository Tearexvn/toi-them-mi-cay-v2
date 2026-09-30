import "dotenv/config";
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import postgres from "postgres";

const sourceUrl = process.env.SOURCE_MYSQL_URL;
const targetUrl = process.env.SUPABASE_DIRECT_URL;
const dryRun = process.argv.includes("--dry-run");
const allowNonEmpty = process.env.ALLOW_NON_EMPTY_SUPABASE === "1";

if (!sourceUrl || !targetUrl) {
  console.error("Set SOURCE_MYSQL_URL and SUPABASE_DIRECT_URL in your local environment. Do not commit credentials.");
  process.exit(1);
}

const definitions = [
  {
    table: "users",
    columns: ["id", "openId", "name", "email", "loginMethod", "role", "createdAt", "updatedAt", "lastSignedIn"],
    required: ["id", "openId"],
  },
  {
    table: "noodle_players",
    columns: [
      "id", "displayName", "nameKey", "loginTokenHash", "totalClicks", "experience",
      "beefClicks", "chickenClicks", "octopusClicks", "burnedFingerUnlocked",
      "clickTimestamps", "leaderboardHidden", "honeypotKey", "antiClickAchievementUnlocked",
      "robotChallengeActive", "robotConfessionCount", "robotEaterUnlocked", "robotIconExpiresAt",
      "shadowBanned", "shadowBanReason", "shadowBannedAt", "shadowTotalClicks",
      "shadowBeefClicks", "shadowChickenClicks", "shadowOctopusClicks", "shadowExperience",
      "createdAt", "updatedAt",
    ],
    required: ["id", "displayName", "nameKey", "loginTokenHash", "totalClicks"],
  },
];

const numericColumns = new Set([
  "id", "totalClicks", "beefClicks", "chickenClicks", "octopusClicks",
  "robotConfessionCount", "robotIconExpiresAt", "shadowTotalClicks", "shadowBeefClicks",
  "shadowChickenClicks", "shadowOctopusClicks",
]);
const booleanColumns = new Set([
  "burnedFingerUnlocked", "leaderboardHidden", "antiClickAchievementUnlocked",
  "robotChallengeActive", "robotEaterUnlocked", "shadowBanned",
]);
const now = () => new Date();

function defaultFor(table, column, row) {
  if (column === "createdAt" || column === "updatedAt" || column === "lastSignedIn") return now();
  if (table === "users") {
    if (column === "role") return "user";
    if (["name", "email", "loginMethod"].includes(column)) return null;
  }
  if (table === "noodle_players") {
    if (column === "experience") return String(row.totalClicks ?? 0);
    if (column === "clickTimestamps") return "[]";
    if (column === "honeypotKey") return randomBytes(24).toString("base64url");
    if (column === "robotIconExpiresAt" || column === "shadowBanReason" || column === "shadowBannedAt" || column === "shadowExperience") return null;
    if (booleanColumns.has(column)) return false;
    if (numericColumns.has(column)) return 0;
  }
  return null;
}

function normalizedValue(table, column, row) {
  let value = Object.hasOwn(row, column) ? row[column] : defaultFor(table, column, row);
  if (table === "noodle_players" && column === "honeypotKey" && !value) {
    value = randomBytes(24).toString("base64url");
  }
  if (value == null) return null;
  if (booleanColumns.has(column)) return value === true || value === 1 || value === "1";
  if (numericColumns.has(column)) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error(`Unsafe integer found in ${table}.${column}; stop before importing data.`);
    return number;
  }
  return value;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function buildUpsert(table, columns, rows) {
  const values = [];
  const valueRows = rows.map((row) => {
    const placeholders = columns.map((column) => {
      values.push(row[column]);
      return `$${values.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  const quotedTable = quoteIdentifier(table);
  const quotedColumns = columns.map(quoteIdentifier).join(", ");
  const updates = columns
    .filter((column) => column !== "id")
    .map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`)
    .join(", ");
  return {
    query: `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES ${valueRows.join(", ")} ON CONFLICT ("id") DO UPDATE SET ${updates}`,
    values,
  };
}

async function countRows(target, table) {
  const result = await target.unsafe(`SELECT count(*)::bigint AS count FROM ${quoteIdentifier(table)}`);
  return Number(result[0].count);
}

const source = await mysql.createConnection(sourceUrl);
const target = postgres(targetUrl, { max: 1, prepare: false, connect_timeout: 10 });

try {
  const targetCounts = {};
  for (const { table } of definitions) targetCounts[table] = await countRows(target, table);
  if (!allowNonEmpty && Object.values(targetCounts).some((count) => count > 0)) {
    throw new Error("Supabase target is not empty. Use a fresh test project, or explicitly set ALLOW_NON_EMPTY_SUPABASE=1 only when resuming/merging intentionally.");
  }

  const sourceCounts = {};
  for (const definition of definitions) {
    const [columnRows] = await source.query(`SHOW COLUMNS FROM \`${definition.table}\``);
    const existingColumns = new Set(columnRows.map((column) => column.Field));
    const missingRequired = definition.required.filter((column) => !existingColumns.has(column));
    if (missingRequired.length > 0) {
      throw new Error(`Source table ${definition.table} is missing required columns: ${missingRequired.join(", ")}`);
    }

    const [countRowsResult] = await source.query(`SELECT COUNT(*) AS rowCount FROM \`${definition.table}\``);
    sourceCounts[definition.table] = Number(countRowsResult[0].rowCount);
    console.log(`${definition.table}: ${sourceCounts[definition.table]} source rows; ${definition.columns.filter((column) => !existingColumns.has(column)).length} newer fields will use safe defaults.`);
  }

  if (dryRun) {
    console.log("Dry run complete. No Supabase rows were changed.");
  } else {
    for (const definition of definitions) {
      const [columnRows] = await source.query(`SHOW COLUMNS FROM \`${definition.table}\``);
      const existingColumns = new Set(columnRows.map((column) => column.Field));
      let lastId = 0;
      let imported = 0;
      while (true) {
        const [sourceRows] = await source.query(
          `SELECT * FROM \`${definition.table}\` WHERE \`id\` > ? ORDER BY \`id\` LIMIT 500`,
          [lastId],
        );
        if (sourceRows.length === 0) break;
        const rows = sourceRows.map((sourceRow) => Object.fromEntries(
          definition.columns.map((column) => [column, normalizedValue(definition.table, column, sourceRow)]),
        ));
        const { query, values } = buildUpsert(definition.table, definition.columns, rows);
        await target.unsafe(query, values);
        imported += rows.length;
        lastId = Number(sourceRows.at(-1).id);
      }
      console.log(`${definition.table}: imported ${imported} rows.`);
    }

    for (const table of ["users", "noodle_players"]) {
      await target.unsafe(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${quoteIdentifier(table)}`,
      );
    }
    console.log("Data copy complete. Source MySQL was read only and was not modified.");
  }
} catch (error) {
  console.error("Migration stopped without deleting source data:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await source.end();
  await target.end({ timeout: 5 });
}
