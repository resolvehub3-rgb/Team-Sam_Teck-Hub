// Vercel serverless entry point.
//
// `server.ts` holds the whole API surface as an Express app. Vercel's Node
// runtime accepts an Express app directly as a request handler — an app is
// just `(req, res) => void` — so this file only has to re-export it.
//
// Two things are deliberately NOT done here:
//
//   * No `app.listen()`. A serverless runtime invokes the handler per request
//     and has no port to bind. `server.ts` guards that call behind a
//     `process.env.VERCEL` check so importing it here stays side-effect free.
//   * No static file serving. The Vite build output is served by Vercel's CDN
//     from `dist/`, configured in vercel.json. Handing both jobs to the
//     function would push every asset request through a cold-starting lambda.
//
// The `/api/*` rewrite in vercel.json routes API traffic here; everything else
// falls through to the static build.
// The `.js` extension is required, not cosmetic. Vercel runs this project as
// native ESM (package.json declares "type": "module") and emits server.ts to
// server.js. ESM performs no extension resolution, so the extensionless form
// `../server` asks the loader for a file literally named "server" and fails
// with ERR_MODULE_NOT_FOUND at module load. That single unresolved import took
// down every endpoint re-exporting this app, surfacing as a bare
// FUNCTION_INVOCATION_FAILED with no stack.
import app from '../server.js';

export default app;
