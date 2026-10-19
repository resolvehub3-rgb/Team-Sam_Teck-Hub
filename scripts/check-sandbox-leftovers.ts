/** One-off: confirm no RLS-VERIFY sandbox rows remain in the live database. */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const { data: orgs } = await admin.from('organizations').select('id').like('name', 'RLS Verify%');
const { data: profiles } = await admin.from('profiles').select('id').like('email', 'rls-verify-%');
const userIds = (profiles || []).map((p) => p.id);

let memberships = 0;
let hosted = 0;
if (userIds.length) {
  const { count: m } = await admin
    .from('organization_memberships')
    .select('id', { count: 'exact', head: true })
    .in('user_id', userIds);
  const { count: h } = await admin
    .from('meetings')
    .select('id', { count: 'exact', head: true })
    .in('host_id', userIds);
  memberships = m ?? 0;
  hosted = h ?? 0;
}
const { count: meetings } = await admin
  .from('meetings')
  .select('id', { count: 'exact', head: true })
  .like('title', 'RLS Verify%');

let authUsers = -1;
try {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  authUsers = (data?.users || []).filter((u) => (u.email || '').startsWith('rls-verify-')).length;
} catch {
  /* report -1 on failure */
}

console.log(`leftover sandbox organizations: ${orgs?.length ?? 'ERR'}`);
console.log(`leftover sandbox profiles:      ${userIds.length}`);
console.log(`leftover sandbox memberships:   ${memberships}`);
console.log(`leftover sandbox-hosted meetings: ${hosted}`);
console.log(`leftover "RLS Verify%" meetings: ${meetings ?? 'ERR'}`);
console.log(`leftover sandbox auth users:    ${authUsers} (only checks first 200 users)`);
process.exit(0);
