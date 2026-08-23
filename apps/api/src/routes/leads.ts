import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { authMiddleware } from '../auth/middleware';

const leads = new Hono<AppEnv>();

// Apply auth middleware to all routes in this module
leads.use('*', authMiddleware);

// ----------------------------------------------------------------
// GET /api/leads
// ----------------------------------------------------------------
leads.get('/', async (c) => {
  const role = c.get('role');
  const userId = c.get('userId');

  if (role === 'agent') {
    // Agents can only ever see their own leads.
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM leads WHERE assigned_user_id = ? ORDER BY created_at DESC'
    ).bind(userId).all();
    return c.json({ data: results });
  } 
  
  if (role === 'admin') {
    // Admins can filter by assigned_user_id or see all leads
    const assignedUserId = c.req.query('assigned_user_id');
    if (assignedUserId) {
      const { results } = await c.env.DB.prepare(
        'SELECT * FROM leads WHERE assigned_user_id = ? ORDER BY created_at DESC'
      ).bind(assignedUserId).all();
      return c.json({ data: results });
    } else {
      const { results } = await c.env.DB.prepare(
        'SELECT * FROM leads ORDER BY created_at DESC'
      ).all();
      return c.json({ data: results });
    }
  }

  return c.json({ data: [] });
});

// ----------------------------------------------------------------
// PATCH /api/leads/:id/status
// ----------------------------------------------------------------
const updateStatusSchema = z.object({
  status: z.enum(['pending', 'calling', 'completed', 'failed']),
});

leads.patch('/:id/status', zValidator('json', updateStatusSchema), async (c) => {
  const id = c.req.param('id');
  const { status } = c.req.valid('json');
  const role = c.get('role');
  const userId = c.get('userId');

  const lead = await c.env.DB.prepare(
    'SELECT assigned_user_id FROM leads WHERE id = ?'
  ).bind(id).first<{ assigned_user_id: string }>();

  // 404 if it truly doesn't exist
  if (!lead) {
    return c.json({ error: 'Lead not found' }, 404);
  }

  // Also 404 if the agent doesn't own it (don't leak existence)
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

export default leads;
