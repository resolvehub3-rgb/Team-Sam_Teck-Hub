// Dependency bisection diagnostic.
//
// /api/ping proved a function can run on this project (Node v24.21.0) while
// every endpoint re-exporting server.ts fails with FUNCTION_INVOCATION_FAILED.
// server.ts's only non-builtin imports are four packages, and all four load
// locally. This endpoint imports each one in isolation via dynamic import,
// which is catchable, so a single request reports which specific import kills
// the module at load.
//
// Dynamic imports with literal specifiers are still traced by Vercel's Node
// File Tracing, so the packages are present in the bundle.
export default async function handler(
  _req: unknown,
  res: { status: (n: number) => { json: (b: unknown) => void } }
) {
  const results: Record<string, string> = {};

  const packages = [
    'express',
    'dotenv',
    '@supabase/supabase-js',
    'livekit-server-sdk',
  ];

  for (const pkg of packages) {
    try {
      const mod = await import(pkg);
      const keys = Object.keys(mod ?? {});
      results[pkg] = `OK (exports: ${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', ...' : ''})`;
    } catch (err) {
      const e = err as Error & { code?: string };
      results[pkg] = `FAILED${e.code ? ` [${e.code}]` : ''}: ${e.message}`;
    }
  }

  // Builtin modules, as a control.
  for (const builtin of ['path', 'crypto']) {
    try {
      await import(builtin);
      results[builtin] = 'OK (builtin)';
    } catch (err) {
      results[builtin] = `FAILED: ${(err as Error).message}`;
    }
  }

  // A dynamic import of server.ts itself, caught, so we see its real error
  // rather than a bare FUNCTION_INVOCATION_FAILED with no stack.
  try {
    await import('../server');
    results['../server (no extension)'] = 'OK';
  } catch (err) {
    const e = err as Error & { code?: string };
    results['../server (no extension)'] = `FAILED${e.code ? ` [${e.code}]` : ''}: ${e.message}`;
  }

  for (const spec of ['../server.js', '../server.ts']) {
    try {
      await import(spec);
      results[spec] = 'OK - RESOLVES';
    } catch (err) {
      const e = err as Error & { code?: string };
      results[spec] = `FAILED${e.code ? ` [${e.code}]` : ''}: ${e.message}`;
    }
  }

  // Which files actually exist in the task directory? Decides whether the
  // compiled output is .js or .ts, and therefore which specifier is correct.
  try {
    const fs = await import('node:fs');
    results['fs /var/task listing'] = JSON.stringify(fs.readdirSync('/var/task').filter((f: string) => f.includes('server')));
  } catch (err) {
    results['fs /var/task listing'] = `FAILED: ${(err as Error).message}`;
  }

  res.status(200).json({
    node: process.version,
    results,
  });
}
