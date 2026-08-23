import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { authMiddleware, requireRole } from '../auth/middleware';
import { hashPassword } from '../auth/crypto';

const admin = new Hono<AppEnv>();

// Apply auth + requireRole('admin') to all routes in this module
admin.use('*', authMiddleware);
admin.use('*', requireRole('admin'));

const createUserSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

admin.post('/users', zValidator('json', createUserSchema), async (c) => {
  const { username, password } = c.req.valid('json');

  // Reject if username already exists
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(username)
    .first();

  if (existing) {
    return c.json({ error: 'Username already exists' }, 409);
  }

  // Hash password, insert as 'agent'
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const role = 'agent';

  await c.env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)'
  )
    .bind(id, username, passwordHash, role)
    .run();

  // Return the created user (omitting password_hash)
  const createdUser = await c.env.DB.prepare(
    'SELECT id, username, role, created_at FROM users WHERE id = ?'
  )
    .bind(id)
    .first();

  return c.json({ data: createdUser }, 201);
});

admin.get('/users', async (c) => {
  // Return all users with role='agent' ordered by created_at DESC
  const { results } = await c.env.DB.prepare(
    `SELECT id, username, created_at 
     FROM users 
     WHERE role = 'agent' 
     ORDER BY created_at DESC`
  ).all();

  return c.json({ data: results });
});

const uploadLeadsSchema = z.object({
  assigned_user_id: z.string().min(1),
  leads: z.array(z.object({
    phone_number: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
  })).default([]),
});

admin.post('/upload-leads', zValidator('json', uploadLeadsSchema), async (c) => {
  const { assigned_user_id, leads } = c.req.valid('json');

  // Validate agent exists and has role='agent'
  const agent = await c.env.DB.prepare(
    "SELECT id FROM users WHERE id = ? AND role = 'agent'"
  ).bind(assigned_user_id).first();

  if (!agent) {
    return c.json({ error: 'Assigned user must exist and be an agent' }, 400);
  }

  const validLeads = [];
  const errors = [];
  let skipped = 0;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]!;
    const phone = lead.phone_number?.trim();
    
    if (!phone) {
      skipped++;
      errors.push(`Row ${i + 1}: Missing or empty phone_number`);
      continue;
    }
    
    validLeads.push({
      id: crypto.randomUUID(),
      phone_number: phone,
      first_name: lead.first_name || null,
      last_name: lead.last_name || null,
    });
  }

  if (validLeads.length > 0) {
    const stmt = c.env.DB.prepare(
      `INSERT INTO leads (id, assigned_user_id, phone_number, first_name, last_name, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    );

    const batchStmts = validLeads.map(l => 
      stmt.bind(l.id, assigned_user_id, l.phone_number, l.first_name, l.last_name)
    );

    await c.env.DB.batch(batchStmts);
  }

  return c.json({
    inserted: validLeads.length,
    skipped,
    errors
  });
});

export default admin;
