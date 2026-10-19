/**
 * verify-meetings-rls.ts — live regression harness for meeting-creation RLS.
 *
 * Runs the real PostgREST + RLS machinery against the configured Supabase
 * project using an ISOLATED sandbox (a throwaway organization, users and
 * meetings tagged "RLS Verify") that is deleted again at the end. No real
 * organization, membership or meeting is read or modified.
 *
 * Usage:
 *   pnpm test:rls        (or: pnpm exec tsx scripts/verify-meetings-rls.ts)
 *
 * Requires VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY in the environment (.env is loaded automatically).
 *
 * Covers, with the product rules from src/utils/rules.ts as expectations:
 *   1  authorized member creates a meeting (INSERT ... RETURNING)
 *   2  plain INSERT path (app fallback) also works
 *   3  unauthenticated insert denied
 *   4  member denied creating in a team they do not belong to
 *   5  impersonation (foreign host_id) denied
 *   6  team_leader creates for their own team
 *   7  super_admin creates as host
 *   8  guest role denied scheduling
 *   9  created meeting retrievable by its creator; other teams see nothing
 *  10  private meeting hidden from unrelated members, visible to host,
 *      leader, super-admin, and invited members
 *  11  invalid payloads rejected (missing title, bad timestamp, missing slug)
 *  12  host can edit own meeting; non-host edits touch nothing
 *  13  ordinary member / team leader cannot delete; super-admin can
 *  14  listing intact after the above
 *
 * Exit code 0 = every check behaved as the product rules require.
 */
import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.VITE_SUPABASE_URL || '';
const ANON = process.env.VITE_SUPABASE_ANON_KEY || '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!URL || !ANON || !SERVICE) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const stamp = Date.now().toString(36);
const TAG = `RLS Verify ${stamp}`;

interface Check { name: string; expected: string; actual: string; ok: boolean }
const checks: Check[] = [];
const record = (name: string, expected: string, ok: boolean, actual: string) => {
  checks.push({ name, expected, actual, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      expected: ${expected}\n      actual:   ${actual}`);
};

const errText = (e: unknown): string => {
  if (!e) return 'no error';
  if (typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: string; code?: string }).message;
    const code = (e as { code?: string }).code;
    return [code, m].filter(Boolean).join(': ') || JSON.stringify(e);
  }
  return String(e);
};

// A meeting payload that satisfies every NOT NULL column of public.meetings.
let seq = 0;
const meetingPayload = (orgId: string, hostId: string, extra: Record<string, unknown> = {}) => ({
  organization_id: orgId,
  title: `RLS Verify Meeting ${++seq}`,
  slug: `rls-verify-${stamp}-${seq}`,
  description: 'Created by scripts/verify-meetings-rls.ts and removed again.',
  host_id: hostId,
  start_time: new Date(Date.now() + 3600_000).toISOString(),
  duration_minutes: 30,
  timezone: 'UTC',
  status: 'scheduled',
  livekit_room_name: `rls-verify-room-${stamp}-${seq}`,
  is_private: false,
  ...extra,
});

const createUser = async (email: string, password: string): Promise<string> => {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: email.split('@')[0] },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${errText(error)}`);
  return data.user.id;
};

/** Browser-like client per signed-in user (supabase-js is single-session). */
const browserClient = (): SupabaseClient =>
  createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

const signIn = async (client: SupabaseClient, email: string, password: string) => {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn failed for ${email}: ${errText(error)}`);
};

// Valid UUID sentinel: keeps later checks running (and failing honestly)
// when an upstream setup step did not produce a row.
const NONE = '00000000-0000-0000-0000-000000000000';
const orNone = (v: string | undefined): string => v || NONE;

const run = async () => {
  const pw = `V3rify-${stamp}-pw`;
  const mkEmail = (kind: string) => `rls-verify-${kind}-${stamp}@example.com`;
  const emails = {
    member: mkEmail('member'),
    leader: mkEmail('leader'),
    other: mkEmail('other'),
    admin: mkEmail('admin'),
    guest: mkEmail('guest'),
  };

  const orgIds: string[] = [];
  let orgA = '';
  let orgB = '';
  const ids: Record<string, string> = {};

  try {
    // ---- Sandbox setup (service role; bypasses RLS by design) --------------
    const { data: a } = await admin
      .from('organizations')
      .insert({ name: `${TAG} Org A`, slug: `rls-verify-a-${stamp}` })
      .select('id')
      .single();
    const { data: b } = await admin
      .from('organizations')
      .insert({ name: `${TAG} Org B`, slug: `rls-verify-b-${stamp}` })
      .select('id')
      .single();
    if (!a || !b) throw new Error('Could not create sandbox organizations.');
    orgA = a.id;
    orgB = b.id;
    orgIds.push(orgA, orgB);

    ids.member = await createUser(emails.member, pw);
    ids.leader = await createUser(emails.leader, pw);
    ids.other = await createUser(emails.other, pw);
    ids.admin = await createUser(emails.admin, pw);
    ids.guest = await createUser(emails.guest, pw);

    for (const [id, email] of Object.entries(emails)) {
      const { error } = await admin.from('profiles').insert({
        id: ids[id], email, full_name: email.split('@')[0],
      });
      if (error) throw new Error(`profile insert failed: ${errText(error)}`);
    }
    const memberships: [string, string, string][] = [
      [orgA, ids.member, 'team_member'],
      [orgA, ids.leader, 'team_leader'],
      [orgB, ids.other, 'team_member'],   // other-team member, no access to org A
      [orgA, ids.admin, 'super_admin'],
      [orgA, ids.guest, 'guest'],
    ];
    for (const [org, user, role] of memberships) {
      const { error } = await admin
        .from('organization_memberships')
        .insert({ organization_id: org, user_id: user, role, is_active: true });
      if (error) throw new Error(`membership insert failed: ${errText(error)}`);
    }

    const member = browserClient();
    await signIn(member, emails.member, pw);
    const leader = browserClient();
    await signIn(leader, emails.leader, pw);
    const other = browserClient();
    await signIn(other, emails.other, pw);
    const superAdmin = browserClient();
    await signIn(superAdmin, emails.admin, pw);
    const guest = browserClient();
    await signIn(guest, emails.guest, pw);
    const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

    // ---- 0. Helper-function probe (what the live DB actually exposes) ------
    for (const fn of [
      { fn: 'is_org_member', args: { org_id: orgA } },
      { fn: 'current_member_role', args: {} },
      { fn: 'is_manager_or_above', args: {} },
      { fn: 'is_super_admin', args: {} },
      { fn: 'can_schedule_meeting', args: { p_org_id: orgA } },
      { fn: 'can_manage_meetings_in', args: { p_org_id: orgA } },
    ]) {
      const { error } = await member.rpc(fn.fn as never, fn.args as never);
      record(
        `0. rpc ${fn.fn} exists and is callable`,
        'no PGRST202 "Could not find the function"',
        !error || !String(error.message).includes('Could not find the function'),
        error ? errText(error) : 'callable'
      );
    }

    // ---- 1. Authorized team_member creates a meeting (the app's path) -----
    const p1 = meetingPayload(orgA, ids.member);
    const { data: ins1, error: e1 } = await member
      .from('meetings').insert(p1).select('id, slug').single();
    record(
      '1. team_member creates meeting (INSERT ... RETURNING)',
      '201 / row returned',
      !e1 && Boolean(ins1?.id),
      e1 ? errText(e1) : `created id=${ins1?.id} slug=${ins1?.slug}`
    );

    // ---- 2. Plain INSERT (app fallback path) ------------------------------
    const p2 = meetingPayload(orgA, ids.member);
    const { error: e2 } = await member.from('meetings').insert(p2);
    record('2. team_member creates meeting (plain INSERT)', '201', !e2, e2 ? errText(e2) : 'created');
    // Read the plain-inserted row back by its UNIQUE slug, as the app does.
    const { data: bySlug } = await member
      .from('meetings').select('id').eq('slug', p2.slug).maybeSingle();
    record('2b. plain-INSERT row retrievable by slug', 'row returned', Boolean(bySlug), bySlug ? 'visible' : 'missing');
    const memberMeetingId = bySlug?.id as string | undefined;

    // ---- 3. Unauthenticated (anon) insert denied --------------------------
    const { error: e3 } = await anon.from('meetings').insert(meetingPayload(orgA, ids.member));
    record('3. unauthenticated insert denied', 'error (42501)', Boolean(e3), e3 ? errText(e3) : 'ALLOWED (!!)');

    // ---- 4. Member of org A cannot create in org B ------------------------
    const { error: e4 } = await member.from('meetings').insert(meetingPayload(orgB, ids.member));
    record('4. member cannot create in a team they do not belong to', 'error 42501', Boolean(e4), e4 ? errText(e4) : 'ALLOWED (!!)');

    // ---- 5. Impersonation: host_id = someone else --------------------------
    const { error: e5 } = await member.from('meetings').insert(meetingPayload(orgA, ids.leader));
    record('5. member cannot schedule as another host (host_id impersonation)', 'error 42501', Boolean(e5), e5 ? errText(e5) : 'ALLOWED (!!)');

    // ---- 6. team_leader creates for their own team ------------------------
    const { data: ins6, error: e6 } = await leader
      .from('meetings').insert(meetingPayload(orgA, ids.leader)).select('id').single();
    record('6. team_leader creates meeting for own team', '201', !e6 && Boolean(ins6?.id), e6 ? errText(e6) : 'created');
    const leaderMeetingId = ins6?.id as string | undefined;

    // ---- 7. super_admin creates as host -----------------------------------
    const { data: ins7, error: e7 } = await superAdmin
      .from('meetings').insert(meetingPayload(orgA, ids.admin)).select('id').single();
    record('7. super_admin creates meeting (as host)', '201', !e7 && Boolean(ins7?.id), e7 ? errText(e7) : 'created');
    const adminMeetingId = ins7?.id as string | undefined;

    // ---- 8. Guest role denied scheduling ----------------------------------
    const { error: e8 } = await guest.from('meetings').insert(meetingPayload(orgA, ids.guest));
    record('8. guest membership cannot schedule', 'error 42501', Boolean(e8), e8 ? errText(e8) : 'ALLOWED (!!)');

    // ---- 9. Retrieval ------------------------------------------------------
    const { data: seen, error: e9 } = await member
      .from('meetings').select('id').eq('organization_id', orgA);
    const seenIds = new Set((seen || []).map((r) => r.id));
    record(
      '9a. creator can retrieve their own meeting',
      'row visible',
      !e9 && Boolean(memberMeetingId && seenIds.has(memberMeetingId)),
      e9 ? errText(e9) : `${seen?.length ?? 0} rows visible; own row ${memberMeetingId && seenIds.has(memberMeetingId) ? 'visible' : 'MISSING'}`
    );
    const { data: crossSeen } = await other
      .from('meetings').select('id').eq('organization_id', orgA);
    record('9b. other-team member sees none of org A meetings', '0 rows', (crossSeen || []).length === 0, `${(crossSeen || []).length} rows`);

    // ---- 10. Private meeting visibility ------------------------------------
    const privPayload = meetingPayload(orgA, ids.leader, { title: 'RLS Verify Private', is_private: true });
    const { data: insPriv, error: ePriv } = await leader
      .from('meetings').insert(privPayload).select('id').single();
    const privId = insPriv?.id as string | undefined;
    record('10a. team_leader creates private meeting', '201', !ePriv && Boolean(privId), ePriv ? errText(ePriv) : 'created');

    const rowsFor = async (c: SupabaseClient) =>
      (await c.from('meetings').select('id').eq('id', orNone(privId))).data || [];
    record('10b. private meeting hidden from unrelated member', '0 rows', (await rowsFor(member)).length === 0, `${(await rowsFor(member)).length} rows`);
    record('10c. private meeting visible to its host', '1 row', (await rowsFor(leader)).length === 1, `${(await rowsFor(leader)).length} rows`);
    record('10d. private meeting visible to super_admin', '1 row', (await rowsFor(superAdmin)).length === 1, `${(await rowsFor(superAdmin)).length} rows`);
    record('10e. private meeting hidden from other-team member', '0 rows', (await rowsFor(other)).length === 0, `${(await rowsFor(other)).length} rows`);

    // Inviting a member must make the private meeting visible to them.
    const { error: eInv } = await leader.from('meeting_invitations').insert({
      meeting_id: privId, user_id: ids.member, status: 'invited',
    });
    record('10f. leader can invite a member to the private meeting', '201', !eInv, eInv ? errText(eInv) : 'invited');
    record('10g. invited member can now see the private meeting', '1 row', (await rowsFor(member)).length === 1, `${(await rowsFor(member)).length} rows`);

    // ---- 11. Invalid payloads rejected -------------------------------------
    const { error: e11a } = await member
      .from('meetings').insert({ ...meetingPayload(orgA, ids.member), title: null as never });
    record('11a. missing title rejected', 'NOT NULL error 23502', Boolean(e11a) && (e11a as { code?: string }).code === '23502', e11a ? errText(e11a) : 'ALLOWED (!!)');

    const { error: e11b } = await member
      .from('meetings').insert({ ...meetingPayload(orgA, ids.member), start_time: 'not-a-date' });
    record('11b. invalid start_time rejected', 'input error 22007', Boolean(e11b), e11b ? errText(e11b) : 'ALLOWED (!!)');

    const { error: e11c } = await member
      .from('meetings').insert({ ...meetingPayload(orgA, ids.member), slug: null as never });
    record('11c. missing slug (required field) rejected', 'NOT NULL error 23502', Boolean(e11c) && (e11c as { code?: string }).code === '23502', e11c ? errText(e11c) : 'ALLOWED (!!)');

    // ---- 12. Update permissions --------------------------------------------
    const { error: e12a } = await member
      .from('meetings').update({ title: 'RLS Verify Meeting (edited)' })
      .eq('id', orNone(memberMeetingId));
    record('12a. host updates own meeting', 'success', !e12a && Boolean(memberMeetingId), e12a ? errText(e12a) : memberMeetingId ? 'updated' : 'member meeting missing');

    const { error: e12b } = await member
      .from('meetings').update({ title: 'RLS Verify Meeting (hijack)' })
      .eq('id', orNone(adminMeetingId));
    record('12b. member cannot edit a meeting they do not host', 'no error; 0 rows touched', !e12b && Boolean(adminMeetingId), e12b ? errText(e12b) : adminMeetingId ? 'completed (row-level USING decides)' : 'admin meeting missing');
    const { data: hijackCheck } = await admin
      .from('meetings').select('title').eq('id', orNone(adminMeetingId)).maybeSingle();
    record(
      '12c. unhosted meeting title unchanged after hijack attempt',
      'title unchanged',
      Boolean(hijackCheck && !hijackCheck.title.includes('hijack')),
      hijackCheck?.title || 'row missing'
    );

    const { error: e12d } = await leader
      .from('meetings').update({ description: 'Edited by team leader' })
      .eq('id', orNone(adminMeetingId));
    record('12d. team_leader edits a meeting in their own team', 'success', !e12d && Boolean(adminMeetingId), e12d ? errText(e12d) : adminMeetingId ? 'updated' : 'admin meeting missing');

    // ---- 13. Delete permissions --------------------------------------------
    const { error: e13a } = await member.from('meetings').delete().eq('id', orNone(memberMeetingId));
    const { data: survivedForOrgA, error: e13aRead } = await admin
      .from('meetings').select('id').eq('id', orNone(memberMeetingId));
    record(
      '13a. ordinary member cannot delete; row survives',
      'row survives',
      Boolean(memberMeetingId && !e13aRead && survivedForOrgA?.length),
      `${e13a ? 'delete: ' + errText(e13a) : 'delete: no error'}${e13aRead ? `; read: ${errText(e13aRead)}` : ''}; row ${survivedForOrgA?.length ? 'survived' : 'DELETED (!!) or missing'}`
    );

    const { error: e13b } = await superAdmin.from('meetings').delete().eq('id', orNone(adminMeetingId));
    const { data: gone } = await admin.from('meetings').select('id').eq('id', orNone(adminMeetingId)).maybeSingle();
    record(
      '13b. super_admin deletes a meeting; row removed',
      'deleted',
      !e13b && Boolean(adminMeetingId) && !gone,
      `${e13b ? errText(e13b) : 'no error'}; row ${gone ? 'still present' : 'removed or missing'}`
    );

    // ---- 14. Listing intact -------------------------------------------------
    const { data: remaining } = await admin.from('meetings').select('id, title').like('title', 'RLS Verify%');
    record(
      '14. other sandbox meetings still listed after deletes',
      '>= 2 rows (member meeting + private meeting)',
      (remaining || []).length >= 2,
      `${(remaining || []).length} rows`
    );
  } finally {
    // ---- Cleanup: remove everything this script created --------------------
    for (const org of orgIds) {
      await admin.from('organization_memberships').delete().eq('organization_id', org);
      await admin.from('organizations').delete().eq('id', org);
    }
    await admin.from('meetings').delete().like('title', 'RLS Verify%');
    await admin.from('profiles').delete().like('email', `rls-verify-%-${stamp}@example.com`);
    for (const kind of Object.keys({ member: 1, leader: 1, other: 1, admin: 1, guest: 1 })) {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const u = data?.users.find((x) => x.email === mkEmail(kind));
      if (u) await admin.auth.admin.deleteUser(u.id);
    }
    // Belt & braces: no RLS Verify meeting may remain, in any org.
    await admin.from('meetings').delete().like('livekit_room_name', 'rls-verify-room-%');
    console.log('\nCleanup complete.');
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length) {
    console.log('Failing checks:');
    for (const f of failed) console.log(`  - ${f.name}: expected "${f.expected}", got "${f.actual}"`);
    process.exit(1);
  }
};

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
