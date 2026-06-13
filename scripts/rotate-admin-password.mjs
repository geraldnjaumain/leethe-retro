import { neon } from "@neondatabase/serverless";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("Set DATABASE_ADMIN_URL before rotating the admin password.");

const sql = neon(adminUrl);
const [identity] = await sql.query("SELECT current_user");
const role = String(identity.current_user);
const quotedRole = role.replaceAll('"', '""');
const password = randomBytes(40).toString("base64url");
await sql.query(`ALTER ROLE "${quotedRole}" PASSWORD '${password}'`);

const nextUrl = new URL(adminUrl);
nextUrl.password = password;
const envPath = ".env";
let envText = await readFile(envPath, "utf8");
envText = envText.replace(/^DATABASE_ADMIN_URL=.*$/m, `DATABASE_ADMIN_URL=${nextUrl.toString()}`);
await writeFile(envPath, envText);
console.log(JSON.stringify({ level: "info", event: "admin_password_rotated", role }));
