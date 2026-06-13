import { neon } from "@neondatabase/serverless";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const databaseUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("Set DATABASE_ADMIN_URL or DATABASE_URL before running migrations.");

const sql = neon(databaseUrl);
await sql.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`);

const lockName = "__migration_lock__";
const lockOwner = randomUUID();
const [lock] = await sql.query(
  `INSERT INTO schema_migrations (name, checksum, applied_at)
   VALUES ($1, $2, now())
   ON CONFLICT (name) DO UPDATE
     SET checksum = EXCLUDED.checksum,
         applied_at = now()
     WHERE schema_migrations.applied_at < now() - interval '30 minutes'
   RETURNING checksum`,
  [lockName, lockOwner],
);
if (lock?.checksum !== lockOwner) {
  throw new Error("Another database migration is already running.");
}

try {
  const directory = resolve("migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const source = await readFile(resolve(directory, file), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    const [existing] = await sql.query("SELECT checksum FROM schema_migrations WHERE name = $1", [
      file,
    ]);
    if (existing) {
      if (existing.checksum !== checksum) throw new Error(`Applied migration changed: ${file}`);
      continue;
    }

    const statements = source
      .split(/;\s*(?:\r?\n|$)/)
      .map((statement) => statement.trim())
      .filter(Boolean);
    await sql.transaction([
      ...statements.map((statement) => sql.query(statement)),
      sql.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [file, checksum]),
    ]);
    console.log(JSON.stringify({ level: "info", event: "migration_applied", migration: file }));
  }
} finally {
  await sql.query("DELETE FROM schema_migrations WHERE name = $1 AND checksum = $2", [
    lockName,
    lockOwner,
  ]);
}
