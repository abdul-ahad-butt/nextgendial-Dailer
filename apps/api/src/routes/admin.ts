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
  assigned_user_id: z.string().nullable(),
  file_name: z.string().min(1),
  leads: z.array(z.object({
    phone_number: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
  })).default([]),
});

admin.post('/upload-leads', zValidator('json', uploadLeadsSchema), async (c) => {
  const { assigned_user_id, file_name, leads } = c.req.valid('json');
  const requestingAdminId = c.get('userId');

  // Validate assigned_user_id
  if (assigned_user_id !== null && assigned_user_id !== requestingAdminId) {
    const agent = await c.env.DB.prepare(
      "SELECT id FROM users WHERE id = ? AND role = 'agent'"
    ).bind(assigned_user_id).first();

    if (!agent) {
      return c.json({ error: 'Assigned user must exist and be an agent, or be the current admin' }, 400);
    }
  }

  const batchId = crypto.randomUUID();
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
    // We will chunk the statements to avoid hitting D1 batch size limits.
    // D1 allows a maximum of 100 statements per batch() call historically, 
    // although newer limits may be higher.
    const CHUNK_SIZE = 100;
    
    // The first statement of the first chunk will be the batch creation
    const batchCreateStmt = c.env.DB.prepare(
      `INSERT INTO lead_batches (id, file_name, total_leads, assigned_user_id) VALUES (?, ?, ?, ?)`
    ).bind(batchId, file_name, validLeads.length, assigned_user_id);
    
    const leadInsertStmt = c.env.DB.prepare(
      `INSERT INTO leads (id, assigned_user_id, batch_id, phone_number, first_name, last_name, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    );

    const allLeadStmts = validLeads.map(l => 
      leadInsertStmt.bind(l.id, assigned_user_id, batchId, l.phone_number, l.first_name, l.last_name)
    );

    // Add the batch creation as the very first statement
    const allStmts = [batchCreateStmt, ...allLeadStmts];

    // Chunk into arrays of CHUNK_SIZE
    for (let i = 0; i < allStmts.length; i += CHUNK_SIZE) {
      const chunk = allStmts.slice(i, i + CHUNK_SIZE);
      await c.env.DB.batch(chunk);
    }
  } else {
    // If no valid leads, still create the empty batch to be consistent
    await c.env.DB.prepare(
      `INSERT INTO lead_batches (id, file_name, total_leads, assigned_user_id) VALUES (?, ?, 0, ?)`
    ).bind(batchId, file_name, assigned_user_id).run();
  }

  return c.json({
    batch_id: batchId,
    inserted: validLeads.length,
    skipped,
    errors
  });
});

admin.get('/batches', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT lb.id, lb.file_name, lb.total_leads, lb.uploaded_at, u.username as assigned_agent_username
     FROM lead_batches lb
     LEFT JOIN users u ON lb.assigned_user_id = u.id
     ORDER BY lb.uploaded_at DESC`
  ).all();

  return c.json({ data: results });
});

admin.delete('/batches/:id', async (c) => {
  const id = c.req.param('id');

  // Verify batch exists
  const batch = await c.env.DB.prepare('SELECT id FROM lead_batches WHERE id = ?').bind(id).first();
  if (!batch) {
    return c.json({ error: 'Batch not found' }, 404);
  }

  // Atomically delete leads then the batch
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM leads WHERE batch_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM lead_batches WHERE id = ?').bind(id)
  ]);

  // Optionally we could return how many leads were deleted if we counted them, 
  // but total_leads from the batch record is a good proxy.
  return c.json({ deleted_batch_id: id });
});

export default admin;
