import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
if (!adminUrl || !appUrl) {
  throw new Error("Set DATABASE_ADMIN_URL and DATABASE_URL before verifying the database.");
}

const requiredMigrations = [
  "001_initial.sql",
  "002_rate_limit_buckets.sql",
  "003_job_leases.sql",
  "004_tmdb_payload_cache.sql",
  "005_product_operations.sql",
];
const requiredPermissions = {
  analytics_events: ["SELECT", "INSERT"],
  catalog_pages: ["SELECT", "INSERT", "UPDATE"],
  catalog_sync_events: ["SELECT", "INSERT"],
  genres: ["SELECT", "INSERT", "UPDATE"],
  job_leases: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  media_title_genres: ["SELECT", "INSERT"],
  media_titles: ["SELECT", "INSERT", "UPDATE"],
  rate_limit_buckets: ["SELECT", "INSERT", "UPDATE"],
  schema_migrations: ["SELECT"],
  support_tickets: ["SELECT", "INSERT", "UPDATE"],
  tmdb_payload_cache: ["SELECT", "INSERT", "UPDATE"],
};
const requiredTables = Object.keys(requiredPermissions);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const admin = neon(adminUrl);
const app = neon(appUrl);
const [adminIdentity] = await admin.query("SELECT current_user");
const [appIdentity] = await app.query(
  `SELECT
    current_user,
    has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema_objects`,
);

assert(
  adminIdentity.current_user !== appIdentity.current_user,
  "The application and administrator database roles must be different.",
);
assert(
  appIdentity.can_create_schema_objects === false,
  "The application database role must not create schema objects.",
);

const migrations = await app.query(
  `SELECT name
   FROM schema_migrations
   WHERE name = ANY($1::text[])
   ORDER BY name`,
  [requiredMigrations],
);
assert(
  migrations.length === requiredMigrations.length,
  "One or more required database migrations are missing.",
);

const tables = await app.query(
  `SELECT table_name
   FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name = ANY($1::text[])
   ORDER BY table_name`,
  [requiredTables],
);
assert(
  tables.length === requiredTables.length,
  "One or more required database tables are missing.",
);

const [catalog] = await app.query("SELECT count(*)::integer AS count FROM media_titles");
assert(Number(catalog.count) > 0, "The production catalog is empty.");

const permissions = await app.query(
  `SELECT table_name,
    has_table_privilege(current_user, format('public.%I', table_name), 'SELECT') AS can_select,
    has_table_privilege(current_user, format('public.%I', table_name), 'INSERT') AS can_insert,
    has_table_privilege(current_user, format('public.%I', table_name), 'UPDATE') AS can_update,
    has_table_privilege(current_user, format('public.%I', table_name), 'DELETE') AS can_delete
   FROM unnest($1::text[]) AS table_name
   ORDER BY table_name`,
  [requiredTables],
);
assert(
  permissions.every((row) => {
    const expected = new Set(requiredPermissions[row.table_name]);
    return (
      row.can_select === expected.has("SELECT") &&
      row.can_insert === expected.has("INSERT") &&
      row.can_update === expected.has("UPDATE") &&
      row.can_delete === expected.has("DELETE")
    );
  }),
  "The application database role does not match the least-privilege table contract.",
);

const leaseName = `database-verification-${randomUUID()}`;
try {
  await app.query(
    `INSERT INTO job_leases (name, lease_owner, expires_at)
     VALUES ($1, $2, now() + interval '1 minute')`,
    [leaseName, leaseName],
  );
} finally {
  await app.query("DELETE FROM job_leases WHERE name = $1", [leaseName]);
}

console.log(
  JSON.stringify({
    level: "info",
    event: "database_verification_passed",
    adminRole: adminIdentity.current_user,
    appRole: appIdentity.current_user,
    migrations: migrations.length,
    tables: tables.length,
    titles: Number(catalog.count),
  }),
);
