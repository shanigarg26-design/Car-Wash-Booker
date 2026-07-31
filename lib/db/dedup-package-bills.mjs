// Pre-push cleanup: remove duplicate weekly package bills so the new unique index on
// package_bills(subscription_id, week_index) can be created. Runs before drizzle-kit
// push on every deploy; it's a no-op once the data is clean (and on a fresh DB where
// the table doesn't exist yet). Keeps the lowest id for each (subscription, week).
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("[dedup] DATABASE_URL not set — skipping (push will fail loudly if needed).");
  process.exit(0);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const res = await pool.query(`
    DO $$
    DECLARE removed integer;
    BEGIN
      IF to_regclass('public.package_bills') IS NOT NULL THEN
        DELETE FROM package_bills a
        USING package_bills b
        WHERE a.id > b.id
          AND a.subscription_id = b.subscription_id
          AND a.week_index = b.week_index;
        GET DIAGNOSTICS removed = ROW_COUNT;
        RAISE NOTICE '[dedup] removed % duplicate package_bills rows', removed;
      ELSE
        RAISE NOTICE '[dedup] package_bills does not exist yet — nothing to do';
      END IF;
    END $$;
  `);
  void res;
  console.log("[dedup] package_bills dedup complete.");
} catch (err) {
  console.error("[dedup] failed:", err?.message || err);
  process.exit(1);
} finally {
  await pool.end();
}
