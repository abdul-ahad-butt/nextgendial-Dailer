/**
 * apps/api/src/index.ts
 *
 * Root Hono application. Mounts all route groups under /api
 * and exports the Workers fetch handler.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types';

import agentsRoute from './routes/agents';
import campaignsRoute from './routes/campaigns';
import leadsRoute from './routes/leads';
import callsRoute from './routes/calls';
import webhooksRoute from './routes/webhooks';

const app = new Hono<{ Bindings: Env }>();

// ----------------------------------------------------------------
// Global middleware
// ----------------------------------------------------------------

app.use('*', logger());

// CORS: allow the frontend origin configured in environment variables
app.use('/api/*', async (c, next) =>
  cors({
    origin: c.env.ALLOWED_ORIGIN,
    credentials: true,
  })(c, next),
);

// ----------------------------------------------------------------
// Health check
// ----------------------------------------------------------------
app.get('/api/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }));

// ----------------------------------------------------------------
// Route groups
// ----------------------------------------------------------------
app.route('/api/agents', agentsRoute);
app.route('/api/campaigns', campaignsRoute);
app.route('/api/leads', leadsRoute);
app.route('/api/calls', callsRoute);
app.route('/api/webhooks', webhooksRoute);

// ----------------------------------------------------------------
// 404 fallback
// ----------------------------------------------------------------
app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  console.error('[app]', err);
  return c.json({ error: err.message ?? 'Internal server error' }, 500);
});

export default app;
