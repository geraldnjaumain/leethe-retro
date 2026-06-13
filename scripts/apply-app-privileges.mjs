import { neon } from "@neondatabase/serverless";
import { APP_ROLE, applyAppPrivileges } from "./lib/app-role.mjs";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("Set DATABASE_ADMIN_URL before applying application privileges.");

const sql = neon(adminUrl);
const [role] = await sql.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_ROLE]);
if (!role) throw new Error(`Create the ${APP_ROLE} role before applying privileges.`);

const [database] = await sql.query("SELECT current_database() AS name");
await applyAppPrivileges(sql, database.name);

console.log(
  JSON.stringify({
    level: "info",
    event: "application_privileges_applied",
    role: APP_ROLE,
  }),
);
