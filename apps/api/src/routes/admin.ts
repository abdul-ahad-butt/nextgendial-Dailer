import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { authMiddleware, requireRole } from '../auth/middleware';
import { hashPassword } from '../auth/crypto';
import { normalizeToE164, isValidE164 } from '../utils/phone';
import { getTenantBalance } from '../services/creditEngine';

const admin = new Hono<AppEnv>();

// Apply auth + requireRole('admin') or 'super_admin' to all routes in this module
admin.use('*', authMiddleware);
admin.use('*', requireRole(['admin', 'super_admin']));

// Helper to get effective tenantId for the current admin
async function getEffectiveTenantId(c: Context<AppEnv>): Promise<string> {
  let tenantId = c.get('tenantId');
  if (tenantId) return tenantId;

  const userId = c.get('userId');
  const user = await c.env.DB.prepare('SELECT tenant_id FROM users WHERE id = ?')
    .bind(userId)
    .first<{ tenant_id: string | null }>();

  if (user?.tenant_id) {
    c.set('tenantId', user.tenant_id);
    return user.tenant_id;
  }

  // Fallback to default tenant if none assigned
  const def = await c.env.DB.prepare('SELECT id FROM tenants LIMIT 1').first<{ id: string }>();
  if (def?.id) {
    await c.env.DB.prepare('UPDATE users SET tenant_id = ? WHERE id = ?').bind(def.id, userId).run();
    c.set('tenantId', def.id);
    return def.id;
  }

  const newDefId = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO tenants (id, name, admin_username, admin_password_hash, allocated_credits, spent_credits, max_agents, is_active)
    VALUES (?, 'Default Organization', 'admin', 'placeholder', 25.00, 0.00, 10, 1)
  `).bind(newDefId).run();
  await c.env.DB.prepare('UPDATE users SET tenant_id = ? WHERE id = ?').bind(newDefId, userId).run();
  c.set('tenantId', newDefId);
  return newDefId;
}

// ----------------------------------------------------------------
// GET /admin/tenant — Current tenant overview & prepaid credit balance
// ----------------------------------------------------------------
admin.get('/tenant', async (c) => {
  const tenantId = await getEffectiveTenantId(c);
  const balance = await getTenantBalance(c.env.DB, tenantId);

  // Fetch assigned numbers
  const { results: numbers } = await c.env.DB.prepare(`
    SELECT phone_number as id, phone_number, friendly_name, assigned_agent_id
    FROM phone_inventory
    WHERE assigned_tenant_id = ?
  `).bind(tenantId).all();

  // Fetch tenant info
  const tenantRow = await c.env.DB.prepare(`
    SELECT max_agents, is_active FROM tenants WHERE id = ?
  `).bind(tenantId).first<{ max_agents: number; is_active: number }>();

  // Fetch agent count
  const agentsCount = await c.env.DB.prepare(`
    SELECT COUNT(*) as cnt FROM users 
    WHERE tenant_id = ? AND role = 'agent' AND COALESCE(status, 'offline') != 'deleted'
  `).bind(tenantId).first<{ cnt: number }>();

  // Fetch calls count
  const callsCount = await c.env.DB.prepare(`
    SELECT COUNT(*) as cnt FROM call_logs WHERE tenant_id = ?
  `).bind(tenantId).first<{ cnt: number }>();

  const tenantObj = {
    id: tenantId,
    name: balance?.name || 'Admin Organization',
    allocated_credits: balance?.allocated_credits ?? 0,
    spent_credits: balance?.spent_credits ?? 0,
    remaining_balance: balance?.remaining_balance ?? 0,
    remaining_credits: balance?.remaining_balance ?? 0,
    max_agents: tenantRow?.max_agents ?? 5,
    is_active: Boolean(tenantRow?.is_active ?? 1),
    assigned_numbers: numbers || [],
  };

  const statsObj = {
    agents_count: agentsCount?.cnt ?? 0,
    total_calls: callsCount?.cnt ?? 0,
  };

  return c.json({
    data: {
      ...tenantObj,
      tenant: tenantObj,
      stats: statsObj,
    },
    tenant: tenantObj,
    stats: statsObj,
  });
});

// ----------------------------------------------------------------
// GET /admin/dashboard — Consolidated Dashboard Overview
// ----------------------------------------------------------------
admin.get('/dashboard', async (c) => {
  const tenantId = await getEffectiveTenantId(c);
  const balance = await getTenantBalance(c.env.DB, tenantId);

  // Fetch assigned numbers
  const { results: numbers } = await c.env.DB.prepare(`
    SELECT 
      pi.phone_number as id,
      pi.phone_number, 
      pi.friendly_name, 
      pi.assigned_agent_id
    FROM phone_inventory pi
    WHERE pi.assigned_tenant_id = ?
  `).bind(tenantId).all();

  // Fetch tenant info
  const tenantRow = await c.env.DB.prepare(`
    SELECT max_agents, is_active FROM tenants WHERE id = ?
  `).bind(tenantId).first<{ max_agents: number; is_active: number }>();

  // Fetch agents
  const { results: agentsList } = await c.env.DB.prepare(`
    SELECT id, username, role, tenant_id, created_at, status
    FROM users 
    WHERE role = 'agent' AND tenant_id = ? AND COALESCE(status, 'offline') != 'deleted'
    ORDER BY created_at DESC
  `).bind(tenantId).all();

  // Fetch calls count
  const callsCount = await c.env.DB.prepare(`
    SELECT COUNT(*) as cnt FROM call_logs WHERE tenant_id = ?
  `).bind(tenantId).first<{ cnt: number }>();

  const tenantObj = {
    id: tenantId,
    name: balance?.name || 'Admin Organization',
    allocated_credits: balance?.allocated_credits ?? 0,
    spent_credits: balance?.spent_credits ?? 0,
    remaining_balance: balance?.remaining_balance ?? 0,
    remaining_credits: balance?.remaining_balance ?? 0,
    max_agents: tenantRow?.max_agents ?? 5,
    is_active: Boolean(tenantRow?.is_active ?? 1),
  };

  const statsObj = {
    agents_count: (agentsList || []).length,
    total_calls: callsCount?.cnt ?? 0,
  };

  const agentsSafe = (agentsList || []).map((a: any) => ({
    ...a,
    name: a.username || 'Agent',
  }));

  const phoneNumbersSafe = (numbers || []).map((n: any) => ({
    ...n,
    name: n.friendly_name || n.phone_number,
  }));

  return c.json({
    tenant: tenantObj,
    admin: {
      name: balance?.name || 'Admin Organization',
      allocated_credits: balance?.allocated_credits ?? 0,
    },
    stats: statsObj,
    agents: agentsSafe,
    phone_numbers: phoneNumbersSafe,
    data: {
      tenant: tenantObj,
      stats: statsObj,
      agents: agentsSafe,
      phone_numbers: phoneNumbersSafe,
    },
  });
});

// ----------------------------------------------------------------
// GET /admin/me — Admin Profile & Tenant Context
// ----------------------------------------------------------------
admin.get('/me', async (c) => {
  const tenantId = await getEffectiveTenantId(c);
  const balance = await getTenantBalance(c.env.DB, tenantId);
  const userId = c.get('userId');
  const user = await c.env.DB.prepare('SELECT id, username, role FROM users WHERE id = ?')
    .bind(userId).first<{ id: string; username: string; role: string }>();

  const tenantObj = {
    id: tenantId,
    name: balance?.name || 'Admin Organization',
    allocated_credits: balance?.allocated_credits ?? 0,
    spent_credits: balance?.spent_credits ?? 0,
    remaining_credits: balance?.remaining_balance ?? 0,
  };

  return c.json({
    data: {
      id: userId,
      name: user?.username || 'Administrator',
      username: user?.username || 'admin',
      role: user?.role || 'admin',
      tenant: tenantObj,
    },
    tenant: tenantObj,
    admin: {
      id: userId,
      name: user?.username || 'Administrator',
    },
  });
});

// ----------------------------------------------------------------
// Agent Management (Scoped to Tenant + Max Agents Limit)
// ----------------------------------------------------------------
const createUserSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

admin.post('/agents', zValidator('json', createUserSchema), async (c) => {
  const { username, password } = c.req.valid('json');
  const trimmedUsername = username.trim();
  const trimmedPassword = password.trim();
  const tenantId = await getEffectiveTenantId(c);

  // Check tenant max_agents constraint
  const tenantRow = await c.env.DB.prepare('SELECT max_agents FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first<{ max_agents: number }>();
  const maxAgents = tenantRow?.max_agents ?? 5;

  const currentCount = await c.env.DB.prepare(`
    SELECT COUNT(*) as cnt FROM users 
    WHERE tenant_id = ? AND role = 'agent' AND COALESCE(status, 'offline') != 'deleted'
  `).bind(tenantId).first<{ cnt: number }>();

  if ((currentCount?.cnt ?? 0) >= maxAgents) {
    return c.json({
      error: `Agent limit reached (${maxAgents} max allowed for your organization). Contact Super Admin to increase limit.`,
    }, 403);
  }

  // Reject if username already exists
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)')
    .bind(trimmedUsername)
    .first();

  if (existing) {
    return c.json({ error: 'Username already exists' }, 409);
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(trimmedPassword);
  const role = 'agent';
  const sipUsername = `agent_${id.replace(/-/g, '')}`;

  // Create Telephony Credential on Telnyx
  let telnyxCredentialId = null;
  if (c.env.TELNYX_API_KEY && c.env.TELNYX_CONNECTION_ID) {
    try {
      const telnyxRes = await fetch('https://api.telnyx.com/v2/telephony_credentials', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          connection_id: c.env.TELNYX_CONNECTION_ID,
          sip_username: sipUsername,
          sip_password: crypto.randomUUID().slice(0, 16) + 'Aa1!',
        }),
      });

      if (telnyxRes.ok) {
        const telnyxData = await telnyxRes.json() as any;
        telnyxCredentialId = telnyxData.data?.id;
      }
    } catch (e) {
      console.error('[telnyx] error creating telephony credential:', e);
    }
  }

  await c.env.DB.prepare(`
    INSERT INTO users (id, username, password_hash, role, tenant_id, telnyx_credential_id, telnyx_sip_username, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'offline', datetime('now'))
  `).bind(id, trimmedUsername, passwordHash, role, tenantId, telnyxCredentialId, sipUsername).run();

  await c.env.DB.prepare(`
    INSERT INTO agents (id, name, email, tenant_id, telnyx_credential_id, telnyx_sip_username, status)
    VALUES (?, ?, ?, ?, ?, ?, 'offline')
    ON CONFLICT(id) DO UPDATE SET tenant_id = excluded.tenant_id
  `).bind(id, trimmedUsername, `${trimmedUsername}@system.local`, tenantId, telnyxCredentialId, sipUsername).run();

  const createdUser = await c.env.DB.prepare(
    'SELECT id, username, role, tenant_id, created_at, status, telnyx_credential_id, telnyx_sip_username FROM users WHERE id = ?'
  ).bind(id).first();

  return c.json({ data: createdUser }, 201);
});

admin.get('/agents', async (c) => {
  const tenantId = await getEffectiveTenantId(c);
  const { results } = await c.env.DB.prepare(`
    SELECT id, username, role, tenant_id, created_at, status
    FROM users 
    WHERE role = 'agent' AND tenant_id = ? AND COALESCE(status, 'offline') != 'deleted'
    ORDER BY created_at DESC
  `).bind(tenantId).all();

  return c.json({ data: results || [] });
});

admin.delete('/agents/:id', async (c) => {
  const id = c.req.param('id');
  const tenantId = await getEffectiveTenantId(c);

  const agent = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'agent' AND tenant_id = ?")
    .bind(id, tenantId)
    .first();

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET status = 'deleted' WHERE id = ?").bind(id),
    c.env.DB.prepare("UPDATE agent_status SET status = 'offline' WHERE user_id = ?").bind(id),
    c.env.DB.prepare("UPDATE phone_inventory SET assigned_agent_id = NULL WHERE assigned_agent_id = ?").bind(id),
  ]);

  return c.json({ success: true, deleted_agent_id: id });
});

admin.post('/agents/:id/reset-password', async (c) => {
  const id = c.req.param('id');
  const tenantId = await getEffectiveTenantId(c);

  const agent = await c.env.DB.prepare("SELECT id, username FROM users WHERE id = ? AND role = 'agent' AND tenant_id = ?")
    .bind(id, tenantId)
    .first();

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const newPassword = crypto.randomUUID().replace(/-/g, '').slice(0, 12) + 'A1!';
  const passwordHash = await hashPassword(newPassword);

  await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(passwordHash, id).run();

  return c.json({ success: true, new_password: newPassword });
});

// ----------------------------------------------------------------
// Lead Upload with E.164 Normalization & Tenant Scoping
// ----------------------------------------------------------------
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
  const tenantId = await getEffectiveTenantId(c);

  const batchId = crypto.randomUUID();
  const validLeads = [];
  const errors = [];
  let skipped = 0;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]!;
    const rawPhone = lead.phone_number?.trim();

    if (!rawPhone) {
      skipped++;
      errors.push(`Row ${i + 1}: Missing or empty phone_number`);
      continue;
    }

    const normalizedPhone = normalizeToE164(rawPhone);
    if (!isValidE164(normalizedPhone)) {
      skipped++;
      errors.push(`Row ${i + 1}: Invalid telephone number format: ${rawPhone}`);
      continue;
    }

    validLeads.push({
      id: crypto.randomUUID(),
      phone_number: normalizedPhone,
      first_name: lead.first_name || null,
      last_name: lead.last_name || null,
    });
  }

  if (validLeads.length > 0) {
    const CHUNK_SIZE = 100;

    const batchCreateStmt = c.env.DB.prepare(`
      INSERT INTO lead_batches (id, tenant_id, file_name, total_leads, assigned_user_id, assignment_mode, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(batchId, tenantId, file_name, validLeads.length, assigned_user_id, assignment_mode);

    const leadInsertStmt = c.env.DB.prepare(`
      INSERT OR IGNORE INTO leads (id, tenant_id, assigned_user_id, batch_id, phone_number, first_name, last_name, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
    `);

    const allLeadStmts = validLeads.map((l) =>
      leadInsertStmt.bind(l.id, tenantId, assigned_user_id, batchId, l.phone_number, l.first_name, l.last_name)
    );

    const allStmts = [batchCreateStmt, ...allLeadStmts];

    for (let i = 0; i < allStmts.length; i += CHUNK_SIZE) {
      const chunk = allStmts.slice(i, i + CHUNK_SIZE);
      await c.env.DB.batch(chunk);
    }
  } else {
    await c.env.DB.prepare(`
      INSERT INTO lead_batches (id, tenant_id, file_name, total_leads, assigned_user_id, assignment_mode, uploaded_at)
      VALUES (?, ?, ?, 0, ?, ?, datetime('now'))
    `).bind(batchId, tenantId, file_name, assigned_user_id, assignment_mode).run();
  }

  return c.json({
    batch_id: batchId,
    inserted: validLeads.length,
    skipped,
    errors,
  });
});

// ----------------------------------------------------------------
// Phone Numbers Management (Scoped to Tenant's Assigned Numbers)
// ----------------------------------------------------------------
admin.get('/phone-numbers', async (c) => {
  const tenantId = await getEffectiveTenantId(c);

  const { results } = await c.env.DB.prepare(`
    SELECT 
      pi.phone_number as id,
      pi.phone_number,
      pi.friendly_name,
      pi.status,
      pi.assigned_agent_id as assigned_to_user_id,
      u.username as assigned_agent_username
    FROM phone_inventory pi
    LEFT JOIN users u ON pi.assigned_agent_id = u.id
    WHERE pi.assigned_tenant_id = ?
    ORDER BY pi.created_at DESC
  `).bind(tenantId).all();

  return c.json({ data: results || [] });
});

// Alias for compatibility with frontend api.admin.getNumbers()
admin.get('/numbers', async (c) => {
  const tenantId = await getEffectiveTenantId(c);

  const { results } = await c.env.DB.prepare(`
    SELECT 
      pi.phone_number as id,
      pi.phone_number,
      pi.friendly_name,
      pi.status,
      pi.assigned_agent_id as assigned_to_user_id,
      u.username as assigned_agent_username
    FROM phone_inventory pi
    LEFT JOIN users u ON pi.assigned_agent_id = u.id
    WHERE pi.assigned_tenant_id = ?
    ORDER BY pi.created_at DESC
  `).bind(tenantId).all();

  return c.json({ data: results || [] });
});

const assignNumberSchema = z.object({
  phone_id: z.string().min(1), // can be phone_number or ID
  user_id: z.string().nullable(), // agent id
});

admin.post('/numbers/assign', zValidator('json', assignNumberSchema), async (c) => {
  const { phone_id, user_id } = c.req.valid('json');
  const tenantId = await getEffectiveTenantId(c);

  // Verify number belongs to this tenant
  const phone = await c.env.DB.prepare(`
    SELECT phone_number FROM phone_inventory 
    WHERE (phone_number = ? OR telnyx_id = ?) AND assigned_tenant_id = ?
  `).bind(phone_id, phone_id, tenantId).first<{ phone_number: string }>();

  if (!phone) {
    return c.json({ error: 'Phone number not assigned to your organization' }, 404);
  }

  if (user_id) {
    // Verify user belongs to tenant
    const agent = await c.env.DB.prepare('SELECT id FROM users WHERE id = ? AND tenant_id = ?')
      .bind(user_id, tenantId).first();
    if (!agent) {
      return c.json({ error: 'Agent not found in your organization' }, 404);
    }

    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE phone_inventory SET assigned_agent_id = ? WHERE phone_number = ?')
        .bind(user_id, phone.phone_number),
      c.env.DB.prepare('UPDATE users SET assigned_phone_number = ? WHERE id = ?')
        .bind(phone.phone_number, user_id),
    ]);
  } else {
    // Unassign
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE phone_inventory SET assigned_agent_id = NULL WHERE phone_number = ?')
        .bind(phone.phone_number),
      c.env.DB.prepare('UPDATE users SET assigned_phone_number = NULL WHERE assigned_phone_number = ?')
        .bind(phone.phone_number),
    ]);
  }

  return c.json({ success: true, phone_number: phone.phone_number, assigned_to: user_id });
});

// ----------------------------------------------------------------
// Agent Status & Work Summary (Scoped to Tenant)
// ----------------------------------------------------------------
admin.get('/agent-status', async (c) => {
  const tenantId = await getEffectiveTenantId(c);

  const { results } = await c.env.DB.prepare(`
    SELECT
      u.id        AS user_id,
      u.username,
      u.role,
      COALESCE(a.status, 'offline') AS status,
      a.changed_at
    FROM users u
    LEFT JOIN agent_status a ON u.id = a.user_id
    WHERE u.role = 'agent' AND u.tenant_id = ? AND COALESCE(u.status, 'offline') != 'deleted'
    ORDER BY u.created_at DESC
  `).bind(tenantId).all();

  return c.json({ data: results || [] });
});

admin.get('/agents/work-summary', async (c) => {
  const tenantId = await getEffectiveTenantId(c);

  const { results } = await c.env.DB.prepare(`
    SELECT
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
     LEFT JOIN (
       SELECT * FROM (
         SELECT agent_id, lead_id, start_time, started_at,
                ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY COALESCE(start_time, started_at) DESC) as rn
         FROM call_logs
         WHERE (ended_at IS NULL AND end_time IS NULL)
           AND status NOT IN ('completed', 'failed', 'no_answer', 'busy', 'voicemail')
       ) WHERE rn = 1
     ) cl ON u.id = cl.agent_id
     LEFT JOIN leads l ON cl.lead_id = l.id
     WHERE u.role = 'agent' AND u.tenant_id = ? AND COALESCE(u.status, 'offline') != 'deleted'
     ORDER BY u.created_at DESC
  `).bind(tenantId).all();

  return c.json({ data: results || [] });
});

// ----------------------------------------------------------------
// Call Recordings (Scoped to Tenant)
// ----------------------------------------------------------------
admin.get('/call-recordings', async (c) => {
  const tenantId = await getEffectiveTenantId(c);
  const agentId = c.req.query('agent_id');
  const date = c.req.query('date');
  const appBaseUrl = c.env.APP_BASE_URL || '';

  const conditions: string[] = ['u.tenant_id = ?'];
  const params: any[] = [tenantId];

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
    JOIN users u ON cr.agent_id = u.id
    ${where}
    ORDER BY cr.created_at DESC 
    LIMIT 200
  `).bind(...params).all();

  const data = (results || []).map((r: any) => ({
    ...r,
    playback_url: r.r2_key
      ? `${appBaseUrl}/api/recordings/${encodeURIComponent(r.r2_key)}`
      : r.recording_url || null,
  }));

  return c.json({ data });
});

export default admin;
