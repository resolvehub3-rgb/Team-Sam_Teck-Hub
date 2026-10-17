import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { AccessToken } from 'livekit-server-sdk';

dotenv.config();

// Directory of this module, used only when serving the built frontend from
// disk (see the isDirectRun block at the end of this file) - a path Vercel
// never takes, since the CDN serves dist/ and this file runs purely as an API
// function.
//
// Deliberately process.cwd() rather than import.meta.url. `pnpm start` runs
// from the project root, so cwd is the directory containing dist/. Deriving
// this from import.meta.url instead is a trap: when a bundler emits
// CommonJS without rewriting it, Node throws a SyntaxError at *parse* time,
// before any try/catch in this file can run, and the whole function dies with
// a bare FUNCTION_INVOCATION_FAILED. process.cwd() is safe in both formats.
const __dirname = process.cwd();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json());

// Initialize Supabase Admin Client if service key is provided.
//
// createClient validates the URL and *throws* on a malformed one (for example
// a project host pasted without its https:// scheme). That would kill the
// whole function at module load, taking every unrelated route down with it and
// surfacing as a bare platform 500 with no body to explain it. Degrading to a
// null client instead means the routes can still answer, and /api/health
// names the misconfiguration directly.
const readEnv = (name: string) => {
  const raw = process.env[name];
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (name.endsWith('_URL') && trimmed && !/^https?:\/\//i.test(trimmed)) {
    console.error(
      `[Sam_Teck Hub] ${name} is missing its http(s):// scheme (got "${trimmed}"). ` +
        'Set it to the full URL, e.g. https://your-project.supabase.co'
    );
    return '';
  }
  return trimmed;
};

const supabaseUrl = readEnv('VITE_SUPABASE_URL') || readEnv('SUPABASE_URL');
const supabaseServiceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
const supabaseAnonKey = readEnv('VITE_SUPABASE_ANON_KEY') || readEnv('SUPABASE_ANON_KEY');

const supabaseAdmin = (supabaseUrl && supabaseServiceKey)
  ? (() => {
      try {
        return createClient(supabaseUrl, supabaseServiceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
      } catch (err) {
        console.error(
          '[Sam_Teck Hub] Supabase admin client could not be created:',
          err instanceof Error ? err.message : err
        );
        return null;
      }
    })()
  : null;

// Authoritative in-memory state for provisioned admin
let hasProvisionedInitialAdmin = true;
let initialAdminRecord: {
  id: string;
  email: string;
  fullName: string;
  organizationName: string;
} | null = {
  id: 'admin-001',
  email: 'admin@samteck.org',
  fullName: 'Samuel Teckman',
  organizationName: 'Sam_Teck Innovations',
};

// ---------------------------------------------------------------------------
// SHARED AUTHENTICATION FOR PRIVILEGED API ROUTES
//
// The browser already holds a Supabase session JWT. Verifying it here means
// the *server* decides who is calling — no route below trusts a user id,
// organization id or role supplied in the request body, because all three
// are trivially spoofable by anyone with curl.
// ---------------------------------------------------------------------------
type AuthedRequest = Request & { callerId?: string };

const readBearer = (req: Request): string => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
};

/** Returns the caller's Supabase user id, or null when it cannot be proven. */
const verifyCaller = async (req: Request): Promise<string | null> => {
  const token = readBearer(req);
  if (!token || !supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
};

/** Rejects unauthenticated callers before any work is done. */
const requireAuth = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  const callerId = await verifyCaller(req);
  if (!callerId) {
    return res.status(401).json({ error: 'Authentication required. Sign in and try again.' });
  }
  req.callerId = callerId;
  return next();
};

/** Active membership of the caller inside an organisation, or null. */
const getCallerMembership = async (userId: string, organizationId: string) => {
  if (!supabaseAdmin || !userId || !organizationId) return null;
  const { data } = await supabaseAdmin
    .from('organization_memberships')
    .select('id, role, is_active')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  return data ?? null;
};

/** Roles allowed to issue invitations (mirrors the `invite_members` rule). */
const INVITER_ROLES = new Set(['super_admin', 'team_leader', 'assistant_leader']);

/**
 * The caller's most recent active membership, or null.
 * Used by routes that must scope file storage to one organisation without
 * trusting anything the client sends about who the caller is.
 */
const getCallerOrg = async (userId: string) => {
  if (!supabaseAdmin || !userId) return null;
  const { data, error } = await supabaseAdmin
    .from('organization_memberships')
    .select('organization_id, role')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data;
};

/** Roles allowed to host, manage and open any meeting in the organisation. */
const MEETING_LEAD_ROLES = new Set([
  'super_admin',
  'team_leader',
  'assistant_leader',
  'project_manager',
  'department_lead',
]);

// 1. HEALTH & SERVICE INTEGRATION CHECK
app.get('/api/health', async (_req: Request, res: Response) => {
  const isSupabaseConfigured = Boolean(supabaseUrl && (supabaseAnonKey || supabaseServiceKey));

  // Surface misconfiguration in plain text rather than letting it surface as an
  // opaque 500 on some other route. A single curl of this endpoint then
  // explains what is wrong with the deployment.
  const configIssues: string[] = [];
  if (!process.env.VITE_SUPABASE_URL && !process.env.SUPABASE_URL) {
    configIssues.push('VITE_SUPABASE_URL is not set.');
  } else if (!supabaseUrl) {
    configIssues.push(
      'VITE_SUPABASE_URL is set but unusable - it must include the https:// scheme, e.g. https://your-project.supabase.co'
    );
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    configIssues.push('SUPABASE_SERVICE_ROLE_KEY is not set, so privileged server routes cannot run.');
  }
  if (!process.env.VITE_SUPABASE_ANON_KEY && !process.env.SUPABASE_ANON_KEY) {
    configIssues.push('VITE_SUPABASE_ANON_KEY is not set, so the browser cannot reach Supabase.');
  }
  if (!supabaseAdmin && supabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    configIssues.push('The Supabase admin client could not be created; check the server logs.');
  }

  // APP_URL builds every invitation link. Unset, it falls back to
  // http://localhost:3000, which produces links a recipient cannot open - and
  // nothing else surfaces that, since the invitation is still created and the
  // email may still send. Flag it whenever this runs anywhere but local
  // development, because the failure is otherwise invisible until someone
  // clicks the link.
  if (!process.env.APP_URL) {
    configIssues.push(
      process.env.VERCEL
        ? 'APP_URL is not set. Invitation links will point at http://localhost:3000 and cannot be opened. Set it to your deployed origin, e.g. https://your-app.vercel.app.'
        : 'APP_URL is not set, so invitation links fall back to http://localhost:3000.'
    );
  } else if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/i.test(process.env.APP_URL)) {
    configIssues.push(
      'APP_URL points at localhost, so invitation links cannot be opened from another machine.'
    );
  }

  const isLivekitConfigured = Boolean(
    process.env.LIVEKIT_URL &&
    process.env.LIVEKIT_API_KEY &&
    process.env.LIVEKIT_API_SECRET
  );

  let dbReachable = false;
  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin.from('system_settings').select('key').limit(1);
      if (!error) {
        dbReachable = true;
      }
    } catch {
      dbReachable = false;
    }
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    configIssues,
    database: {
      configured: isSupabaseConfigured,
      reachable: dbReachable,
      url: supabaseUrl ? supabaseUrl.replace(/^(https?:\/\/[^/]+).*/, '$1') : null,
    },
    livekit: {
      configured: isLivekitConfigured,
      serverUrl: process.env.LIVEKIT_URL || null,
    },
    setup: {
      initialAdminProvisioned: hasProvisionedInitialAdmin,
      secretRequired: Boolean(process.env.SETUP_PROVISIONING_SECRET),
    },
  });
});

// 2. SETUP STATUS CHECK
app.get('/api/setup/status', async (_req: Request, res: Response) => {
  if (hasProvisionedInitialAdmin) {
    return res.json({ initialAdminProvisioned: true, canSetup: false });
  }

  if (supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin
        .from('system_settings')
        .select('value')
        .eq('key', 'initial_admin_provisioned')
        .single();

      if (data && data.value === true) {
        hasProvisionedInitialAdmin = true;
        return res.json({ initialAdminProvisioned: true, canSetup: false });
      }

      // Also check if any super_admin profile exists
      const { count } = await supabaseAdmin
        .from('organization_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'super_admin');

      if (count && count > 0) {
        hasProvisionedInitialAdmin = true;
        return res.json({ initialAdminProvisioned: true, canSetup: false });
      }
    } catch (err) {
      console.warn('Could not query system_settings for setup status:', err);
    }
  }

  res.json({
    initialAdminProvisioned: hasProvisionedInitialAdmin,
    canSetup: !hasProvisionedInitialAdmin,
    secretConfigured: Boolean(process.env.SETUP_PROVISIONING_SECRET),
  });
});

// Validate the first-time setup payload.
//
// This is deliberately a local copy rather than an import of the identically
// named helper in src/utils/rules.ts. That file lives under src/, and
// importing across that boundary made the serverless function depend on a
// relative module that Vercel's Node runtime resolves differently depending on
// whether it emits CommonJS or ESM - a distinction that depends on package.json
// "type" and "engines", and which took the whole function down at load time with
// no outgoing request and no stack trace. Keeping this copy here means the
// server function depends on nothing outside node_modules, which Vercel traces
// reliably in either module format.
//
// It is also the correct place for the check: the server must validate its own
// input rather than trust a rule shared with the client.
function validateFirstTimeSetupPayload(
  payload: {
    email?: string;
    password?: string;
    fullName?: string;
    organizationName?: string;
    setupSecret?: string;
  },
  expectedSecret?: string
): { isValid: boolean; error?: string } {
  if (!payload.email || !payload.email.includes('@')) {
    return { isValid: false, error: 'A valid email address is required' };
  }
  if (!payload.password || payload.password.length < 8) {
    return { isValid: false, error: 'Password must be at least 8 characters long' };
  }
  if (!payload.fullName || payload.fullName.trim().length < 2) {
    return { isValid: false, error: 'Full name is required' };
  }
  if (!payload.organizationName || payload.organizationName.trim().length < 2) {
    return { isValid: false, error: 'Workspace organization name is required' };
  }
  if (expectedSecret && payload.setupSecret !== expectedSecret) {
    return { isValid: false, error: 'Invalid first-time setup provisioning secret' };
  }
  return { isValid: true };
}

// 3. FIRST-TIME INITIAL ADMINISTRATOR PROVISIONING
app.post('/api/setup/initialize-admin', async (req: Request, res: Response) => {
  try {
    if (hasProvisionedInitialAdmin) {
      return res.status(403).json({
        error: 'Initial administrator has already been provisioned. First-time setup is closed.',
      });
    }

    // The in-memory flag above is per-instance and starts optimistic, so it is
    // not authoritative on its own. Confirm against the database that no super
    // administrator exists yet; otherwise a warm instance, or a direct call to
    // this route, could provision a second one.
    if (supabaseAdmin) {
      const { count } = await supabaseAdmin
        .from('organization_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'super_admin');

      if (count && count > 0) {
        hasProvisionedInitialAdmin = true;
        return res.status(403).json({
          error: 'Initial administrator has already been provisioned. First-time setup is closed.',
        });
      }
    }

    const { email, password, fullName, organizationName, setupSecret } = req.body;
    const expectedSecret = process.env.SETUP_PROVISIONING_SECRET;

    const validation = validateFirstTimeSetupPayload(
      { email, password, fullName, organizationName, setupSecret },
      expectedSecret
    );

    if (!validation.isValid) {
      return res.status(400).json({ error: validation.error });
    }

    let userId = '';

    let setupWarnings: string[] = [];

    if (supabaseAdmin) {
      // 1. Create User in Supabase Auth (idempotent so a failed setup run can
      //    be retried with the same address instead of dead-ending).
      const { data: userData, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

      if (createAuthError || !userData?.user) {
        const alreadyExists =
          createAuthError?.code === 'email_exists' || /already (registered|exists)/i.test(createAuthError?.message || '');
        if (!alreadyExists) {
          return res.status(400).json({ error: `Auth creation failed: ${createAuthError?.message || 'unknown error'}` });
        }

        // GoTrue has no server-side email filter on this client version, so
        // page through the directory to find the account we may reuse.
        let match: { id: string } | undefined;
        try {
          for (let page = 1; page <= 10 && !match; page++) {
            const { data: pageData, error: lookupErr } = await supabaseAdmin.auth.admin.listUsers({
              page,
              perPage: 1000,
            });
            if (lookupErr) throw lookupErr;
            const users = pageData?.users || [];
            match = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
            if (users.length < 1000) break;
          }
        } catch (lookupErr) {
          const detail = lookupErr instanceof Error ? lookupErr.message : 'directory lookup failed';
          return res.status(400).json({ error: `That address already has an account that could not be reused: ${detail}` });
        }
        if (!match) {
          return res
            .status(400)
            .json({ error: 'That address already has an account, but it could not be located.' });
        }
        userId = match.id;
      } else {
        userId = userData.user.id;
      }

      const warnings: string[] = setupWarnings;
      // 2. Create Profile
      const { error: profileErr } = await supabaseAdmin.from('profiles').upsert({
        id: userId,
        email,
        full_name: fullName,
        job_title: 'Founder & Super Administrator',
      });
      if (profileErr) {
        return res.status(500).json({ error: `Profile creation failed: ${profileErr.message}` });
      }

      // 3. Create Primary Organization
      const orgSlug = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const { data: orgData, error: orgError } = await supabaseAdmin
        .from('organizations')
        .insert({
          name: organizationName,
          slug: orgSlug || 'primary-workspace',
          description: 'Official workspace for ' + organizationName,
        })
        .select('id')
        .single();

      if (orgError || !orgData?.id) {
        return res
          .status(500)
          .json({ error: `Organization creation failed: ${orgError?.message || 'no id returned'}` });
      }
      const orgId = orgData.id;

      // 4. Create Organization Membership with super_admin role — without this
      //    row the account would have no permissions at all, so it is fatal.
      const { error: membershipErr } = await supabaseAdmin.from('organization_memberships').insert({
        organization_id: orgId,
        user_id: userId,
        role: 'super_admin',
        is_active: true,
      });
      if (membershipErr) {
        return res.status(500).json({ error: `Membership creation failed: ${membershipErr.message}` });
      }

      // 5. Default Department: Executive Leadership (convenience, not fatal)
      const { error: deptErr } = await supabaseAdmin.from('departments').insert({
        organization_id: orgId,
        name: 'Executive Leadership',
        description: 'Strategic leadership, governance, and technology oversight',
        lead_id: userId,
      });
      if (deptErr) warnings.push(`Default department not created: ${deptErr.message}`);

      // 6. Record Setup Completion in system_settings — fatal, otherwise the
      //    setup screen would appear again on next launch.
      const { error: flagErr } = await supabaseAdmin.from('system_settings').upsert({
        key: 'initial_admin_provisioned',
        value: true,
        description: 'First-time super administrator successfully initialized.',
        updated_at: new Date().toISOString(),
      });
      if (flagErr) {
        return res.status(500).json({ error: `Setup completion flag could not be recorded: ${flagErr.message}` });
      }

      // 7. Audit Log (best effort — never blocks the confirmed setup above)
      const { error: auditErr } = await supabaseAdmin.from('audit_logs').insert({
        user_id: userId,
        user_email: email,
        action: 'INITIAL_ADMIN_PROVISIONED',
        target_entity: 'organizations',
        target_id: orgId,
        details: {
          organization_name: organizationName,
          admin_email: email,
          timestamp: new Date().toISOString(),
        },
      });
      if (auditErr) warnings.push(`Audit entry not written: ${auditErr.message}`);
    } else {
      // No database client means nothing above was created. Reporting success
      // here would tell the operator an administrator exists when it does not,
      // and the setup screen would reappear on the next launch anyway.
      return res.status(503).json({
        error:
          'Server storage is not configured, so no administrator account could be created. Set SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL, then try again.',
      });
    }

    hasProvisionedInitialAdmin = true;
    initialAdminRecord = {
      id: userId || 'admin-001',
      email,
      fullName,
      organizationName,
    };

    return res.status(200).json({
      success: true,
      message: setupWarnings.length > 0
        ? 'Initial administrator and workspace provisioned, with warnings.'
        : 'Initial administrator and workspace provisioned successfully.',
      ...(setupWarnings.length > 0 ? { warnings: setupWarnings } : {}),
      user: {
        id: userId || 'admin-001',
        email,
        fullName,
        role: 'super_admin',
        organizationName,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    console.error('Initial admin setup error:', err);
    return res.status(500).json({ error: `Internal provisioning failure: ${message}` });
  }
});

// 4. LIVEKIT TOKEN GENERATION FOR SAM_TECK MEET
//
// Secure meeting access is enforced *here*, not in the UI:
//   1. the caller must present a valid Supabase session JWT,
//   2. the room must belong to a real Sam_Teck meeting record,
//   3. the caller must be an active member of that meeting's organisation,
//   4. for private sessions, the caller must also be the host, an invitee,
//      an attendee, or a leadership member.
// The participant identity is taken from the verified session — never from
// the request body — so nobody can join as somebody else.
app.post('/api/meet/token', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const callerId = req.callerId as string;
    const { roomName, participantName } = req.body as {
      roomName?: string;
      participantName?: string;
    };

    if (!roomName) {
      return res.status(400).json({ error: 'roomName is required' });
    }

    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Database service is not configured' });
    }

    // Resolve the room to a real meeting we can authorise against.
    const { data: meeting, error: meetingErr } = await supabaseAdmin
      .from('meetings')
      .select('id, title, organization_id, host_id, is_private, status, livekit_room_name')
      .eq('livekit_room_name', roomName)
      .maybeSingle();

    if (meetingErr) {
      return res.status(500).json({ error: meetingErr.message });
    }
    if (!meeting) {
      return res.status(403).json({ error: 'That meeting room does not exist or is no longer available.' });
    }

    const membership = await getCallerMembership(callerId, meeting.organization_id);
    if (!membership) {
      return res.status(403).json({ error: 'You are not an active member of the organisation that owns this meeting.' });
    }

    const isLead = MEETING_LEAD_ROLES.has(membership.role);
    const isHost = meeting.host_id === callerId;

    if (meeting.is_private && !isLead && !isHost) {
      const [{ data: invited }, { data: attended }] = await Promise.all([
        supabaseAdmin
          .from('meeting_invitations')
          .select('id')
          .eq('meeting_id', meeting.id)
          .eq('user_id', callerId)
          .maybeSingle(),
        supabaseAdmin
          .from('meeting_participants')
          .select('id')
          .eq('meeting_id', meeting.id)
          .eq('user_id', callerId)
          .maybeSingle(),
      ]);

      if (!invited && !attended) {
        return res.status(403).json({ error: 'You have not been invited to this private meeting.' });
      }
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL || '';

    if (!apiKey || !apiSecret) {
      // If LiveKit credentials are not configured yet on the backend, inform caller cleanly
      return res.status(503).json({
        error: 'LIVEKIT_NOT_CONFIGURED',
        message: 'LiveKit credentials (LIVEKIT_API_KEY / LIVEKIT_API_SECRET) must be set in .env to issue production WebRTC tokens.',
      });
    }

    const identity = callerId;

    // Issue short-lived, securely scoped room token (2 hours)
    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: participantName || identity,
      ttl: '2h',
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // Room administration follows the meeting record, not a client flag.
      roomAdmin: Boolean(isHost || isLead),
    });

    const token = await at.toJwt();

    return res.json({
      token,
      livekitUrl,
      roomName,
      identity,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token generation error';
    console.error('Error generating LiveKit token:', err);
    return res.status(500).json({ error: message });
  }
});

// 5. CONVERT MEETING ACTION ITEM DIRECTLY TO REAL PROJECT TASK
app.post('/api/meet/action-items/convert', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const callerId = req.callerId as string;
    const { actionItemId, projectId, title, description, assigneeId, dueDate } = req.body;

    if (!actionItemId || !projectId || !title) {
      return res.status(400).json({ error: 'actionItemId, projectId, and title are required' });
    }

    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Database service is not configured' });
    }

    // The action item must belong to a meeting inside an organisation the
    // caller actually belongs to — otherwise this endpoint would let any
    // signed-in user write into any tenant's task table.
    const { data: actionItem, error: aiErr } = await supabaseAdmin
      .from('meeting_action_items')
      .select('id, meeting_id, assignee_id, meetings(organization_id)')
      .eq('id', actionItemId)
      .maybeSingle();

    if (aiErr) {
      return res.status(400).json({ error: aiErr.message });
    }
    if (!actionItem) {
      return res.status(404).json({ error: 'Meeting action item not found.' });
    }

    const meetingOrg =
      (actionItem.meetings as unknown as { organization_id?: string } | null)?.organization_id || null;
    if (!meetingOrg) {
      return res.status(404).json({ error: 'The meeting for this action item no longer exists.' });
    }

    const membership = await getCallerMembership(callerId, meetingOrg);
    if (!membership) {
      return res.status(403).json({ error: 'You are not an active member of this organisation.' });
    }
    if (
      !MEETING_LEAD_ROLES.has(membership.role) &&
      actionItem.assignee_id !== callerId
    ) {
      return res.status(403).json({ error: 'Only project leads or the assigned owner can convert this action item.' });
    }

    // 1. Insert task into real tasks table
    const { data: taskData, error: taskError } = await supabaseAdmin
      .from('tasks')
      .insert({
        project_id: projectId,
        title,
        description,
        status: 'todo',
        priority: 'high',
        assignee_id: assigneeId || null,
        created_by: callerId,
        due_date: dueDate || null,
        origin_action_item_id: actionItemId,
      })
      .select('id')
      .single();

    if (taskError) {
      return res.status(400).json({ error: taskError.message });
    }

    // 2. Update meeting_action_items
    await supabaseAdmin
      .from('meeting_action_items')
      .update({
        is_converted_to_task: true,
        task_id: taskData.id,
      })
      .eq('id', actionItemId);

    return res.json({
      success: true,
      taskId: taskData.id,
      message: 'Meeting action item converted into project task.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Action item conversion failed';
    return res.status(500).json({ error: message });
  }
});

// 6. RECORD AUDIT LOG ENTRY
app.post('/api/audit/log', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const callerId = req.callerId as string;
    const { action, targetEntity, targetId, details } = req.body;
    if (!action || !targetEntity) {
      return res.status(400).json({ error: 'action and targetEntity are required' });
    }

    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Database service is not configured.' });
    }

    // Identity comes from the verified session so entries cannot be forged
    // against another member's name.
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(callerId);
    const userEmail = userData?.user?.email || null;

    const entry = {
      user_id: callerId as string | null,
      user_email: userEmail,
      action,
      target_entity: targetEntity,
      target_id: targetId || null,
      details: details || {},
      ip_address: req.ip || null,
    };

    const { error: insertErr } = await supabaseAdmin.from('audit_logs').insert(entry);

    if (insertErr && insertErr.code === '23503' && entry.user_id) {
      // No profile row for this identity yet (e.g. an account being
      // provisioned). Record the event by email rather than dropping it.
      const { error: retryErr } = await supabaseAdmin.from('audit_logs').insert({
        ...entry,
        user_id: null,
        details: { ...entry.details, attributed_by_email: true },
      });
      if (retryErr) {
        return res.status(500).json({ error: retryErr.message });
      }
    } else if (insertErr) {
      // Never claim success for a row that was not written.
      return res.status(500).json({ error: insertErr.message });
    }

    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Audit log failure' });
  }
});

// 6a. REMOVE A MEMBER
//
//     Removing a member is irreversible, so every rule is enforced here and in
//     the database rather than by hiding a button in the interface. The order
//     of checks matters: identity is proven first, then the caller's own
//     standing, then their authority over the target.
//
//     Two database facts shape the implementation:
//
//       * `profiles.id` references `auth.users(id)` ON DELETE CASCADE, so
//         deleting the auth user removes the profile, the membership and every
//         personal row (notifications, votes, participation) in one go.
//       * Eight columns reference `profiles(id)` ON DELETE RESTRICT, and several
//         more — meetings.host_id, ideas.author_id, announcements.author_id —
//         are ON DELETE CASCADE. A plain delete would therefore either fail
//         outright, or silently destroy meetings, ideas, announcements and
//         documents that other people still depend on.
//
//     So work the member authored is first handed to a reserved "former
//     member" identity that can never sign in, and only then is the account
//     removed. The records stay intact and readable; the account does not.

/** Roles permitted to remove a member (mirrors `can_manage_members`). */
const MEMBER_MANAGER_ROLES = new Set(['super_admin', 'team_leader', 'assistant_leader']);

/**
 * Seniority order of the `user_role` enum, most senior first. Used to stop a
 * leader from removing a peer or a superior.
 */
const ROLE_RANK: Record<string, number> = {
  super_admin: 0,
  team_leader: 1,
  assistant_leader: 2,
  project_manager: 3,
  department_lead: 4,
  team_member: 5,
  guest: 6,
};

const rankOf = (role: string) => ROLE_RANK[role] ?? ROLE_RANK.guest;

// `.invalid` is reserved by RFC 2606, so this address can never route mail.
const FORMER_MEMBER_EMAIL = 'former-members@deleted.invalid';

/**
 * The identity that inherits a removed member's work. Created once and reused.
 * It is banned at creation, so the account can never be used to sign in — it
 * exists only so that records pointing at a person keep a valid target.
 */
const ensureFormerMemberProfile = async (): Promise<string | null> => {
  if (!supabaseAdmin) return null;

  const { data: existing } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('email', FORMER_MEMBER_EMAIL)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: FORMER_MEMBER_EMAIL,
    password: crypto.randomBytes(48).toString('base64url'),
    email_confirm: true,
    ban_duration: '87600h',
  });
  if (createErr || !created?.user) {
    console.warn('Former-member identity could not be created:', createErr?.message);
    return null;
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .upsert({
      id: created.user.id,
      email: FORMER_MEMBER_EMAIL,
      full_name: 'Former member',
      job_title: 'Account removed',
    })
    .select('id')
    .maybeSingle();

  return profile?.id ?? null;
};

/**
 * Which columns are handed to the former-member identity now lives in
 * `public.reassign_member_records` (migration 20261016170000), next to the
 * reasoning for each. Keeping it in SQL is what makes the handover a single
 * transaction — a loop here would leave the records half-moved if one
 * statement failed part-way through.
 */

app.post('/api/members/:userId/delete', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const callerId = req.callerId as string;
    const targetUserId = String(req.params.userId);
    const confirmEmail = String(req.body?.confirmEmail || '').trim().toLowerCase();

    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Database service is not configured.' });
    }
    if (!targetUserId) {
      return res.status(400).json({ error: 'A member is required.' });
    }
    if (!confirmEmail) {
      return res.status(400).json({ error: "Type the member's email address to confirm removal." });
    }
    if (targetUserId === callerId) {
      return res.status(403).json({ error: 'You cannot remove your own account.' });
    }

    // 1. The caller's standing. Derived from the session, never from the
    //    request, so a tampered body cannot claim a different role.
    const caller = await getCallerOrg(callerId);
    if (!caller) {
      return res.status(403).json({ error: 'You are not an active organisation member.' });
    }
    if (!MEMBER_MANAGER_ROLES.has(caller.role)) {
      return res.status(403).json({ error: 'Only leadership can remove members.' });
    }

    // 2. The target, scoped to the caller's own organisation so an
    //    administrator of one workspace cannot reach into another.
    const { data: target, error: targetErr } = await supabaseAdmin
      .from('organization_memberships')
      .select('id, role, is_active, user_id, profile:profiles!user_id(id, email, full_name)')
      .eq('organization_id', caller.organization_id)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (targetErr) return res.status(500).json({ error: targetErr.message });

    // PostgREST returns the embedded profile as an object for a many-to-one
    // join, but the generated types allow an array — accept either rather than
    // casting blind.
    const embedded = target?.profile as unknown;
    const targetProfile =
      (Array.isArray(embedded) ? embedded[0] : embedded) as
        | { id: string; email: string; full_name: string }
        | null;
    if (!target || !targetProfile) {
      return res.status(404).json({ error: 'That member is not in your organisation.' });
    }

    // 3. Seniority. A leader may remove people below them, never a peer or
    //    anyone above them. This also makes the last super_admin impossible to
    //    remove, so a workspace can never lose its final administrator.
    if (rankOf(target.role) <= rankOf(caller.role)) {
      return res.status(403).json({
        error: 'You cannot remove a member whose role is equal to or above your own.',
      });
    }

    // 4. Explicit confirmation, re-checked here rather than trusted from the UI.
    if (targetProfile.email.toLowerCase() !== confirmEmail) {
      return res.status(400).json({
        error: "That does not match the member's email address. Nothing was removed.",
      });
    }

    // 5. Hand the member's work to the former-member identity first. If this
    //    cannot be done, the removal is refused rather than risking the loss of
    //    records that belong to other people.
    const formerId = await ensureFormerMemberProfile();
    if (!formerId) {
      return res.status(500).json({
        error:
          'The former-member record could not be prepared, so nothing was removed. No work was lost.',
      });
    }

    // 6. The handover runs as the caller, not as the service role. The
    //    function re-reads auth.uid() and re-checks every rule — leadership,
    //    seniority, organisation, confirmation — inside one transaction, so
    //    either all of the member's records are handed over or none are. It
    //    also runs the `tasks` protection trigger as the real caller, where
    //    is_manager_or_above() is meaningful, instead of as a role the trigger
    //    cannot evaluate.
    const callerToken = readBearer(req);
    const callerScoped = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${callerToken}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: moved, error: moveErr } = await callerScoped.rpc('reassign_member_records', {
      p_member: targetUserId,
      p_former: formerId,
      p_org: caller.organization_id,
      p_confirm_email: confirmEmail,
    });

    if (moveErr) {
      // A missing function means the supporting migration has not been run
      // yet. Say so plainly instead of surfacing a PostgREST code nobody can
      // act on — and confirm nothing was touched.
      if (moveErr.code === 'PGRST202' || /could not find the function/i.test(moveErr.message)) {
        return res.status(503).json({
          error:
            'Member removal is not available yet: the 20261016170000_member_removal_realtime migration has not been applied. Run it in the Supabase SQL editor, then retry. No account was deleted and no records were changed.',
        });
      }
      // The database states the reason; surface it verbatim so the message
      // matches the rule that actually stopped the removal.
      return res.status(400).json({
        error: `${moveErr.message}. No account was deleted and no records were changed.`,
      });
    }
    const reassigned: Record<string, number> = (moved as { moved?: Record<string, number> })?.moved || {};

    // 7. Remove the account. This cascades to the profile, the membership and
    //    every personal row in a single database operation.
    const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);
    if (deleteErr) {
      return res.status(500).json({
        error: `The account could not be deleted: ${deleteErr.message}. No account was removed.`,
      });
    }

    // 7. Confirm the membership is really gone before claiming success.
    const { data: stillThere } = await supabaseAdmin
      .from('organization_memberships')
      .select('id')
      .eq('user_id', targetUserId)
      .eq('organization_id', caller.organization_id)
      .maybeSingle();
    if (stillThere) {
      return res.status(500).json({
        error: 'The account was deleted but the membership row still exists. Remove it manually.',
      });
    }

    // 8. Audit trail, attributed to the verified caller.
    const { data: callerUser } = await supabaseAdmin.auth.admin.getUserById(callerId);
    const { error: auditErr } = await supabaseAdmin.from('audit_logs').insert({
      user_id: callerId,
      user_email: callerUser?.user?.email || null,
      action: 'member_removed',
      target_entity: 'organization_memberships',
      target_id: target.id,
      details: {
        removed_user_id: targetUserId,
        removed_email: targetProfile.email,
        removed_name: targetProfile.full_name,
        removed_role: target.role,
        removed_by_email: callerUser?.user?.email || null,
        preserved_records: reassigned,
      },
      ip_address: req.ip || null,
    });
    if (auditErr) {
      // The removal itself succeeded; report it truthfully with the gap noted.
      console.warn('Member removal audit entry failed:', auditErr.message);
    }

    return res.json({
      success: true,
      removedUserId: targetUserId,
      removedEmail: targetProfile.email,
      removedName: targetProfile.full_name,
      preservedRecords: reassigned,
      auditRecorded: !auditErr,
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Member removal failed' });
  }
});

// 6b. DOCUMENT FILE STORAGE
//
//     Document *metadata* lives in `public.documents`, where member-level RLS
//     already permits a member to read and manage their own organisation's
//     rows. The file bytes are handled here rather than straight from the
//     browser because creating policies on `storage.objects` requires
//     ownership privileges the SQL editor does not always have — when that
//     migration step cannot run, a direct browser upload fails with a
//     confusing RLS error. Serving the bytes through the authenticated server
//     keeps the library usable and lets the organisation be enforced on the
//     backend, independently of the frontend.
//
//     The cap is 4 MB rather than the 10 MB this started at: Vercel rejects any
//     request body over 4.5 MB at the platform edge, before this code runs, so
//     a higher limit here would simply produce a confusing failure for anyone
//     uploading a large file. Raising it means moving uploads to a different
//     path - a signed direct-to-storage upload, for instance.
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const DOCUMENT_BUCKET = 'documents';

/** Roles that may open or delete any file inside their organisation. */
const DOCUMENT_LEADERSHIP_ROLES = new Set([
  'super_admin',
  'team_leader',
  'assistant_leader',
  'project_manager',
  'department_lead',
]);

/** `documents/{orgId}/{userId}/{fileName}` — the layout RLS policies expect. */
const parseDocumentPath = (raw: string) => {
  const parts = String(raw || '').split('/').filter(Boolean);
  if (parts.length < 4 || parts[0] !== DOCUMENT_BUCKET) return null;
  return { orgId: parts[1], ownerId: parts[2] };
};

app.post(
  '/api/documents/upload',
  requireAuth,
  express.raw({ type: '*/*', limit: MAX_DOCUMENT_BYTES }),
  async (req: AuthedRequest, res: Response) => {
    try {
      const callerId = req.callerId as string;
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Database service is not configured.' });
      }

      const membership = await getCallerOrg(callerId);
      if (!membership) {
        return res.status(403).json({ error: 'Only active organisation members can upload files.' });
      }

      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return res.status(400).json({ error: 'No file content was received.' });
      }

      const rawName = String(req.headers['x-file-name'] || 'file');
      const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';
      const contentType = String(req.headers['content-type'] || 'application/octet-stream');
      const filePath = `${DOCUMENT_BUCKET}/${membership.organization_id}/${callerId}/${Date.now()}_${safeName}`;

      const { error: upErr } = await supabaseAdmin.storage
        .from(DOCUMENT_BUCKET)
        .upload(filePath, body, { contentType, cacheControl: '3600', upsert: false });

      if (upErr) {
        return res.status(500).json({ error: `The file could not be stored: ${upErr.message}` });
      }

      // Confirm the object is genuinely readable before reporting success.
      const { error: verifyErr } = await supabaseAdmin.storage
        .from(DOCUMENT_BUCKET)
        .createSignedUrl(filePath, 30);
      if (verifyErr) {
        return res.status(500).json({ error: `The file was not stored correctly: ${verifyErr.message}` });
      }

      return res.json({ path: filePath, size: body.length, contentType });
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failure' });
    }
  }
);

app.get('/api/documents/:id/download', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const callerId = req.callerId as string;
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Database service is not configured.' });
    }

    const membership = await getCallerOrg(callerId);
    if (!membership) {
      return res.status(403).json({ error: 'You are not an active organisation member.' });
    }

    const { data: doc, error: docErr } = await supabaseAdmin
      .from('documents')
      .select('id, organization_id, file_path, file_name')
      .eq('id', String(req.params.id))
      .maybeSingle();

    if (docErr) return res.status(500).json({ error: docErr.message });
    if (!doc) return res.status(404).json({ error: 'That document does not exist.' });
    if (doc.organization_id !== membership.organization_id) {
      return res.status(403).json({ error: 'That document belongs to a different organisation.' });
    }
    if (!doc.file_path) {
      return res.status(400).json({ error: 'This entry is a metadata-only record with no stored file.' });
    }

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrl(doc.file_path, 60);

    if (signErr || !signed?.signedUrl) {
      return res.status(404).json({ error: 'The stored file could not be found. It may have been removed.' });
    }

    return res.json({ url: signed.signedUrl, fileName: doc.file_name });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Download failure' });
  }
});

// Reading is scoped to the organisation, not to the uploader: anything stored
// under an organisation's folder is readable by its active members, matching
// the SELECT policy on storage.objects. This covers files that have no
// `documents` row of their own, such as task attachments.
app.post('/api/documents/download-path', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const callerId = req.callerId as string;
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Database service is not configured.' });
    }

    const membership = await getCallerOrg(callerId);
    if (!membership) {
      return res.status(403).json({ error: 'You are not an active organisation member.' });
    }

    const requestedPath = String(req.body?.path || '');
    const parsed = parseDocumentPath(requestedPath);
    if (!parsed) {
      return res.status(400).json({ error: 'That is not a valid document path.' });
    }
    if (parsed.orgId !== membership.organization_id) {
      return res.status(403).json({ error: 'That file belongs to a different organisation.' });
    }

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrl(requestedPath, 60);

    if (signErr || !signed?.signedUrl) {
      return res.status(404).json({ error: 'The stored file could not be found. It may have been removed.' });
    }

    return res.json({ url: signed.signedUrl });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Download failure' });
  }
});

app.post('/api/documents/delete-file', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const callerId = req.callerId as string;
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Database service is not configured.' });
    }

    const membership = await getCallerOrg(callerId);
    if (!membership) {
      return res.status(403).json({ error: 'You are not an active organisation member.' });
    }

    const requestedPath = String(req.body?.path || '');
    const parsed = parseDocumentPath(requestedPath);
    if (!parsed) {
      return res.status(400).json({ error: 'That is not a valid document path.' });
    }
    if (parsed.orgId !== membership.organization_id) {
      return res.status(403).json({ error: 'That file belongs to a different organisation.' });
    }
    if (parsed.ownerId !== callerId && !DOCUMENT_LEADERSHIP_ROLES.has(membership.role)) {
      return res.status(403).json({ error: 'Only the uploader or a team leader can delete this file.' });
    }

    const { error: rmErr } = await supabaseAdmin.storage.from(DOCUMENT_BUCKET).remove([requestedPath]);
    const message = (rmErr?.message || '').toLowerCase();
    // A file that is already gone is the outcome the caller wanted.
    if (rmErr && !message.includes('not found') && !message.includes('no rows')) {
      return res.status(500).json({ error: `The file could not be removed: ${rmErr.message}` });
    }

    return res.json({ success: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failure' });
  }
});

// 7. AUTH LOGIN ROUTE
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  if (initialAdminRecord && initialAdminRecord.email.toLowerCase() === email.toLowerCase()) {
    return res.json({
      success: true,
      user: {
        id: initialAdminRecord.id,
        email: initialAdminRecord.email,
        user_metadata: { full_name: initialAdminRecord.fullName },
      },
      profile: {
        id: initialAdminRecord.id,
        email: initialAdminRecord.email,
        full_name: initialAdminRecord.fullName,
        job_title: 'Founder & Super Administrator',
      },
      organization: {
        id: '00000000-0000-0000-0000-000000000001',
        name: initialAdminRecord.organizationName,
        slug: initialAdminRecord.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      },
      role: 'super_admin',
    });
  }

  return res.status(401).json({ error: 'Invalid credentials or user not found' });
});

// 8. MEMBER INVITATIONS: issue, deliver, and accept
const APP_BASE_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
const INVITE_TTL_DAYS = 7;

const makeInviteToken = () => crypto.randomBytes(32).toString('hex');

// Validate an email address (RFC-ish, good enough for UI input).
const isValidEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

// This auth-js version has no getUserByEmail, so page through listUsers.
const findUserIdByEmail = async (email: string): Promise<string | null> => {
  if (!supabaseAdmin) return null;
  try {
    const target = email.toLowerCase();
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error || !data?.users?.length) return null;
      const match = data.users.find((u) => (u.email || '').toLowerCase() === target);
      if (match) return match.id;
      if (data.users.length < 200) return null; // last page
    }
  } catch {
    // fall through to null
  }
  return null;
};

// 8a. CREATE + EMAIL an invitation
//
// The inviter, the organisation and the granted role are all derived from the
// verified session and the caller's own membership — the request body is only
// trusted for the invitee's address, role and department.
app.post('/api/invitations', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Database service is not configured (SUPABASE_SERVICE_ROLE_KEY missing).' });
    }

    const callerId = req.callerId as string;
    const { email, role, departmentId, organizationId: requestedOrgId } = req.body as {
      email?: string; role?: string; departmentId?: string | null;
      organizationId?: string;
    };

    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    // Resolve the caller's memberships — never accept them from the body.
    const { data: callerMemberships, error: memErr } = await supabaseAdmin
      .from('organization_memberships')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (memErr) {
      return res.status(500).json({ error: memErr.message });
    }

    const memberships = callerMemberships || [];
    const invitable = memberships.filter((m) => INVITER_ROLES.has(m.role));
    if (invitable.length === 0) {
      return res
        .status(403)
        .json({ error: 'Only team leaders and super administrators can invite members.' });
    }

    // Prefer the organisation the caller asked for, but only if they are an
    // authorised inviter inside it.
    const membership =
      (requestedOrgId && invitable.find((m) => m.organization_id === requestedOrgId)) || invitable[0];
    const organizationId = membership.organization_id;
    const invitedById = callerId;

    // Role hierarchy guard: you cannot invite somebody above your own role.
    const RANK: Record<string, number> = {
      super_admin: 1, team_leader: 2, assistant_leader: 3,
      project_manager: 4, department_lead: 5, team_member: 6, guest: 7,
    };
    const requestedRole = (role || '').trim();
    if (!requestedRole || !(requestedRole in RANK)) {
      return res.status(400).json({ error: 'A valid role is required.' });
    }
    if (RANK[requestedRole] < RANK[membership.role]) {
      return res
        .status(403)
        .json({ error: 'You cannot invite somebody at a higher role than your own.' });
    }

    // Look up org + inviter so the email is personalised.
    const { data: org } = await supabaseAdmin
      .from('organizations').select('id, name').eq('id', organizationId).single();
    const { data: inviter } = await supabaseAdmin
      .from('profiles').select('id, full_name, email').eq('id', invitedById).single();

    const orgName = org?.name || 'Sam_Teck Hub';
    const inviterName = inviter?.full_name || 'A workspace administrator';

    // Supersede any outstanding invite for this address in this org.
    await supabaseAdmin
      .from('invitations')
      .delete()
      .eq('organization_id', organizationId)
      .eq('email', normalizedEmail)
      .eq('is_accepted', false);

    const token = makeInviteToken();
    const inviteUrl = `${APP_BASE_URL}/invite/${token}`;
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    let authUserId: string | null = null;
    // True only when the address already had a registered account before this
    // invite — used to decide whether an invite email could actually be sent.
    let accountPreExisted = false;

    let emailSent = false;
    let emailProviderError: string | null = null;

    // GoTrue creates the auth user AND delivers the email through the
    // project's built-in SMTP. This is the real delivery step.
    try {
      const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
        redirectTo: inviteUrl,
        data: {
          organization_name: orgName,
          invited_by: inviterName,
          invite_token: token,
        },
      });

      if (inviteErr) {
        const msg = inviteErr.message || '';
        const code = (inviteErr as { code?: string }).code || '';
        const alreadyExists =
          code === 'email_exists' ||
          code === 'user_already_exists' ||
          /already/i.test(msg);

        if (alreadyExists) {
          // GoTrue refuses to re-invite a registered address, so the invite
          // email cannot be sent. Fall back to a magic link, which Supabase
          // does deliver to an existing user - verified: generateLink with
          // type "invite" fails here with "already been registered", while
          // type "magiclink" succeeds and returns a link. It signs the
          // recipient in and returns them to the invite URL, where acceptance
          // attaches the membership by email lookup.
          accountPreExisted = true;
          authUserId = await findUserIdByEmail(normalizedEmail);
          try {
            const { error: magicErr } = await supabaseAdmin.auth.admin.generateLink({
              type: 'magiclink',
              email: normalizedEmail,
              options: { redirectTo: inviteUrl },
            });
            if (magicErr) {
              emailSent = false;
              emailProviderError = magicErr.message || 'Email delivery failed';
            } else {
              emailSent = true;
              emailProviderError = null;
            }
          } catch (magicException) {
            emailSent = false;
            emailProviderError =
              magicException instanceof Error ? magicException.message : 'Email delivery failed';
          }
        } else {
          emailProviderError = msg || 'Email delivery failed';
        }
      } else {
        emailSent = true;
        authUserId = invited?.user?.id || null;
      }
    } catch (e: unknown) {
      emailProviderError = e instanceof Error ? e.message : 'Email delivery failed';
    }

    // Persist the invitation regardless of email outcome so the link always works.
    let insertedRow: { id: string; email: string; role: string; expires_at: string; created_at: string } | null = null;
    let insertErr: { message: string } | null = null;

    const invitationPayload: Record<string, unknown> = {
      organization_id: organizationId,
      email: normalizedEmail,
      role: role || 'team_member',
      department_id: departmentId || null,
      invited_by: invitedById,
      token,
      expires_at: expiresAt,
    };

    // user_id only exists once the invitations migration is applied, so fall
    // back to the legacy column set rather than failing the whole invite.
    const insertInvitation = (payload: Record<string, unknown>, withUserId: boolean) =>
      supabaseAdmin
        .from('invitations')
        .insert(withUserId ? { ...payload, user_id: authUserId } : payload)
        .select('id, email, role, expires_at, created_at')
        .single();

    {
      const attempt = await insertInvitation(invitationPayload, true);
      if (attempt.error && /user_id.*column|schema cache/i.test(attempt.error.message)) {
        const fallback = await insertInvitation(invitationPayload, false);
        insertedRow = fallback.data;
        insertErr = fallback.error;
      } else {
        insertedRow = attempt.data;
        insertErr = attempt.error;
      }
    }

    if (insertErr || !insertedRow) {
      return res.status(400).json({ error: insertErr?.message || 'Could not record the invitation.' });
    }

    const row = insertedRow;

    await supabaseAdmin.from('audit_logs').insert({
      user_id: invitedById,
      user_email: inviter?.email || null,
      action: 'MEMBER_INVITATION_SENT',
      target_entity: 'invitations',
      target_id: row.id,
      details: { invitee: normalizedEmail, role: role || 'team_member', email_sent: emailSent },
      ip_address: req.ip,
    });

    // Always return the link so the admin can share it manually if SMTP is down
    // or the invitee already has an account.
    let message: string;
    if (emailSent) {
      message = `Invitation email sent to ${normalizedEmail}.`;
    } else if (accountPreExisted) {
      message = `${normalizedEmail} already has an account, so no email was sent. Share the link below so they can join ${orgName}.`;
    } else {
      message = `Invitation saved, but automatic email delivery failed${emailProviderError ? `: ${emailProviderError}` : ''}. Share the link below manually.`;
    }

    return res.json({
      success: true,
      id: row.id,
      email: normalizedEmail,
      inviteUrl,
      emailSent,
      expiresAt,
      existingAccount: accountPreExisted,
      message,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invitation failure';
    console.error('Error creating invitation:', err);
    return res.status(500).json({ error: message });
  }
});

// 8b1. FETCH an invitation's shareable link (authorised — the token is a
//      credential, so it is never exposed to the general members list).
app.get('/api/invitations/:id/link', async (req: Request, res: Response) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Database service is not configured.' });
    }

    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!bearer) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    // Verify the caller's JWT via GoTrue so we know who is asking.
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(bearer);
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }
    const callerId = userData.user.id;

    const { data: invite, error } = await supabaseAdmin
      .from('invitations')
      .select('id, token, invited_by, organization_id, is_accepted, expires_at')
      .eq('id', req.params.id)
      .single();

    if (error || !invite) {
      return res.status(404).json({ error: 'Invitation not found.' });
    }

    // Only the person who issued it, or an active member of that org, may read it.
    const { data: caller } = await supabaseAdmin
      .from('organization_memberships')
      .select('id')
      .eq('organization_id', invite.organization_id)
      .eq('user_id', callerId)
      .eq('is_active', true)
      .maybeSingle();

    if (invite.invited_by !== callerId && !caller) {
      return res.status(403).json({ error: 'You are not authorised to view this invitation link.' });
    }

    if (invite.is_accepted) {
      return res.status(410).json({ error: 'This invitation has already been accepted.' });
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'This invitation has expired.' });
    }

    return res.json({ inviteUrl: `${APP_BASE_URL}/invite/${invite.token}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not read invitation link';
    console.error('Error reading invitation link:', err);
    return res.status(500).json({ error: message });
  }
});

// 8b. LOOKUP an invitation by token (public — used by the invite landing page)
app.get('/api/invitations/:token', async (req: Request, res: Response) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Database service is not configured.' });
    }

    const { token } = req.params;
    if (!token || token.length < 16) {
      return res.status(400).json({ error: 'Invalid invitation token.' });
    }

    const { data: invite, error } = await supabaseAdmin
      .from('invitations')
      .select('id, email, role, department_id, is_accepted, expires_at, organization:organizations(name, slug), inviter:profiles(full_name, email)')
      .eq('token', token)
      .single();

    if (error || !invite) {
      return res.status(404).json({ error: 'This invitation link is not valid or has been revoked.' });
    }
    if (invite.is_accepted) {
      return res.status(410).json({ error: 'This invitation has already been accepted. Please sign in instead.' });
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'This invitation has expired. Ask an administrator to send a new one.' });
    }

    const org = invite.organization as unknown as { name?: string } | null;
    const inviter = invite.inviter as unknown as { full_name?: string } | null;

    return res.json({
      email: invite.email,
      role: invite.role,
      organizationName: org?.name || 'Sam_Teck Hub',
      invitedByName: inviter?.full_name || 'A workspace administrator',
      expiresAt: invite.expires_at,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not read invitation';
    console.error('Error looking up invitation:', err);
    return res.status(500).json({ error: message });
  }
});

// 8c. ACCEPT an invitation: set password, create profile + membership
app.post('/api/invitations/:token/accept', async (req: Request, res: Response) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Database service is not configured.' });
    }

    const { token } = req.params;
    const { fullName, password } = req.body as { fullName?: string; password?: string };

    const name = (fullName || '').trim();
    if (name.length < 2) {
      return res.status(400).json({ error: 'Full name is required.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const { data: invite, error: invErr } = await supabaseAdmin
      .from('invitations')
      .select('id, email, role, department_id, organization_id, user_id, is_accepted, expires_at')
      .eq('token', token)
      .single();

    let inviteRecord = invite as {
      id: string; email: string; role: string; department_id: string | null;
      organization_id: string; user_id?: string | null; is_accepted: boolean; expires_at: string;
    } | null;

    if (invErr && /user_id.*column|schema cache/i.test(invErr.message)) {
      // invitations.user_id not added yet — retry without it.
      const { data: retry, error: retryErr } = await supabaseAdmin
        .from('invitations')
        .select('id, email, role, department_id, organization_id, is_accepted, expires_at')
        .eq('token', token)
        .single();
      if (!retryErr) inviteRecord = retry as typeof inviteRecord;
    }

    const inviteRow = inviteRecord as typeof invite & { user_id?: string | null } | null;

    if (!inviteRow) {
      return res.status(404).json({ error: 'This invitation link is not valid or has been revoked.' });
    }
    if (inviteRow.is_accepted) {
      return res.status(410).json({ error: 'This invitation has already been accepted. Please sign in instead.' });
    }
    if (new Date(inviteRow.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'This invitation has expired. Ask an administrator to send a new one.' });
    }

    let userId = inviteRow.user_id || null;
    if (!userId) {
      // Either the column is missing or no auth user was linked yet.
      userId = await findUserIdByEmail(inviteRow.email);
    }

    if (!userId) {
      // Invite was issued for an address with no account yet — create it now.
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: inviteRow.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (createErr) {
        return res.status(400).json({ error: createErr.message });
      }
      userId = created.user.id;
    } else {
      // Account already exists (from the invite email) — set their password.
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (updErr) {
        return res.status(400).json({ error: updErr.message });
      }
    }

    // Profile row (service role bypasses the RLS "insert own profile" rule).
    const { error: profErr } = await supabaseAdmin.from('profiles').upsert({
      id: userId,
      email: inviteRow.email,
      full_name: name,
      department_id: inviteRow.department_id || null,
    });
    if (profErr) {
      return res.status(400).json({ error: `Profile setup failed: ${profErr.message}` });
    }

    // Membership — this is what actually grants workspace access.
    const { error: memErr } = await supabaseAdmin.from('organization_memberships').upsert({
      organization_id: inviteRow.organization_id,
      user_id: userId,
      role: inviteRow.role,
      is_active: true,
    }, { onConflict: 'organization_id,user_id' });
    if (memErr) {
      return res.status(400).json({ error: `Membership setup failed: ${memErr.message}` });
    }

    await supabaseAdmin
      .from('invitations')
      .update({ is_accepted: true, accepted_at: new Date().toISOString() })
      .eq('id', inviteRow.id);

    await supabaseAdmin.from('audit_logs').insert({
      user_id: userId,
      user_email: inviteRow.email,
      action: 'MEMBER_INVITATION_ACCEPTED',
      target_entity: 'organization_memberships',
      target_id: inviteRow.organization_id,
      details: { role: inviteRow.role },
      ip_address: req.ip,
    });

    return res.json({
      success: true,
      email: inviteRow.email,
      role: inviteRow.role,
      message: `Welcome aboard, ${name}! Your account is ready — please sign in.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Acceptance failed';
    console.error('Error accepting invitation:', err);
    return res.status(500).json({ error: message });
  }
});

// Exported for two callers that own the listener lifecycle:
//   * api/index.ts - the Vercel serverless entry, invoked per request.
//   * dev-server.ts - local development, which mounts Vite middleware first.
// Importing this file must never bind a port itself, so that is gated below.
export default app;

// Bind a port only when this file is the program actually being run
// (`pnpm start`, serving the built frontend from disk). Importing this module
// - by the Vercel entry (api/index.ts) or the dev bootstrap (dev-server.ts) -
// must never bind a port, because the caller owns that lifecycle.
//
// Compared by filename rather than by import.meta.url. As above, `import.meta`
// can become a parse-time SyntaxError under a CommonJS bundler, which no
// try/catch here could recover from, and the filename answers the same
// question without that risk.
const entryFile = (() => {
  try {
    const entry = process.argv[1] || '';
    return path.basename(entry).toLowerCase();
  } catch {
    return '';
  }
})();

const isDirectRun = entryFile === 'server.ts' || entryFile === 'server.js';

if (isDirectRun) {
  if (isProduction) {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, 'localhost', () => {
    console.log(`[Sam_Teck Hub] Server active on http://localhost:${PORT}`);
  });
}
