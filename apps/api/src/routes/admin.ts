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

admin.post('/agents', zValidator('json', createUserSchema), async (c) => {
  const { username, password } = c.req.valid('json');
  const trimmedUsername = username.trim();
  const trimmedPassword = password.trim();

  // Reject if username already exists (case-insensitive check is better here too)
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)')
    .bind(trimmedUsername)
    .first();

  if (existing) {
    return c.json({ error: 'Username already exists' }, 409);
  }

  // Hash password, insert as 'agent'
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(trimmedPassword);
  const role = 'agent';
  const sipUsername = `agent_${id.replace(/-/g, '')}`;

  // Self-Healing Schema Guard for new columns
  try {
    await c.env.DB.prepare("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'offline';").run();
  } catch (e) {}
  try {
    await c.env.DB.prepare("ALTER TABLE users ADD COLUMN telnyx_credential_id TEXT;").run();
  } catch (e) {}
  try {
    await c.env.DB.prepare("ALTER TABLE users ADD COLUMN telnyx_sip_username TEXT;").run();
  } catch (e) {}

  // Create Telephony Credential on Telnyx
  let telnyxCredentialId = null;
  if (c.env.TELNYX_API_KEY && c.env.TELNYX_CONNECTION_ID) {
    try {
      const telnyxRes = await fetch('https://api.telnyx.com/v2/telephony_credentials', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          connection_id: c.env.TELNYX_CONNECTION_ID,
          sip_username: sipUsername,
          sip_password: crypto.randomUUID().slice(0, 16) + 'Aa1!' // Requires complexity
        })
      });
      
      if (telnyxRes.ok) {
        const telnyxData = await telnyxRes.json() as any;
        telnyxCredentialId = telnyxData.data.id;
      } else {
        console.error('[telnyx] failed to create telephony credential:', await telnyxRes.text());
      }
    } catch (e) {
      console.error('[telnyx] error creating telephony credential:', e);
    }
  }

  await c.env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, role, telnyx_credential_id, telnyx_sip_username, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, trimmedUsername, passwordHash, role, telnyxCredentialId, sipUsername, 'offline')
    .run();

  // Return the created user (omitting password_hash)
  const createdUser = await c.env.DB.prepare(
    'SELECT id, username, role, created_at, status, telnyx_credential_id, telnyx_sip_username FROM users WHERE id = ?'
  )
    .bind(id)
    .first();

  return c.json({ data: createdUser }, 201);
});

admin.get('/agents', async (c) => {
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
  assignment_mode: z.enum(['assigned', 'pool']).default('assigned'),
});

admin.post('/leads/upload', zValidator('json', uploadLeadsSchema), async (c) => {
  const { assigned_user_id, file_name, leads, assignment_mode } = c.req.valid('json');
  const requestingAdminId = c.get('userId');

  // Auto-Initialization Safeguard
  await c.env.DB.batch([
    c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS lead_batches (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        total_leads INTEGER NOT NULL DEFAULT 0,
        assigned_user_id TEXT REFERENCES users(id),
        uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
        assignment_mode TEXT NOT NULL DEFAULT 'assigned' CHECK (assignment_mode IN ('assigned', 'pool'))
      )
    `)
  ]);

  try {
    await c.env.DB.prepare("ALTER TABLE leads ADD COLUMN batch_id TEXT REFERENCES lead_batches(id);").run();
  } catch (e) {
    // Column already exists
  }

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
      `INSERT INTO lead_batches (id, file_name, total_leads, assigned_user_id, assignment_mode) VALUES (?, ?, ?, ?, ?)`
    ).bind(batchId, file_name, validLeads.length, assigned_user_id, assignment_mode);
    
    const leadInsertStmt = c.env.DB.prepare(
      `INSERT OR IGNORE INTO leads (id, assigned_user_id, batch_id, phone_number, first_name, last_name, status)
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
      `INSERT INTO lead_batches (id, file_name, total_leads, assigned_user_id, assignment_mode) VALUES (?, ?, 0, ?, ?)`
    ).bind(batchId, file_name, assigned_user_id, assignment_mode).run();
  }

  return c.json({
    batch_id: batchId,
    inserted: validLeads.length,
    skipped,
    errors
  });
});

admin.get('/leads/batches', async (c) => {
  // Auto-Initialization Safeguard
  await c.env.DB.batch([
    c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS lead_batches (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        total_leads INTEGER NOT NULL DEFAULT 0,
        assigned_user_id TEXT REFERENCES users(id),
        uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
        assignment_mode TEXT NOT NULL DEFAULT 'assigned' CHECK (assignment_mode IN ('assigned', 'pool'))
      )
    `)
  ]);

  try {
    await c.env.DB.prepare("ALTER TABLE leads ADD COLUMN batch_id TEXT REFERENCES lead_batches(id);").run();
  } catch (e) {
    // Column already exists
  }

  const { results } = await c.env.DB.prepare(
    `SELECT 
       lb.id, 
       lb.file_name, 
       lb.total_leads, 
       lb.uploaded_at, 
       lb.assignment_mode,
       u.username as assigned_agent_username,
       SUM(CASE WHEN l.status != 'pending' THEN 1 ELSE 0 END) as dialed_count,
       SUM(CASE WHEN l.status = 'completed' THEN 1 ELSE 0 END) as completed_count,
       SUM(CASE WHEN l.status = 'pending' THEN 1 ELSE 0 END) as pending_count
     FROM lead_batches lb
     LEFT JOIN users u ON lb.assigned_user_id = u.id
     LEFT JOIN leads l ON lb.id = l.batch_id
     GROUP BY lb.id
     ORDER BY lb.uploaded_at DESC`
  ).all();

  return c.json({ data: results });
});

admin.delete('/leads/batch/:id', async (c) => {
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
  return c.json({ deleted_batch_id: id });
});

admin.get('/leads', async (c) => {
  const batchId = c.req.query('batch_id');
  let query = `
    SELECT 
      l.id, l.phone_number, l.first_name, l.last_name, l.status,
      l.assigned_user_id, u.username as assigned_agent_username,
      l.batch_id, lb.file_name as batch_name
    FROM leads l
    LEFT JOIN users u ON l.assigned_user_id = u.id
    LEFT JOIN lead_batches lb ON l.batch_id = lb.id
  `;
  const params: any[] = [];
  if (batchId) {
    query += ` WHERE l.batch_id = ?`;
    params.push(batchId);
  }
  query += ` ORDER BY l.id DESC LIMIT 2000`; // Limit to prevent massive payloads

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

const assignLeadSchema = z.object({
  lead_id: z.string().min(1),
  user_id: z.string().nullable(),
});

admin.patch('/leads/assign', zValidator('json', assignLeadSchema), async (c) => {
  const { lead_id, user_id } = c.req.valid('json');
  await c.env.DB.prepare('UPDATE leads SET assigned_user_id = ? WHERE id = ?').bind(user_id, lead_id).run();
  return c.json({ success: true });
});

const assignBulkSchema = z.object({
  lead_ids: z.array(z.string()).min(1),
  user_id: z.string().nullable(),
});

admin.patch('/leads/assign-bulk', zValidator('json', assignBulkSchema), async (c) => {
  const { lead_ids, user_id } = c.req.valid('json');
  
  const stmt = c.env.DB.prepare('UPDATE leads SET assigned_user_id = ? WHERE id = ?');
  const stmts = lead_ids.map((id: string) => stmt.bind(user_id, id));
  
  const CHUNK_SIZE = 100;
  for (let i = 0; i < stmts.length; i += CHUNK_SIZE) {
    await c.env.DB.batch(stmts.slice(i, i + CHUNK_SIZE));
  }
  return c.json({ success: true, count: lead_ids.length });
});

const distributeSchema = z.object({
  lead_ids: z.array(z.string()).min(1),
  user_ids: z.array(z.string()).min(1),
});

admin.patch('/leads/distribute-randomly', zValidator('json', distributeSchema), async (c) => {
  const { lead_ids, user_ids } = c.req.valid('json');
  
  const stmts = lead_ids.map((id: string) => {
    const randomUser = user_ids[Math.floor(Math.random() * user_ids.length)];
    return c.env.DB.prepare('UPDATE leads SET assigned_user_id = ? WHERE id = ?').bind(randomUser, id);
  });
  
  const CHUNK_SIZE = 100;
  for (let i = 0; i < stmts.length; i += CHUNK_SIZE) {
    await c.env.DB.batch(stmts.slice(i, i + CHUNK_SIZE));
  }
  return c.json({ success: true, count: lead_ids.length });
});

admin.delete('/leads/:id', async (c) => {
  const id = c.req.param('id');

  // Atomically delete lead
  const result = await c.env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(id).run();

  if (result.meta.changes === 0) {
    return c.json({ error: 'Lead not found' }, 404);
  }

  return c.json({ deleted_lead_id: id });
});

// GET /numbers
admin.get('/numbers', async (c) => {
  // Auto-Initialization Safeguard
  await c.env.DB.batch([
    c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS phone_numbers (
        id TEXT PRIMARY KEY,
        phone_number TEXT UNIQUE NOT NULL,
        friendly_name TEXT,
        assigned_to_user_id TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `),
    c.env.DB.prepare(`
      INSERT OR IGNORE INTO phone_numbers (id, phone_number, friendly_name, status)
      VALUES ('num_default_01', '+19564461280', 'Main Outbound Line', 'active')
    `)
  ]);

  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.phone_number, p.friendly_name, p.status, p.assigned_to_user_id, u.username as assigned_agent_username
     FROM phone_numbers p
     LEFT JOIN users u ON p.assigned_to_user_id = u.id
     ORDER BY p.created_at DESC`
  ).all();

  return c.json({ data: results });
});

const assignNumberSchema = z.object({
  phone_id: z.string().min(1),
  user_id: z.string().nullable(), // null to unassign
});

// POST /numbers/assign
admin.post('/numbers/assign', zValidator('json', assignNumberSchema), async (c) => {
  const { phone_id, user_id } = c.req.valid('json');

  const phone = await c.env.DB.prepare('SELECT phone_number FROM phone_numbers WHERE id = ?')
    .bind(phone_id)
    .first<{ phone_number: string }>();

  if (!phone) {
    return c.json({ error: 'Phone number not found' }, 404);
  }

  // Self-Healing Schema Guard
  try {
    await c.env.DB.prepare("ALTER TABLE users ADD COLUMN assigned_phone_number TEXT;").run();
  } catch (e) {
    // Column already exists, ignore error
  }

  if (user_id) {
    // Assign to new user
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE phone_numbers SET assigned_to_user_id = ? WHERE phone_number = ? OR id = ?").bind(user_id, phone.phone_number, phone_id),
      c.env.DB.prepare("UPDATE users SET assigned_phone_number = ? WHERE id = ? OR username = ?").bind(phone.phone_number, user_id, user_id)
    ]);
  } else {
    // Unassign
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE phone_numbers SET assigned_to_user_id = NULL WHERE phone_number = ? OR id = ?").bind(phone.phone_number, phone_id),
      c.env.DB.prepare("UPDATE users SET assigned_phone_number = NULL WHERE assigned_phone_number = ?").bind(phone.phone_number)
    ]);
  }

  return c.json({ success: true });
});

admin.get('/agent-status', async (c) => {
  // No role filter — include admins who actively use the dialer
  const { results } = await c.env.DB.prepare(`
    SELECT
      u.id        AS user_id,
      u.username,
      u.role,
      COALESCE(a.status, 'offline') AS status,
      a.changed_at
    FROM users u
    LEFT JOIN agent_status a ON u.id = a.user_id
    WHERE u.role = 'agent'
    ORDER BY u.created_at DESC
  `).all();

  return c.json({ data: results });
});

admin.get('/agents/work-summary', async (c) => {
  // No role filter — include admins who actively use the dialer
  const { results } = await c.env.DB.prepare(
    `SELECT
       u.id                                                          AS agent_id,
       u.username,
       u.role,
       COALESCE(a.status, 'offline')                                AS status,
       COALESCE(al.total_active_seconds, 0)                         AS total_active_seconds,
       COALESCE(al.total_break_seconds, 0)                          AS total_break_seconds,
       COALESCE(al.total_calls_made, 0)                             AS total_calls_made,
       COALESCE(al.total_talk_time_seconds, 0)                      AS total_talk_time_seconds,
       l.phone_number                                               AS live_call_destination,
       (strftime('%s', 'now') - strftime('%s', COALESCE(cl.start_time, cl.started_at))) AS live_call_duration
     FROM users u
     LEFT JOIN agent_status a  ON u.id = a.user_id
     LEFT JOIN agent_activity_logs al
            ON u.id = al.agent_id AND al.date = date('now')
     LEFT JOIN call_logs cl
            ON u.id = cl.agent_id
           AND (cl.ended_at IS NULL AND cl.end_time IS NULL)
           AND cl.status NOT IN ('completed', 'failed', 'no_answer', 'busy', 'voicemail')
     LEFT JOIN leads l ON cl.lead_id = l.id
     WHERE u.role = 'agent'
     ORDER BY u.created_at DESC`
  ).all();

  return c.json({ data: results });
});

admin.get('/call-recordings', async (c) => {
  const agentId = c.req.query('agent_id');
  const date = c.req.query('date'); // e.g. "2025-08-31"
  const appBaseUrl = c.env.APP_BASE_URL || '';

  const conditions: string[] = [];
  const params: any[] = [];

  if (agentId) {
    conditions.push('cr.agent_id = ?');
    params.push(agentId);
  }
  if (date) {
    conditions.push("date(cr.created_at) = ?");
    params.push(date);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { results } = await c.env.DB.prepare(`
    SELECT 
      cr.id,
      cr.call_control_id,
      cr.call_log_id,
      cr.agent_id,
      COALESCE(cr.agent_username, u.username) AS agent_username,
      cr.destination_number,
      cr.direction,
      cr.duration_seconds,
      cr.r2_key,
      cr.recording_url,
      cr.created_at
    FROM call_recordings cr
    LEFT JOIN users u ON cr.agent_id = u.id
    ${where}
    ORDER BY cr.created_at DESC 
    LIMIT 200
  `).bind(...params).all();

  // Build proxy URL for each recording that has an r2_key
  const data = results.map((r: any) => ({
    ...r,
    playback_url: r.r2_key
      ? `${appBaseUrl}/api/recordings/${encodeURIComponent(r.r2_key)}`
      : r.recording_url || null,
  }));

  return c.json({ data });
});

export default admin;
