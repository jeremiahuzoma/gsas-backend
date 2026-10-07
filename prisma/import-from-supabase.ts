/**
 * One-way, non-destructive import from the original Supabase database into the
 * new PostgreSQL database managed by Prisma.
 *
 *   SOURCE_DATABASE_URL  Supabase Postgres connection string (read-only use;
 *                        Supabase dashboard -> Project settings -> Database)
 *   DATABASE_URL         target database, already migrated with
 *                        `npx prisma migrate deploy`
 *
 *   npm run import:supabase -- --dry-run   # counts only, writes nothing
 *   npm run import:supabase                # import
 *
 * Guarantees
 *  - The source is opened in a READ ONLY transaction: nothing there can change.
 *  - The target is written in ONE transaction: either everything imports or
 *    nothing does.
 *  - Nothing in the target is deleted or overwritten, except notification
 *    templates, which take the source's (admin-edited) text. Re-running is
 *    safe: rows that already exist (same primary key) are skipped.
 *  - Primary keys are preserved, so every relationship survives.
 *  - auth.users -> users keeps the bcrypt password hash: people sign in with
 *    their existing password. Accounts without a password (magic link / OAuth)
 *    get an unusable hash and are listed at the end.
 *  - If the target was seeded first, catalogue appliances are matched by name
 *    and every reference (rigs and saved configurations) is remapped.
 */
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { Client } from "pg";

type Row = Record<string, unknown>;

const dryRun = process.argv.includes("--dry-run");

/** Columns copied per table, in insert order (parents before children). */
const TABLES: Array<{ table: string; columns: string[]; conflict: string }> = [
  { table: "profiles", columns: ["id", "full_name", "email", "phone_number", "created_at", "updated_at"], conflict: "(id)" },
  { table: "user_roles", columns: ["id", "user_id", "role", "created_at"], conflict: "(user_id, role)" },
  {
    table: "meters",
    columns: [
      "id", "user_id", "meter_number", "customer_name", "phone_number", "initial_balance", "balance_kwh",
      "total_consumed_kwh", "voltage", "current_amps", "power_watts", "frequency_hz", "power_factor", "status",
      "gsm", "signal_dbm", "tariff_per_kwh", "low_threshold", "critical_threshold", "urgent_threshold",
      "notified_low", "notified_critical", "notified_urgent", "notified_depleted", "simulation_running",
      "simulation_speed", "simulated_seconds", "last_tick_at", "last_reading_at", "created_at", "updated_at",
    ],
    conflict: "(id)",
  },
  {
    table: "meter_appliances",
    columns: ["id", "meter_id", "appliance_id", "is_on", "cycle_phase", "energy_kwh", "created_at"],
    conflict: "(id)",
  },
  {
    table: "meter_readings",
    columns: ["id", "meter_id", "voltage", "current_amps", "power_watts", "frequency_hz", "power_factor", "energy_kwh", "balance_kwh", "recorded_at"],
    conflict: "(id)",
  },
  {
    table: "recharges",
    columns: ["id", "meter_id", "amount_kwh", "previous_balance", "new_balance", "reference", "created_at"],
    conflict: "(id)",
  },
  {
    table: "alerts",
    columns: ["id", "meter_id", "user_id", "type", "severity", "threshold", "balance_kwh", "message", "sms_status", "created_at"],
    conflict: "(id)",
  },
  {
    table: "sms_logs",
    columns: [
      "id", "meter_id", "user_id", "alert_id", "phone_number", "message", "provider", "provider_message_id", "status",
      "failure_reason", "cost", "sent_at", "delivered_at", "created_at", "attempts", "last_attempt_at", "next_attempt_at",
    ],
    conflict: "(id)",
  },
  {
    table: "ussd_sessions",
    columns: ["id", "session_id", "phone_number", "service_code", "meter_id", "user_id", "request_text", "response_text", "status", "started_at", "ended_at"],
    conflict: "DO NOTHING_ANY",
  },
  {
    table: "meter_configurations",
    columns: ["id", "meter_id", "name", "is_default", "items", "created_at", "updated_at"],
    conflict: "(id)",
  },
  {
    table: "webhook_events",
    columns: ["id", "provider", "event_type", "external_id", "signature_verified", "payload", "response_text", "status", "created_at"],
    conflict: "DO NOTHING_ANY",
  },
];

const APPLIANCE_COLUMNS = [
  "id", "name", "category", "icon", "rated_power", "idle_power", "voltage", "power_factor",
  "usage_profile", "duty_cycle", "cycle_seconds", "created_at",
];

async function main() {
  const sourceUrl = process.env["SOURCE_DATABASE_URL"];
  const targetUrl = process.env["DATABASE_URL"];
  if (!sourceUrl || !targetUrl) throw new Error("Set SOURCE_DATABASE_URL and DATABASE_URL");
  if (sourceUrl === targetUrl) throw new Error("SOURCE_DATABASE_URL and DATABASE_URL must differ");

  const source = new Client({ connectionString: sourceUrl });
  const target = new Client({ connectionString: targetUrl });
  await source.connect();
  await target.connect();

  try {
    await source.query("BEGIN TRANSACTION READ ONLY");
    await assertTargetMigrated(target);

    const report: Array<[string, number, number]> = [];
    const passwordless: string[] = [];

    // ---- users (from Supabase auth.users) ----
    const authUsers = await source.query<{ id: string; email: string; encrypted_password: string | null; created_at: Date }>(
      `SELECT id, lower(email) AS email, encrypted_password, created_at
         FROM auth.users WHERE email IS NOT NULL AND email <> '' ORDER BY created_at`,
    );
    const users = authUsers.rows.map((u) => {
      const hasHash = typeof u.encrypted_password === "string" && /^\$2[aby]\$/.test(u.encrypted_password);
      if (!hasHash) passwordless.push(u.email);
      return {
        id: u.id,
        email: u.email,
        // "!" prefix makes the hash unusable: bcrypt.compare always fails.
        password_hash: hasHash ? u.encrypted_password : `!no-password!${randomBytes(16).toString("hex")}`,
        token_version: 0,
        created_at: u.created_at,
        updated_at: u.created_at,
      };
    });

    // ---- appliances, remapped by name onto any rows already in the target ----
    const srcAppliances = (await source.query(`SELECT ${APPLIANCE_COLUMNS.join(", ")} FROM public.appliances`)).rows;
    const tgtAppliances = (await target.query<{ id: string; name: string }>("SELECT id, name FROM appliances")).rows;
    const targetByName = new Map(tgtAppliances.map((a) => [a.name, a.id]));
    const applianceMap = new Map<string, string>();
    const appliancesToInsert: Row[] = [];
    for (const a of srcAppliances) {
      const existing = targetByName.get(a["name"] as string);
      if (existing) applianceMap.set(a["id"] as string, existing);
      else {
        applianceMap.set(a["id"] as string, a["id"] as string);
        appliancesToInsert.push(a);
      }
    }
    const remap = (id: unknown) => applianceMap.get(id as string) ?? (id as string);

    const templates = (
      await source.query("SELECT id, key, body, updated_at, channel, description FROM public.notification_templates")
    ).rows;

    const tableRows = new Map<string, Row[]>();
    for (const t of TABLES) {
      const rows = (await source.query(`SELECT ${t.columns.join(", ")} FROM public.${t.table}`)).rows as Row[];
      if (t.table === "meter_appliances") for (const r of rows) r["appliance_id"] = remap(r["appliance_id"]);
      if (t.table === "meter_configurations") {
        for (const r of rows) {
          const items = Array.isArray(r["items"]) ? (r["items"] as Row[]) : [];
          r["items"] = JSON.stringify(items.map((i) => ({ ...i, applianceId: remap(i["applianceId"]) })));
        }
      }
      if (t.table === "webhook_events") for (const r of rows) r["payload"] = r["payload"] == null ? null : JSON.stringify(r["payload"]);
      tableRows.set(t.table, rows);
    }

    if (dryRun) {
      console.log("DRY RUN - nothing written.\n");
      console.log(`users                   ${users.length}`);
      console.log(`appliances              ${srcAppliances.length} (${appliancesToInsert.length} new, ${srcAppliances.length - appliancesToInsert.length} matched by name)`);
      console.log(`notification_templates  ${templates.length}`);
      for (const t of TABLES) console.log(`${t.table.padEnd(24)}${tableRows.get(t.table)!.length}`);
      if (passwordless.length) console.log(`\nAccounts without a password: ${passwordless.join(", ")}`);
      await source.query("ROLLBACK");
      return;
    }

    await target.query("BEGIN");
    try {
      report.push(["users", users.length, await insertRows(target, "users", Object.keys(users[0] ?? { id: 1 }), users, "(id)")]);
      report.push([
        "appliances",
        srcAppliances.length,
        await insertRows(target, "appliances", APPLIANCE_COLUMNS, appliancesToInsert, "(id)"),
      ]);
      for (const t of TABLES) {
        const rows = tableRows.get(t.table)!;
        report.push([t.table, rows.length, await insertRows(target, t.table, t.columns, rows, t.conflict)]);
      }
      // Templates: the source text (possibly admin-edited) wins.
      let templatesWritten = 0;
      for (const t of templates) {
        const res = await target.query(
          `INSERT INTO notification_templates (id, key, body, updated_at, channel, description)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, channel = EXCLUDED.channel,
             description = EXCLUDED.description, updated_at = EXCLUDED.updated_at`,
          [t.id, t.key, t.body, t.updated_at, t.channel ?? "SMS", t.description ?? null],
        );
        templatesWritten += res.rowCount ?? 0;
      }
      report.push(["notification_templates", templates.length, templatesWritten]);

      // Keep the bigserial ahead of imported reading ids.
      await target.query(
        "SELECT setval(pg_get_serial_sequence('meter_readings', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM meter_readings), 1))",
      );
      await target.query("COMMIT");
    } catch (error) {
      await target.query("ROLLBACK");
      throw error;
    }
    await source.query("ROLLBACK");

    console.log("Import complete (target transaction committed).\n");
    console.log("table                   source  written (already present rows are skipped)");
    for (const [table, src, written] of report) {
      console.log(`${table.padEnd(24)}${String(src).padStart(6)}  ${String(written).padStart(7)}`);
    }
    if (passwordless.length) {
      console.log(
        `\n${passwordless.length} account(s) had no password in Supabase (magic link / OAuth) and cannot sign in until one is set:\n  ${passwordless.join("\n  ")}`,
      );
    }
  } finally {
    await source.end();
    await target.end();
  }
}

async function assertTargetMigrated(target: Client) {
  const res = await target.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('users','meters','webhook_events')",
  );
  if (res.rows[0]?.n !== 3) {
    throw new Error("Target database is not migrated. Run `npx prisma migrate deploy` first.");
  }
}

/** Batched INSERT ... ON CONFLICT DO NOTHING. Returns the number of rows actually written. */
async function insertRows(client: Client, table: string, columns: string[], rows: Row[], _conflict: string) {
  let written = 0;
  const batchSize = 500;
  // Any unique/PK clash (row already imported) is skipped, never overwritten.
  const onConflict = "ON CONFLICT DO NOTHING";
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values: unknown[] = [];
    const tuples = batch.map((row) => {
      const placeholders = columns.map((c) => {
        values.push(row[c] ?? null);
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    const res = await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")} ${onConflict}`,
      values,
    );
    written += res.rowCount ?? 0;
  }
  return written;
}

main().catch((error) => {
  console.error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
