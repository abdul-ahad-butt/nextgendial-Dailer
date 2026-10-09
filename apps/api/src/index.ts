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
import superAdminRoute from './routes/superAdmin';
import adminRoute from './routes/admin';
import leadsRoute from './routes/leads';
import agentRoute from './routes/agent';
import agentsRoute from './routes/agents';
import callsRoute from './routes/calls';
import callbacksRoute from './routes/callbacks';
import messagesRoute from './routes/messages';
import webhooksRoute from './routes/webhooks';
import recordingsRoute from './routes/recordings';
import { mockRoute } from './routes/mock';
import { hashPassword } from './auth/crypto';

const app = new Hono<AppEnv>();

// ----------------------------------------------------------------
// Global middleware
// ----------------------------------------------------------------

app.use('*', logger());

// Robust CORS: Allow any origin (credentials true, all methods)
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || '*';
  const corsMiddleware = cors({
    origin: (orig) => orig || origin,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Requested-With'],
    exposeHeaders: ['Content-Length', 'X-Kuma-Revision'],
    credentials: true,
    maxAge: 86400,
  });
  return corsMiddleware(c, next);
});

// Self-healing schema guard & default seeding
let schemaInitialized = false;
async function ensureSchema(db: D1Database) {
  if (schemaInitialized) return;
  try {
    await db.batch([
      // 1. Tenants
      db.prepare(`
        CREATE TABLE IF NOT EXISTS tenants (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          admin_username TEXT UNIQUE NOT NULL,
          admin_password_hash TEXT NOT NULL,
          allocated_credits REAL DEFAULT 0.00,
          spent_credits REAL DEFAULT 0.00,
          max_agents INTEGER DEFAULT 5,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `),
      // 2. Super Admins
      db.prepare(`
        CREATE TABLE IF NOT EXISTS super_admins (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `),
      // 3. Phone Inventory
      db.prepare(`
        CREATE TABLE IF NOT EXISTS phone_inventory (
          phone_number TEXT PRIMARY KEY,
          friendly_name TEXT,
          telnyx_id TEXT,
          assigned_tenant_id TEXT REFERENCES tenants(id),
          assigned_agent_id TEXT REFERENCES agents(id),
          status TEXT DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `),
      // 4. Credit Ledger
      db.prepare(`
        CREATE TABLE IF NOT EXISTS credit_ledger (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id),
          amount REAL NOT NULL,
          type TEXT NOT NULL,
          reference_id TEXT,
          balance_after REAL NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `),
      // 5. Messages
      db.prepare(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id),
          from_number TEXT NOT NULL,
          to_number TEXT NOT NULL,
          direction TEXT NOT NULL,
          body TEXT NOT NULL,
          status TEXT DEFAULT 'received',
          agent_id TEXT REFERENCES agents(id),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `),
      // 6. Callbacks
      db.prepare(`
        CREATE TABLE IF NOT EXISTS callbacks (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id),
          lead_id TEXT,
          phone_number TEXT NOT NULL,
          contact_name TEXT,
          scheduled_time DATETIME NOT NULL,
          assigned_agent_id TEXT REFERENCES agents(id),
          status TEXT DEFAULT 'pending',
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `),
    ]);

    // Add tenant_id columns to existing tables safely
    try { await db.prepare('ALTER TABLE users ADD COLUMN tenant_id TEXT;').run(); } catch {}
    try { await db.prepare('ALTER TABLE agents ADD COLUMN tenant_id TEXT;').run(); } catch {}
    try { await db.prepare('ALTER TABLE leads ADD COLUMN tenant_id TEXT;').run(); } catch {}
    try { await db.prepare('ALTER TABLE lead_batches ADD COLUMN tenant_id TEXT;').run(); } catch {}
    try { await db.prepare('ALTER TABLE call_logs ADD COLUMN tenant_id TEXT;').run(); } catch {}

    // Seed default Super Admin if none exists
    const superAdmin = await db.prepare('SELECT id FROM super_admins LIMIT 1').first();
    if (!superAdmin) {
      const superHash = await hashPassword('superadmin123');
      await db.prepare(
        'INSERT OR IGNORE INTO super_admins (id, username, password_hash) VALUES (?, ?, ?)'
      ).bind(crypto.randomUUID(), 'superadmin', superHash).run();
    }

    // Seed default tenant and link existing admin
    const defaultTenant = await db.prepare('SELECT id FROM tenants LIMIT 1').first<{ id: string }>();
    let tenantId = defaultTenant?.id;
    if (!defaultTenant) {
      tenantId = 'default_tenant';
      const adminPassHash = await hashPassword('admin123');
      await db.prepare(`
        INSERT INTO tenants (id, name, admin_username, admin_password_hash, allocated_credits, spent_credits, max_agents, is_active)
        VALUES (?, 'Default Organization', 'admin', ?, 50.00, 0.00, 10, 1)
      `).bind(tenantId, adminPassHash).run();

      // Log initial credit grant
      await db.prepare(`
        INSERT INTO credit_ledger (id, tenant_id, amount, type, reference_id, balance_after)
        VALUES (?, ?, 50.00, 'SUPER_ADMIN_GRANT', 'SEED_INIT', 50.00)
      `).bind(crypto.randomUUID(), tenantId).run();
    }

    // Assign default phone number to inventory
    await db.prepare(`
      INSERT INTO phone_inventory (phone_number, friendly_name, assigned_tenant_id, status)
      VALUES ('+19564461280', 'Main Outbound Line', ?, 'active')
      ON CONFLICT(phone_number) DO UPDATE SET assigned_tenant_id = COALESCE(assigned_tenant_id, excluded.assigned_tenant_id)
    `).bind(tenantId).run();

    // Link users without tenant to default tenant
    if (tenantId) {
      await db.prepare('UPDATE users SET tenant_id = ? WHERE tenant_id IS NULL').bind(tenantId).run();
      await db.prepare('UPDATE agents SET tenant_id = ? WHERE tenant_id IS NULL').bind(tenantId).run();
      await db.prepare('UPDATE leads SET tenant_id = ? WHERE tenant_id IS NULL').bind(tenantId).run();
      await db.prepare('UPDATE call_logs SET tenant_id = ? WHERE tenant_id IS NULL').bind(tenantId).run();
    }

    schemaInitialized = true;
  } catch (err: any) {
    console.error('[schema_init] Non-fatal initialization error:', err.message);
  }
}

app.use('/api/*', async (c, next) => {
  await ensureSchema(c.env.DB);
  return next();
});

// ----------------------------------------------------------------
// Health check & Seeding
// ----------------------------------------------------------------
app.get('/api/health', (c) => c.json({ status: 'ok', enterprise: true, ts: new Date().toISOString() }));

app.get('/api/seed', async (c) => {
  try {
    schemaInitialized = false;
    await ensureSchema(c.env.DB);
    return c.json({ success: true, message: 'Database initialized with enterprise multi-tenant schema.' });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ----------------------------------------------------------------
// Route groups
// ----------------------------------------------------------------
app.route('/api/auth', authRoute);
app.route('/api/super', superAdminRoute);
app.route('/api/admin', adminRoute);
app.route('/api/leads', leadsRoute);
app.route('/api/agent', agentRoute);
app.route('/api/agents', agentsRoute);
app.route('/api/calls', callsRoute);
app.route('/api/callbacks', callbacksRoute);
app.route('/api/messages', messagesRoute);
app.route('/api/webhooks', webhooksRoute);
app.route('/api/recordings', recordingsRoute);

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
