import { neon } from "@neondatabase/serverless";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { APP_ROLE, applyAppPrivileges } from "./lib/app-role.mjs";

const adminUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!adminUrl) throw new Error("Set DATABASE_ADMIN_URL or DATABASE_URL before provisioning.");

const role = APP_ROLE;
const password = randomBytes(32).toString("base64url");
const sql = neon(adminUrl);
const [database] = await sql.query("SELECT current_database() AS name");
const databaseName = String(database.name).replaceAll('"', '""');
await sql.query(`DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'leethe_app') THEN
    CREATE ROLE leethe_app LOGIN;
  END IF;
END
$$`);
await sql.query(`ALTER ROLE leethe_app PASSWORD '${password}'`);
await applyAppPrivileges(sql, databaseName);

const appUrl = new URL(adminUrl);
appUrl.username = role;
appUrl.password = password;
const envPath = ".env";
let envText = await readFile(envPath, "utf8");
const setEnv = (key, value) => {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  envText = pattern.test(envText)
    ? envText.replace(pattern, line)
    : `${envText.trimEnd()}\n${line}\n`;
};
setEnv("DATABASE_ADMIN_URL", adminUrl);
setEnv("DATABASE_URL", appUrl.toString());
await writeFile(envPath, envText);
console.log(JSON.stringify({ level: "info", event: "application_role_provisioned", role }));
