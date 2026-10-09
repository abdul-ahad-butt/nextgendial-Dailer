import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { authMiddleware } from '../auth/middleware';
import { tryDialNextLead } from '../dialer/engine';
import { getTenantBalance } from '../services/creditEngine';

const agent = new Hono<AppEnv>();

// Require authentication for all agent routes
agent.use('*', authMiddleware);

agent.get('/caller-id', async (c) => {
  const userId = c.get('userId');
  
  const user = await c.env.DB.prepare('SELECT assigned_phone_number, tenant_id FROM users WHERE id = ?')
    .bind(userId)
    .first<{ assigned_phone_number: string | null; tenant_id: string | null }>();

  let callerId = user?.assigned_phone_number || null;

  // Fallback to tenant's assigned phone number if agent has no dedicated number
  if (!callerId && user?.tenant_id) {
    const tenantNum = await c.env.DB.prepare(
      'SELECT phone_number FROM phone_inventory WHERE assigned_tenant_id = ? LIMIT 1'
    ).bind(user.tenant_id).first<{ phone_number: string }>();
    callerId = tenantNum?.phone_number || null;
  }

  // Fallback to default number if none found
  if (!callerId) {
    callerId = c.env.TELNYX_DEFAULT_NUMBER || '+19564461280';
  }

  return c.json({ callerId });
});

agent.get('/credits', async (c) => {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare('SELECT tenant_id FROM users WHERE id = ?')
    .bind(userId)
    .first<{ tenant_id: string | null }>();

  if (!user?.tenant_id) {
    return c.json({ data: { remaining_balance: 10.0, is_active: true } });
  }

  const balance = await getTenantBalance(c.env.DB, user.tenant_id);
  return c.json({
    data: {
      remaining_balance: balance?.remaining_balance ?? 0,
      allocated_credits: balance?.allocated_credits ?? 0,
      spent_credits: balance?.spent_credits ?? 0,
      is_active: balance?.is_active ?? true,
    },
  });
});

agent.get('/status', async (c) => {
  const userId = c.get('userId');
  
  const row = await c.env.DB.prepare('SELECT status, changed_at FROM agent_status WHERE user_id = ?')
    .bind(userId)
    .first();

  if (!row) {
    return c.json({ status: 'offline', changed_at: new Date().toISOString() });
  }

  return c.json(row);
});

const statusSchema = z.object({
  status: z.enum(['available', 'break', 'offline'])
});

agent.patch('/status', zValidator('json', statusSchema), async (c) => {
  const userId = c.get('userId');
  const { status } = c.req.valid('json');

  await c.env.DB.prepare(`
    INSERT INTO agent_status (user_id, status)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET 
      status = excluded.status,
      changed_at = datetime('now')
  `)
  .bind(userId, status)
  .run();
  
  if (status === 'available') {
    c.executionCtx.waitUntil(tryDialNextLead(c.env, userId));
  }

  return c.json({ success: true, status });
});

export default agent;
