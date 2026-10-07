import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";

/**
 * Recreates the TEST database schema from the real migration SQL, then seeds
 * reference data. Refuses to touch any database not named *_test.
 */
export default async function globalSetup() {
  const url =
    process.env["TEST_DATABASE_URL"] ?? "postgresql://postgres:postgres@localhost:5432/watts_test";
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to reset "${dbName}": e2e tests only run against a *_test database.`);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const migration = readFileSync(
      join(__dirname, "../../prisma/migrations/0001_baseline/migration.sql"),
      "utf8",
    );
    await client.query(migration);
  } finally {
    await client.end();
  }

  // Seed with the real seed script logic.
  process.env["DATABASE_URL"] = url;
  const { execFileSync } = await import("node:child_process");
  execFileSync("npx", ["ts-node", join(__dirname, "../../prisma/seed.ts")], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
