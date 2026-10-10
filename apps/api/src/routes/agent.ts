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

agent.get('/me', async (c) => {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare(`
    SELECT u.id, u.username, u.role, u.tenant_id, u.assigned_phone_number,
           COALESCE(u.allocated_credits, 0.00) AS allocated_credits,
           COALESCE(u.spent_credits, 0.00) AS spent_credits,
           COALESCE(ast.status, 'offline') AS status
    FROM users u
    LEFT JOIN agent_status ast ON u.id = ast.user_id
    WHERE u.id = ?
  `).bind(userId).first<any>();

  if (!user) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const remaining = Math.max(0, (user.allocated_credits || 0) - (user.spent_credits || 0));

  return c.json({
    data: {
      ...user,
      remaining_credits: remaining,
    },
    agent: {
      ...user,
      remaining_credits: remaining,
    },
    ...user,
    remaining_credits: remaining,
  });
});

agent.get('/credits', async (c) => {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare(`
    SELECT id, tenant_id, 
           COALESCE(allocated_credits, 0.00) AS allocated_credits,
           COALESCE(spent_credits, 0.00) AS spent_credits
    FROM users WHERE id = ?
  `).bind(userId).first<{ id: string; tenant_id: string | null; allocated_credits: number; spent_credits: number }>();

  if (!user?.tenant_id) {
    return c.json({
      credits: 0,
      allocated: 0,
      spent: 0,
      remaining_balance: 0,
      data: { credits: 0, remaining_balance: 0, allocated_credits: 0, spent_credits: 0, is_active: true }
    });
  }

  const balance = await getTenantBalance(c.env.DB, user.tenant_id);
  const tenantRemaining = balance?.remaining_balance ?? 0;

  const agentAllocated = Number(user.allocated_credits ?? 0);
  const agentSpent = Number(user.spent_credits ?? 0);
  const agentRemaining = Math.max(0, Math.round((agentAllocated - agentSpent) * 1000) / 1000);

  // If organization out of credits, agent cannot dial.
  // Otherwise, agent's dialable balance is their individual budget (capped by organization balance).
  const effectiveCredits = tenantRemaining <= 0 ? 0 : Math.min(agentRemaining, tenantRemaining);

  return c.json({
    credits: effectiveCredits,
    allocated: agentAllocated,
    spent: agentSpent,
    remaining_balance: effectiveCredits,
    tenant_credits: tenantRemaining,
    data: {
      credits: effectiveCredits,
      remaining_balance: effectiveCredits,
      allocated_credits: agentAllocated,
      spent_credits: agentSpent,
      tenant_remaining_balance: tenantRemaining,
      is_active: Boolean(balance?.is_active ?? true),
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
