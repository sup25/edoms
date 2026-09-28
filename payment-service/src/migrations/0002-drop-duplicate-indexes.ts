import type { Migration } from "../config/migrator";

/**
 * Drops the duplicate unique constraints `sync({ alter: true })` left behind.
 *
 * Sequelize cannot recognise a unique constraint it created on an earlier
 * boot, so it added another every time the service started. In this repo that
 * had reached 386 identical unique constraints on `Products.slug`, and between
 * 18 and 38 on each service's `outbox_events.event_id` - roughly 500 across
 * five databases where about fifteen were wanted. Every `npm run dev` added
 * more.
 *
 * That is not cosmetic: each one is checked and maintained on every insert and
 * update, so the outbox relay - which writes constantly - was paying for
 * dozens of copies of the same uniqueness check.
 *
 * They are CONSTRAINTS, not bare indexes, which matters: an index backing a
 * constraint cannot be dropped with DROP INDEX, only by dropping the
 * constraint. Both are handled here, constraints first.
 *
 * Matched by definition rather than by name, so this also cleans a database
 * that booted a few more times before this landed.
 */
export const up: Migration = async ({ context: sequelize }) => {
  /*
   * Duplicate unique constraints. Keeps one per (table, definition) - the
   * shortest name, which is the original: Sequelize appends an incrementing
   * number, so `Products_slug_key` predates `Products_slug_key382`.
   */
  const [constraintRows] = await sequelize.query(`
    WITH uniques AS (
      SELECT
        t.relname AS table_name,
        con.conname AS constraint_name,
        pg_get_constraintdef(con.oid) AS definition,
        row_number() OVER (
          PARTITION BY t.relname, pg_get_constraintdef(con.oid)
          ORDER BY length(con.conname), con.conname
        ) AS position
      FROM pg_constraint con
      JOIN pg_class t ON t.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND con.contype = 'u'
    )
    SELECT table_name, constraint_name FROM uniques WHERE position > 1
  `);

  const duplicateConstraints = constraintRows as {
    table_name: string;
    constraint_name: string;
  }[];

  for (const row of duplicateConstraints) {
    await sequelize.query(
      `ALTER TABLE "${row.table_name}" DROP CONSTRAINT IF EXISTS "${row.constraint_name}"`
    );
  }

  /* Duplicate plain indexes - the same problem where no constraint is involved. */
  const [indexRows] = await sequelize.query(`
    WITH indexes AS (
      SELECT
        c.relname AS index_name,
        row_number() OVER (
          PARTITION BY t.relname,
          regexp_replace(pg_get_indexdef(i.indexrelid), ' INDEX .*? ON ', ' INDEX ON ')
          ORDER BY length(c.relname), c.relname
        ) AS position
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND NOT i.indisprimary
        AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid)
    )
    SELECT index_name FROM indexes WHERE position > 1
  `);

  const duplicateIndexes = indexRows as { index_name: string }[];
  for (const row of duplicateIndexes) {
    await sequelize.query(`DROP INDEX IF EXISTS "${row.index_name}"`);
  }

  const dropped = duplicateConstraints.length + duplicateIndexes.length;
  if (dropped > 0) {
    // Worth a line: it explains a sudden change in write latency.
    console.log(`Dropped ${dropped} duplicate constraint(s)/index(es)`);
  }
};

/*
 * Not reversible, and should not be: re-creating hundreds of redundant
 * uniqueness checks is not a state anyone wants to return to.
 */
export const down: Migration = async () => {
  throw new Error("Removing duplicate constraints is not reversible.");
};
