/**
 * Splits a migration file into individually executable statements.
 *
 * Prisma's `$executeRawUnsafe` accepts one statement per call, so a multi-
 * statement migration file cannot be sent as-is. Two hazards are handled:
 *
 *   1. `DO $$ ... $$;` blocks contain internal semicolons AND a `BEGIN` that is
 *      PL/pgSQL, not a transaction — so dollar-quoted regions are tracked and
 *      their contents are never treated as statement boundaries.
 *   2. The file's outer `BEGIN;`/`COMMIT;` transaction wrapper is stripped.
 */
export function splitStatements(sql) {
  const statements = [];
  let current = '';
  let dollarTag = null;

  for (const line of sql.split('\n')) {
    const trimmed = line.trim();

    if (dollarTag) {
      current += `${line}\n`;
      // Only an identical tag closes the region.
      if (line.includes(dollarTag)) {
        dollarTag = null;
        // The closing line is normally `$$;` — and that semicolon really does end
        // the statement. Without this check the statement is never pushed here,
        // so the NEXT statement gets appended onto it; the two then travel as a
        // single call and Postgres rejects it with 42601 "cannot insert multiple
        // commands into a prepared statement". (Hit by a DO block immediately
        // followed by CREATE INDEX.)
        if (/;\s*$/.test(line)) {
          statements.push(current.trim());
          current = '';
        }
      }
      continue;
    }

    // Strip the outer transaction wrapper only at top level.
    if (/^(BEGIN|COMMIT)\s*;?$/i.test(trimmed)) continue;

    const tagMatch = line.match(/\$[A-Za-z_]*\$/);
    if (tagMatch) {
      dollarTag = tagMatch[0];
      current += `${line}\n`;
      // A single-line dollar block may open and close on the same line.
      if (line.indexOf(dollarTag, line.indexOf(dollarTag) + dollarTag.length) !== -1) {
        dollarTag = null;
      }
      continue;
    }

    current += `${line}\n`;
    if (/;\s*$/.test(line)) {
      statements.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) statements.push(current.trim());

  return statements
    .map((s) => s.replace(/;\s*$/, '').trim())
    .filter((s) => s.length > 0);
}
