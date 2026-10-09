/**
 * apps/api/src/routes/callbacks.ts
 *
 * Scheduled Callbacks Queue CRUD endpoints.
 * Empowers agents and admins to manage scheduled lead follow-ups.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { authMiddleware } from '../auth/middleware';
import { normalizeToE164 } from '../utils/phone';

const callbacks = new Hono<AppEnv>();

callbacks.use('*', authMiddleware);

// ----------------------------------------------------------------
// GET /callbacks — List callbacks with optional status/agent filter
// ----------------------------------------------------------------
callbacks.get('/', async (c) => {
  const { status, agent_id, due_only, limit = '50' } = c.req.query();
  const userId = c.get('userId');
  const role = c.get('role');
  let tenantId = c.get('tenantId');

  if (!tenantId) {
    const user = await c.env.DB.prepare('SELECT tenant_id FROM users WHERE id = ?')
      .bind(userId)
      .first<{ tenant_id: string | null }>();
    tenantId = user?.tenant_id || undefined;
  }

  const conditions: string[] = [];
  const params: any[] = [];

  if (tenantId && role !== 'super_admin') {
    conditions.push('cb.tenant_id = ?');
    params.push(tenantId);
  }

  // If role is agent, show their callbacks or unassigned callbacks
  if (role === 'agent') {
    conditions.push('(cb.assigned_agent_id = ? OR cb.assigned_agent_id IS NULL)');
    params.push(userId);
  } else if (agent_id) {
    conditions.push('cb.assigned_agent_id = ?');
    params.push(agent_id);
  }

  if (status) {
    conditions.push('cb.status = ?');
    params.push(status);
  } else {
    // Default to pending
    conditions.push("cb.status = 'pending'");
  }

  if (due_only === 'true') {
    conditions.push("datetime(cb.scheduled_time) <= datetime('now', '+5 minutes')");
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitNum = Math.min(parseInt(limit, 10) || 50, 100);

  const { results } = await c.env.DB.prepare(`
    SELECT 
      cb.id,
      cb.tenant_id,
      cb.lead_id,
      cb.phone_number,
      cb.contact_name,
      cb.scheduled_time,
      cb.assigned_agent_id,
      u.username as assigned_agent_name,
      cb.status,
      cb.notes,
      cb.created_at
    FROM callbacks cb
    LEFT JOIN users u ON cb.assigned_agent_id = u.id
    ${where}
    ORDER BY cb.scheduled_time ASC
    LIMIT ?
  `).bind(...params, limitNum).all();

  return c.json({ data: results || [] });
});

// ----------------------------------------------------------------
// POST /callbacks — Create new scheduled callback
// ----------------------------------------------------------------
const createCallbackSchema = z.object({
  lead_id: z.string().optional(),
  phone_number: z.string().min(1),
  contact_name: z.string().optional(),
  scheduled_time: z.string().min(1), // ISO format or datetime
  assigned_agent_id: z.string().optional(),
  notes: z.string().optional(),
});

callbacks.post('/', zValidator('json', createCallbackSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId');
  let tenantId = c.get('tenantId');

  if (!tenantId) {
    const user = await c.env.DB.prepare('SELECT tenant_id FROM users WHERE id = ?')
      .bind(userId)
      .first<{ tenant_id: string | null }>();
    tenantId = user?.tenant_id || undefined;
  }

  if (!tenantId) {
    // Emergency fallback to default organization if needed
    const defTenant = await c.env.DB.prepare('SELECT id FROM tenants LIMIT 1').first<{ id: string }>();
    tenantId = defTenant?.id || 'default_tenant';
  }

  const id = crypto.randomUUID();
  const normalizedPhone = normalizeToE164(body.phone_number);
  const assignedAgent = body.assigned_agent_id || userId;

  await c.env.DB.prepare(`
    INSERT INTO callbacks (id, tenant_id, lead_id, phone_number, contact_name, scheduled_time, assigned_agent_id, status, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))
  `).bind(
    id,
    tenantId,
    body.lead_id || null,
    normalizedPhone,
    body.contact_name || null,
    body.scheduled_time,
    assignedAgent,
    body.notes || null
  ).run();

  const created = await c.env.DB.prepare('SELECT * FROM callbacks WHERE id = ?').bind(id).first();
  return c.json({ success: true, data: created }, 201);
});

// ----------------------------------------------------------------
// PATCH /callbacks/:id — Update callback status or reschedule
// ----------------------------------------------------------------
const updateCallbackSchema = z.object({
  status: z.enum(['pending', 'completed', 'dismissed']).optional(),
  scheduled_time: z.string().optional(),
  notes: z.string().optional(),
});

callbacks.patch('/:id', zValidator('json', updateCallbackSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const updates: string[] = [];
  const values: any[] = [];

  if (body.status) {
    updates.push('status = ?');
    values.push(body.status);
  }
  if (body.scheduled_time) {
    updates.push('scheduled_time = ?');
    values.push(body.scheduled_time);
  }
  if (body.notes !== undefined) {
    updates.push('notes = ?');
    values.push(body.notes);
  }

  if (updates.length > 0) {
    values.push(id);
    await c.env.DB.prepare(`UPDATE callbacks SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  const updated = await c.env.DB.prepare('SELECT * FROM callbacks WHERE id = ?').bind(id).first();
  return c.json({ data: updated });
});

// ----------------------------------------------------------------
// DELETE /callbacks/:id — Delete a callback
// ----------------------------------------------------------------
callbacks.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM callbacks WHERE id = ?').bind(id).run();
  return c.json({ success: true, id });
});

export default callbacks;
