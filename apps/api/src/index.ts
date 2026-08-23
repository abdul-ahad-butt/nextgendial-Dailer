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
    allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
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
app.route('/api/auth', authRoute);
app.route('/api/admin', adminRoute);
app.route('/api/leads', leadsRoute);
app.route('/api/agent', agentRoute);
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
