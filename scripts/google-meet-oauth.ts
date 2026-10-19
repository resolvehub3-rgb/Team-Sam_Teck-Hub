/**
 * google-meet-oauth.ts — one-time local helper to obtain a Google refresh
 * token for the Google Meet REST API.
 *
 * WHY THIS EXISTS
 *
 * The Meet REST API refuses API keys outright. Its own servers answer with:
 *
 *   401 UNAUTHENTICATED "API keys are not supported by this API. Expected
 *   OAuth2 access token or other authentication credentials that assert a
 *   principal."
 *
 * and Google's guide states "For Meet REST API, you can only authenticate
 * using user authentication." So Sam_Teck Hub needs a refresh token minted by
 * an authorised Google Workspace account, and that token is the one piece of
 * the integration you have to produce by hand.
 *
 * WHAT IT DOES
 *
 *   1. Opens the Google consent screen for scope `meetings.space.created`.
 *   2. Listens on a loopback port for Google's redirect.
 *   3. Verifies the OAuth `state`, then exchanges the code for tokens.
 *   4. Prints the refresh token for you to paste into `.env`.
 *
 * Run it locally, once:
 *
 *   pnpm google-meet:oauth
 *
 * PREREQUISITES (Google Cloud console)
 *
 *   - The "Google Meet API" is ENABLED on the project.
 *   - The OAuth consent screen is configured, and your Google account is
 *     listed as a **test user** (the `meetings.space.created` scope is
 *     SENSITIVE, so an unverified app can only authorise test users).
 *   - The client in `.env` is type **Desktop app**, which accepts loopback
 *     redirects automatically. For a "Web application" client you must add
 *     `http://localhost:<port>` to its Authorised redirect URIs first; the
 *     script prints the exact URI it will use.
 *
 * SAFETY
 *
 *   - The client secret is read from `.env` and is never printed.
 *   - The refresh token is printed to your terminal ONLY. Nothing is written
 *     to disk, logged or committed. Paste it into `.env` yourself.
 *   - The listener binds to 127.0.0.1 and closes as soon as it has a result.
 */
import 'dotenv/config';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/meetings.space.created';

const clientId = process.env.GOOGLE_MEET_CLIENT_ID || '';
const clientSecret = process.env.GOOGLE_MEET_CLIENT_SECRET || '';

if (!clientId || !clientSecret) {
  console.error(
    'GOOGLE_MEET_CLIENT_ID and GOOGLE_MEET_CLIENT_SECRET must be set in .env before running this helper.'
  );
  process.exit(2);
}

/** Shape of Google's token endpoint response. */
interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

// Loopback redirect. Fixed by default so it can be allow-listed, and
// overridable with --port if something else already holds it.
const portArg = process.argv.indexOf('--port');
const PORT = portArg !== -1 ? Number(process.argv[portArg + 1]) : 53682;

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  console.error('--port must be an integer between 1024 and 65535.');
  process.exit(2);
}

const redirectUri = `http://localhost:${PORT}`;

/** Best effort: hand the URL to the OS default browser, without new deps. */
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];

  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {
      /* no default handler; the URL is already printed */
    });
    child.unref();
  } catch {
    /* ignore */
  }
}

/** Exchange the authorisation code for a refresh token. */
async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  return (await res.json().catch(() => ({}))) as TokenResponse;
}

/**
 * Ask Google to validate the consent URL *before* we start waiting for a
 * callback.
 *
 * When the redirect URI is not registered, Google renders an error page and
 * never contacts localhost at all — so without this check the script hangs for
 * the full timeout and reports nothing useful, which is exactly how it
 * presented the redirect_uri_mismatch failure. Detecting it up front costs one
 * request and turns a silent hang into an instruction the user can act on.
 *
 * A network failure here is not fatal: the flow still works offline-ish and
 * the browser will show whatever Google says.
 */
async function preflightCheck(authUrl: string): Promise<void> {
  let body = '';
  try {
    const res = await fetch(authUrl, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    body = await res.text();
  } catch {
    return;
  }

  if (body.includes('redirect_uri_mismatch')) {
    console.error('\nGoogle rejected the redirect URI before we ever waited on it.');
    console.error(`\n  ${redirectUri} is NOT registered on OAuth client:\n  ${clientId}\n`);
    console.error('Fix one of these in Google Cloud console -> APIs & Services -> Credentials:');
    console.error('  a) Open the client and ADD the URI above to "Authorised redirect URIs"'); 
    console.error('     (required when the client type is "Web application"), or');
    console.error('  b) Create a NEW credential of type "Desktop app" and put its client id');
    console.error('     and secret into .env - desktop clients accept loopback automatically.');
    console.error('\nThen re-run: pnpm google-meet:oauth');
    process.exit(1);
  }

  if (body.includes('invalid_client')) {
    console.error('\nGoogle reports invalid_client: the client id in .env is not recognised,');
    console.error('or the Google Meet API is not enabled for its project.');
    console.error('\nThen re-run: pnpm google-meet:oauth');
    process.exit(1);
  }

  if (body.includes('admin_policy_enforced') || body.includes('access_blocked')) {
    console.error('\nGoogle is blocking this client (admin policy or unverified app).');
    console.error('Add your account as a Test user on the OAuth consent screen, and make sure');
    console.error(`the scope ${SCOPE} is listed under Scopes.`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // Random state, verified on the callback, so a stray request to our local
  // listener cannot be used to inject someone else's authorisation code.
  const state = crypto.randomBytes(16).toString('hex');

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  // `offline` is what produces a refresh token at all; `consent` forces Google
  // to issue one every time, which is what a re-run needs.
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  // Validate first: a bad redirect URI or missing scope is reported instantly
  // instead of burning the full callback timeout with nothing to show for it.
  await preflightCheck(authUrl.toString());

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', redirectUri);

    if (url.pathname === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }

    const oauthError = url.searchParams.get('error');
    if (oauthError) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<h3>Authorisation refused</h3><p>Google returned <code>${oauthError}</code>. You can close this tab.</p>`
      );
      console.error(`\nGoogle refused: ${oauthError}`);
      server.close();
      process.exit(1);
    }

    const code = url.searchParams.get('code');
    const gotState = url.searchParams.get('state');

    if (!code || gotState !== state) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h3>Unexpected request</h3><p>Missing code, or state mismatch. Close this tab.</p>');
      console.error('\nCallback rejected: missing code, or state did not match.');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h3>Authorised</h3><p>You can close this tab and return to the terminal.</p>');

    void (async () => {
      const tokens = await exchangeCode(code);
      server.close();

      if (tokens.error) {
        console.error(`\nToken exchange failed: ${tokens.error_description || tokens.error}`);
        process.exit(1);
      }

      if (!tokens.refresh_token) {
        console.error(
          '\nGoogle returned no refresh token. This happens when a grant already exists; revoke it at\n' +
            'https://myaccount.google.com/permissions and run this helper again.'
        );
        process.exit(1);
      }

      console.log('\n------------------------------------------------------------------');
      console.log('Refresh token obtained. Add this line to your .env file:');
      console.log('------------------------------------------------------------------');
      console.log(`GOOGLE_MEET_REFRESH_TOKEN="${tokens.refresh_token}"`);
      console.log('------------------------------------------------------------------');
      console.log(`Granted scope: ${tokens.scope || 'unknown'}`);

      if (tokens.scope && !tokens.scope.includes('meetings.space.created')) {
        console.warn(
          'WARNING: the granted scope does NOT include meetings.space.created. Space creation will still fail.'
        );
      }

      console.log(
        '\nKeep this token out of Git and out of any VITE_ variable, then restart the dev server.'
      );
    })();
  });

  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      console.error(
        `Port ${PORT} is already in use. Re-run with --port <other> and allow-list that redirect URI.`
      );
    } else {
      console.error(`Could not start the local listener: ${e.message}`);
    }
    process.exit(1);
  });

  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));

  console.log('\nGoogle Meet OAuth — one-time authorisation\n');
  console.log(`Redirect URI in use: ${redirectUri}`);
  console.log('If your OAuth client is type "Web application", add the URI above to its');
  console.log('Authorised redirect URIs before continuing.\n');
  console.log('Opening the consent screen. If no browser opened, visit:\n');
  console.log(authUrl.toString());

  openBrowser(authUrl.toString());

  console.log('\nWaiting for the redirect. Press Ctrl+C to cancel.');

  setTimeout(() => {
    console.error('\nTimed out after 5 minutes without a callback.');
    server.close();
    process.exit(1);
  }, 5 * 60 * 1000).unref();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
