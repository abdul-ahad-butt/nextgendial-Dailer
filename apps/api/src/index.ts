/**
 * apps/api/src/index.ts
 *
 * Root Hono application. Mounts all route groups under /api
 * and exports the Workers fetch handler.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { AppEnv } from './types';

import authRoute from './routes/auth';
import adminRoute from './routes/admin';
import leadsRoute from './routes/leads';
import agentRoute from './routes/agent';
import agentsRoute from './routes/agents';
import callsRoute from './routes/calls';
import webhooksRoute from './routes/webhooks';
import { mockRoute } from './routes/mock';

const app = new Hono<AppEnv>();

// ----------------------------------------------------------------
// Global middleware
// ----------------------------------------------------------------

app.use('*', logger());

// CORS: allow origin *, specific methods and headers
app.use('/api/*', async (c, next) =>
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    credentials: true,
  })(c, next),
);

// ----------------------------------------------------------------
// Health check
// ----------------------------------------------------------------
app.get('/api/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }));

app.get('/api/seed', async (c) => {
  try {
    await c.env.DB.prepare(`
      INSERT INTO users (id, username, password_hash, role)
      VALUES ('33cf6fe7-3bb6-4193-a9af-1fb8c24e069e', 'admin', '12383669d69da5e6b15a6851909884f9:7560b2a5052327569445ae1d2e1681e6996563b7950d0789b6e5bed2b7a49f57', 'admin');
    `).run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
// ----------------------------------------------------------------
// Route groups
// ----------------------------------------------------------------
app.route('/api/auth', authRoute);
app.route('/api/admin', adminRoute);
app.route('/api/leads', leadsRoute);
app.route('/api/agent', agentRoute);
app.route('/api/agents', agentsRoute);
app.route('/api/calls', callsRoute);
app.route('/api/webhooks', webhooksRoute);

// Mock routes to prevent frontend crashes from legacy features
app.route('/api', mockRoute);

// ----------------------------------------------------------------
// Fallbacks
// ----------------------------------------------------------------
app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  console.error('[app]', err);
  return c.json({ error: err.message ?? 'Internal server error' }, 500);
});

export default app;
