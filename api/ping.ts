// Deployment diagnostic.
//
// A deliberately minimal Vercel function: no imports at all, no reference to
// server.ts, no dependency on node_modules. Its only job is to answer one
// question - can this Vercel project build and invoke *any* function?
//
// That question has gone unasked through four separate fixes to server.ts, all
// of which assumed the fault lay in the application code. If this endpoint
// returns JSON, the project configuration is sound and the fault is genuinely
// in server.ts. If it fails with the same FUNCTION_INVOCATION_FAILED, the
// cause is the Vercel project configuration itself, and no amount of editing
// server.ts can fix it.
//
// Reachable at /api/ping. The /api/:path* rewrite does not shadow it: Vercel
// checks the filesystem for real function files before applying rewrites.
export default function handler(_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  const envKeys = Object.keys(process.env);

  res.status(200).json({
    ok: true,
    message: 'Vercel function invocation works. The problem is not project configuration.',
    node: process.version,
    timestamp: new Date().toISOString(),

    // Reported without values, since this response is public.
    environment: {
      VERCEL: process.env.VERCEL ?? null,
      NODE_ENV: process.env.NODE_ENV ?? null,
      envVarCount: envKeys.length,
      hasSupabaseUrl: Boolean(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL),
      hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      hasGoogleMeetClientId: Boolean(process.env.GOOGLE_MEET_CLIENT_ID),
      hasGoogleMeetRefreshToken: Boolean(process.env.GOOGLE_MEET_REFRESH_TOKEN),
      hasSetupSecret: Boolean(process.env.SETUP_PROVISIONING_SECRET),
    },
  });
}
