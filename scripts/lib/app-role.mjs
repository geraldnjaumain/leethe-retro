export const APP_ROLE = "leethe_app";

export async function applyAppPrivileges(sql, databaseName) {
  const quotedDatabase = String(databaseName).replaceAll('"', '""');
  const queries = [
    sql.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`),
    sql.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${APP_ROLE}`),
    sql.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${APP_ROLE}`),
    sql.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM ${APP_ROLE}`,
    ),
    sql.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM ${APP_ROLE}`,
    ),
    sql.query(`GRANT CONNECT ON DATABASE "${quotedDatabase}" TO ${APP_ROLE}`),
    sql.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`),
    sql.query(
      `GRANT SELECT, INSERT, UPDATE ON
        media_titles,
        genres,
        catalog_pages,
        rate_limit_buckets,
        tmdb_payload_cache,
        support_tickets
       TO ${APP_ROLE}`,
    ),
    sql.query(
      `GRANT SELECT, INSERT ON
        media_title_genres,
        catalog_sync_events,
        analytics_events,
        admin_audit_events
       TO ${APP_ROLE}`,
    ),
    sql.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON job_leases TO ${APP_ROLE}`),
    sql.query(`GRANT SELECT ON schema_migrations TO ${APP_ROLE}`),
    sql.query(`GRANT USAGE, SELECT ON SEQUENCE catalog_sync_events_id_seq TO ${APP_ROLE}`),
    sql.query(`GRANT USAGE, SELECT ON SEQUENCE analytics_events_id_seq TO ${APP_ROLE}`),
    sql.query(`GRANT USAGE, SELECT ON SEQUENCE admin_audit_events_id_seq TO ${APP_ROLE}`),
  ];
  await sql.transaction(queries);
}
