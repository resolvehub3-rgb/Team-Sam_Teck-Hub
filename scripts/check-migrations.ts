/**
 * check-migrations.ts — offline safety lint for supabase/migrations.
 *
 * Enforces, without needing database credentials:
 *   * no migration disables RLS, drops tables or truncates data;
 *   * the meetings fix migration (20261018120000) enables RLS, creates
 *     exactly the four intended policies, and keeps the security
 *     properties the product depends on;
 *   * no policy created on public.meetings may query public.meetings
 *     again (directly or through can_view_meeting) — that self-reference
 *     is what broke INSERT ... RETURNING in production.
 *
 * Usage: pnpm test   (or: pnpm exec tsx scripts/check-migrations.ts)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'migrations');
const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);
const ok = (cond: boolean, msg: string) => { if (!cond) fail(msg); };

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
ok(files.length > 0, 'no migration files found');

// --- 1. No migration may be destructive or disable RLS. --------------------
for (const f of files) {
  const sql = readFileSync(join(DIR, f), 'utf8');
  ok(!/\bDROP\s+TABLE\b/i.test(sql), `${f}: contains DROP TABLE`);
  ok(!/\bTRUNCATE\b/i.test(sql), `${f}: contains TRUNCATE`);
  ok(!/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql), `${f}: disables RLS`);
}

// --- 2. No policy on public.meetings may self-reference meetings. -----------
// INSERT ... RETURNING re-checks the SELECT policy on the row being
// inserted within the same statement; a policy that re-queries
// public.meetings (e.g. via can_view_meeting) can never see that row and
// fails every `.insert().select()` with "new row violates row-level
// security policy for table meetings". Historical migrations before the
// fix (20261018120000) are grandfathered — they are applied in order and
// the fix migration replaces their policies — but nothing created after
// it may reintroduce the pattern.
const FIX = '20261018120000_fix_meetings_rls_policies.sql';
for (const f of files) {
  if (f < FIX) continue;
  const sql = readFileSync(join(DIR, f), 'utf8');
  const statements = sql.split(';');
  statements.forEach((stmt, i) => {
    if (/CREATE\s+POLICY/i.test(stmt) && /ON\s+public\.meetings\b/i.test(stmt)) {
      ok(
        !/can_view_meeting\s*\(/i.test(stmt) && !/FROM\s+public\.meetings\b/i.test(stmt.replace(/ON\s+public\.meetings\b/i, '')),
        `${f}: policy statement #${i + 1} on public.meetings queries public.meetings itself (breaks INSERT ... RETURNING)`
      );
      ok(/TO\s+authenticated/i.test(stmt), `${f}: meetings policy #${i + 1} is not restricted TO authenticated`);
    }
  });
}

// --- 3. The meetings fix migration must keep its security properties. -------
const fixSql = files.includes(FIX) ? readFileSync(join(DIR, FIX), 'utf8') : '';
ok(fixSql !== '', `missing migration ${FIX}`);

if (fixSql) {
  ok(
    /ALTER\s+TABLE\s+public\.meetings\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(fixSql),
    `${FIX}: does not enable RLS on public.meetings`
  );
  for (const policy of [
    'Meetings viewable by authorised users',
    'Meetings insertable by authorised users',
    'Meetings updatable by host or leads (scoped)',
    'Meetings deletable by super admins',
  ]) {
    ok(fixSql.includes(`"${policy}"`), `${FIX}: missing policy "${policy}"`);
  }
  // INSERT: creator must be the caller, verified against the membership table.
  const insertStmt = fixSql
    .split(';')
    .find((s) => /CREATE\s+POLICY\s+"Meetings insertable by authorised users"/i.test(s)) || '';
  ok(/WITH\s+CHECK/i.test(insertStmt), `${FIX}: INSERT policy lacks WITH CHECK`);
  ok(/host_id\s*=\s*auth\.uid\(\)/i.test(insertStmt), `${FIX}: INSERT policy does not pin host_id to auth.uid()`);
  ok(/can_schedule_meeting/i.test(insertStmt), `${FIX}: INSERT policy does not verify per-org scheduling role`);
  ok(!/GRANT[^;]*\bTO\b[^;]*\banon\b/i.test(fixSql), `${FIX}: grants policy-function access to anon`);
  for (const fn of ['can_schedule_meeting', 'can_manage_meetings_in']) {
    const fnStmt = fixSql.split(';').find((s) => new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}`, 'i').test(s)) || '';
    ok(/SECURITY\s+DEFINER/i.test(fnStmt), `${FIX}: ${fn} is not SECURITY DEFINER`);
    ok(/SET\s+search_path\s*=/i.test(fnStmt), `${FIX}: ${fn} has no pinned search_path`);
    ok(!/FROM\s+public\.meetings\b/i.test(fnStmt), `${FIX}: ${fn} queries public.meetings (recursion / RETURNING hazard)`);
  }
}

// --- 4. Timestamped filenames follow the repository convention. -------------
for (const f of files) {
  ok(/^\d{14}_[a-z0-9_]+\.sql$/.test(f), `${f}: filename does not match YYYYMMDDHHMMSS_name.sql`);
}

if (failures.length) {
  console.error(`check-migrations: ${failures.length} problem(s) found:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-migrations: ${files.length} migration file(s) OK.`);
