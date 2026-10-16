import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { AccessToken } from 'livekit-server-sdk';
import { validateFirstTimeSetupPayload } from './src/utils/rules.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json());

// Initialize Supabase Admin Client if service key is provided
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabaseAdmin = (supabaseUrl && supabaseServiceKey)
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
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

// 1. HEALTH & SERVICE INTEGRATION CHECK
app.get('/api/health', async (_req: Request, res: Response) => {
  const isSupabaseConfigured = Boolean(supabaseUrl && (supabaseAnonKey || supabaseServiceKey));
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

// 3. FIRST-TIME INITIAL ADMINISTRATOR PROVISIONING
app.post('/api/setup/initialize-admin', async (req: Request, res: Response) => {
  try {
    if (hasProvisionedInitialAdmin) {
      return res.status(403).json({
        error: 'Initial administrator has already been provisioned. First-time setup is closed.',
      });
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

    if (supabaseAdmin) {
      // 1. Create User in Supabase Auth
      const { data: userData, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

      if (createAuthError) {
        return res.status(400).json({ error: `Auth creation failed: ${createAuthError.message}` });
      }

      userId = userData.user.id;

      // 2. Create Profile
      await supabaseAdmin.from('profiles').upsert({
        id: userId,
        email,
        full_name: fullName,
        job_title: 'Founder & Super Administrator',
      });

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

      const orgId = orgData?.id;

      // 4. Create Organization Membership with super_admin role
      if (orgId) {
        await supabaseAdmin.from('organization_memberships').insert({
          organization_id: orgId,
          user_id: userId,
          role: 'super_admin',
          is_active: true,
        });

        // 5. Default Department: Executive Leadership
        await supabaseAdmin.from('departments').insert({
          organization_id: orgId,
          name: 'Executive Leadership',
          description: 'Strategic leadership, governance, and technology oversight',
          lead_id: userId,
        });
      }

      // 6. Record Setup Completion in system_settings
      await supabaseAdmin.from('system_settings').upsert({
        key: 'initial_admin_provisioned',
        value: true,
        description: 'First-time super administrator successfully initialized.',
        updated_at: new Date().toISOString(),
      });

      // 7. Audit Log
      await supabaseAdmin.from('audit_logs').insert({
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
      message: 'Initial administrator and workspace provisioned successfully.',
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
app.post('/api/meet/token', async (req: Request, res: Response) => {
  try {
    const { roomName, participantIdentity, participantName, isHost } = req.body;

    if (!roomName || !participantIdentity) {
      return res.status(400).json({ error: 'roomName and participantIdentity are required' });
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

    // Issue short-lived, securely scoped room token (2 hours)
    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
      name: participantName || participantIdentity,
      ttl: '2h',
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: Boolean(isHost),
    });

    const token = await at.toJwt();

    return res.json({
      token,
      livekitUrl,
      roomName,
      identity: participantIdentity,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token generation error';
    console.error('Error generating LiveKit token:', err);
    return res.status(500).json({ error: message });
  }
});

// 5. CONVERT MEETING ACTION ITEM DIRECTLY TO REAL PROJECT TASK
app.post('/api/meet/action-items/convert', async (req: Request, res: Response) => {
  try {
    const { actionItemId, projectId, title, description, assigneeId, dueDate, createdBy } = req.body;

    if (!actionItemId || !projectId || !title) {
      return res.status(400).json({ error: 'actionItemId, projectId, and title are required' });
    }

    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Database service is not configured' });
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
        created_by: createdBy,
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
app.post('/api/audit/log', async (req: Request, res: Response) => {
  try {
    const { userId, userEmail, action, targetEntity, targetId, details } = req.body;
    if (!action || !targetEntity) {
      return res.status(400).json({ error: 'action and targetEntity are required' });
    }

    if (supabaseAdmin) {
      await supabaseAdmin.from('audit_logs').insert({
        user_id: userId || null,
        user_email: userEmail || null,
        action,
        target_entity: targetEntity,
        target_id: targetId || null,
        details: details || {},
        ip_address: req.ip,
      });
    }

    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Audit log failure' });
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

// Start Express server and mount Vite middleware
async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Sam_Teck Hub] Server active on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Sam_Teck Hub] Failed to start server:', err);
  process.exit(1);
});
