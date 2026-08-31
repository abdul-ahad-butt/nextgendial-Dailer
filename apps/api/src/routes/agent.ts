import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { authMiddleware } from '../auth/middleware';

const agent = new Hono<AppEnv>();

// Require authentication for all agent routes
agent.use('*', authMiddleware);

agent.get('/caller-id', async (c) => {
  const userId = c.get('userId');
  
  const user = await c.env.DB.prepare('SELECT assigned_phone_number FROM users WHERE id = ?')
    .bind(userId)
    .first<{ assigned_phone_number: string | null }>();

  // Return null if no number is assigned — frontend uses this to gate dialing
  const callerId = user?.assigned_phone_number || null;

  return c.json({ callerId });
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

import { tryDialNextLead } from '../dialer/engine';

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
