// Local development entry point.
//
// Vite is mounted as Express *middleware* here rather than run as a separate
// dev server, so the browser talks to one origin and /api/* routes resolve
// exactly as they do in production.
//
// This lives in its own file deliberately. `server.ts` is imported by the
// Vercel serverless entry (api/index.ts), and any mention of `vite` in it -
// even a dynamic import inside an unused branch - is statically analysable,
// so bundlers pull the whole build tool into the serverless function. Keeping
// the reference here means the deployed API bundle never contains Vite.
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import app from './server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

async function startDevServer() {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);

  app.listen(PORT, 'localhost', () => {
    console.log(`[Sam_Teck Hub] Dev server active on http://localhost:${PORT}`);
    console.log('[Sam_Teck Hub] Vite middleware mounted; HMR enabled.');
  });
}

startDevServer().catch((err: unknown) => {
  console.error('[Sam_Teck Hub] Failed to start dev server:', err);
  process.exit(1);
});
