import { neon } from "@neondatabase/serverless";
import { APP_ROLE, applyAppPrivileges } from "./lib/app-role.mjs";
import { catalogShardAdminUrls } from "./lib/catalog-shards.mjs";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("Set DATABASE_ADMIN_URL before applying application privileges.");

const adminUrls = [...new Set([adminUrl, ...catalogShardAdminUrls()])];
for (const [databaseIndex, url] of adminUrls.entries()) {
  const sql = neon(url);
  const [role] = await sql.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_ROLE]);
  if (!role) throw new Error(`Create the ${APP_ROLE} role on database ${databaseIndex}.`);

  const [database] = await sql.query("SELECT current_database() AS name");
  await applyAppPrivileges(sql, database.name);
}

console.log(
  JSON.stringify({
    level: "info",
    event: "application_privileges_applied",
    databases: adminUrls.length,
    role: APP_ROLE,
  }),
);
