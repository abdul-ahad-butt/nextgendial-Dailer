import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { authMiddleware } from '../auth/middleware';
import { normalizeToE164, isValidE164 } from '../utils/phone';

const leads = new Hono<AppEnv>();

// Apply auth middleware to all routes in this module
leads.use('*', authMiddleware);

// ----------------------------------------------------------------
// GET /api/leads
// ----------------------------------------------------------------
leads.get('/', async (c) => {
  const role = c.get('role');
  const userId = c.get('userId');
  let tenantId = c.get('tenantId');

  if (!tenantId) {
    const user = await c.env.DB.prepare('SELECT tenant_id FROM users WHERE id = ?')
      .bind(userId)
      .first<{ tenant_id: string | null }>();
    tenantId = user?.tenant_id || undefined;
  }

  if (role === 'agent') {
    // Agents can only ever see their own leads.
    const status = c.req.query('status');
    if (status) {
      const statuses = status.split(',');
      const placeholders = statuses.map(() => '?').join(',');
      const { results } = await c.env.DB.prepare(
        `SELECT * FROM leads WHERE assigned_user_id = ? AND status IN (${placeholders}) ORDER BY created_at DESC`
      ).bind(userId, ...statuses).all();
      return c.json({ data: results || [] });
    }
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM leads WHERE assigned_user_id = ? ORDER BY created_at DESC'
    ).bind(userId).all();
    return c.json({ data: results || [] });
  } 
  
  if (role === 'admin') {
    // Admins see leads belonging to their tenant organization
    const assignedUserId = c.req.query('assigned_user_id');
    const conditions: string[] = [];
    const params: any[] = [];

    if (tenantId) {
      conditions.push('tenant_id = ?');
      params.push(tenantId);
    }

    if (assignedUserId) {
      conditions.push('assigned_user_id = ?');
      params.push(assignedUserId);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM leads ${where} ORDER BY created_at DESC`
    ).bind(...params).all();

    return c.json({ data: results || [] });
  }

  if (role === 'super_admin') {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM leads ORDER BY created_at DESC LIMIT 200'
    ).all();
    return c.json({ data: results || [] });
  }

  return c.json({ data: [] });
});

// ----------------------------------------------------------------
// PATCH /api/leads/:id/status
// ----------------------------------------------------------------
const updateStatusSchema = z.object({
  status: z.enum(['pending', 'calling', 'completed', 'failed', 'contacted', 'dnc']),
});

leads.patch('/:id/status', zValidator('json', updateStatusSchema), async (c) => {
  const id = c.req.param('id');
  const { status } = c.req.valid('json');
  const role = c.get('role');
  const userId = c.get('userId');

  const lead = await c.env.DB.prepare(
    'SELECT assigned_user_id, tenant_id FROM leads WHERE id = ?'
  ).bind(id).first<{ assigned_user_id: string; tenant_id: string }>();

  if (!lead) {
    return c.json({ error: 'Lead not found' }, 404);
  }

  if (role === 'agent' && lead.assigned_user_id !== userId) {
    return c.json({ error: 'Lead not found' }, 404); 
  }

  // Update status and updated_at
  await c.env.DB.prepare(
    "UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(status, id).run();

  const updated = await c.env.DB.prepare(
    'SELECT * FROM leads WHERE id = ?'
  ).bind(id).first();

  return c.json({ data: updated });
});

// ----------------------------------------------------------------
// POST /api/leads — Create single lead with E.164 normalization
// ----------------------------------------------------------------
const createLeadSchema = z.object({
  phone_number: z.string().min(1),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  assigned_user_id: z.string().optional(),
});

leads.post('/', zValidator('json', createLeadSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId');
  let tenantId = c.get('tenantId');

  if (!tenantId) {
    const user = await c.env.DB.prepare('SELECT tenant_id FROM users WHERE id = ?')
      .bind(userId)
      .first<{ tenant_id: string | null }>();
    tenantId = user?.tenant_id || undefined;
  }

  const normalizedPhone = normalizeToE164(body.phone_number);
  if (!isValidE164(normalizedPhone)) {
    return c.json({ error: `Invalid telephone number format: ${body.phone_number}` }, 400);
  }

  const leadId = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO leads (id, tenant_id, assigned_user_id, phone_number, first_name, last_name, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
  `).bind(
    leadId,
    tenantId || null,
    body.assigned_user_id || userId,
    normalizedPhone,
    body.first_name || null,
    body.last_name || null
  ).run();

  const created = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first();
  return c.json({ data: created }, 201);
});

export default leads;
