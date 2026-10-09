import { Hono } from 'hono';
import { tryDialNextLead } from '../dialer/engine';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { authMiddleware } from '../auth/middleware';
import { normalizeToE164, isValidE164 } from '../utils/phone';
import { computeCallDuration, calculateElapsedSeconds } from '../utils/duration';
import { verifyPreCallCredits, deductCallCredits } from '../services/creditEngine';

const calls = new Hono<AppEnv>();

calls.use('*', authMiddleware);

// ── GET /calls — list call logs with optional filters ────────────────
calls.get('/', async (c) => {
  const { agent_id, campaign_id, telnyx_call_control_id, status, page = '1', limit = '50' } = c.req.query();
  const userId = c.get('userId');
  const role = c.get('role');
  let tenantId = c.get('tenantId');

  if (!tenantId && role !== 'super_admin') {
    const user = await c.env.DB.prepare('SELECT tenant_id FROM users WHERE id = ?')
      .bind(userId)
      .first<{ tenant_id: string | null }>();
    tenantId = user?.tenant_id || undefined;
  }

  const conditions: string[] = [];
  const params: any[] = [];

  if (tenantId && role !== 'super_admin') {
    conditions.push('cl.tenant_id = ?');
    params.push(tenantId);
  }

  if (agent_id) { conditions.push('cl.agent_id = ?'); params.push(agent_id); }
  if (campaign_id) { conditions.push('cl.campaign_id = ?'); params.push(campaign_id); }
  if (telnyx_call_control_id) {
    conditions.push('(cl.telnyx_call_control_id = ? OR cl.agent_leg_call_control_id = ?)');
    params.push(telnyx_call_control_id, telnyx_call_control_id);
  }
  if (status) { conditions.push('cl.status = ?'); params.push(status); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitNum = Math.min(parseInt(limit, 10) || 50, 200);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limitNum;

  const rows = await c.env.DB.prepare(
    `SELECT cl.* FROM call_logs cl ${where} ORDER BY cl.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, limitNum, offset).all();

  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM call_logs cl ${where}`
  ).bind(...params).first<{ cnt: number }>();

  return c.json({
    data: rows.results,
    total: total?.cnt ?? 0,
    page: parseInt(page, 10) || 1,
    limit: limitNum,
  });
});

// ── GET /calls/:id — fetch a single call log ─────────────────────────
calls.get('/:id', async (c) => {
  const id = c.req.param('id');
  const callLog = await c.env.DB.prepare('SELECT * FROM call_logs WHERE id = ?').bind(id).first();
  if (!callLog) return c.json({ error: 'Call log not found' }, 404);
  return c.json({ data: callLog });
});

const outboundCallSchema = z.object({
  to: z.string().min(1),
});

calls.post('/outbound', zValidator('json', outboundCallSchema), async (c) => {
  const { to } = c.req.valid('json');
  const userId = c.get('userId');

  const normalizedTo = normalizeToE164(to);
  if (!isValidE164(normalizedTo)) {
    return c.json({ error: `Invalid number: ${to}. Must be valid phone format.` }, 400);
  }

  // 1. Get the assigned number and tenant for this user
  const user = await c.env.DB.prepare('SELECT assigned_phone_number, tenant_id FROM users WHERE id = ?')
    .bind(userId)
    .first<{ assigned_phone_number: string; tenant_id: string }>();

  const tenantId = user?.tenant_id || c.get('tenantId');

  // Pre-flight Credit Verification
  if (tenantId) {
    try {
      await verifyPreCallCredits(c.env.DB, tenantId);
    } catch (creditErr: any) {
      return c.json({ error: creditErr.message }, 402);
    }
  }

  const callerId = user?.assigned_phone_number || c.env.TELNYX_DEFAULT_NUMBER || '+19564461280';
  const connectionId = c.env.TELNYX_CONNECTION_ID;

  if (!connectionId) {
    return c.json({ error: 'TELNYX_CONNECTION_ID not configured' }, 500);
  }

  // 2. Initiate Call via Telnyx Call Control API
  try {
    const response = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${c.env.TELNYX_API_KEY}`,
      },
      body: JSON.stringify({
        connection_id: connectionId,
        to: normalizedTo,
        from: callerId,
        webhook_url: `${c.env.APP_BASE_URL}/api/webhooks/telnyx`,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('[Telnyx Call Error]', errorData);
      return c.json({ error: 'Failed to initiate call via Telnyx' }, 500);
    }

    const data = await response.json();
    return c.json({ success: true, data });
  } catch (error: any) {
    console.error('[Telnyx Call Exception]', error);
    return c.json({ error: error.message || 'Unknown error' }, 500);
  }
});

const manualCallSchema = z.object({
  agentId: z.string(),
  phoneNumber: z.string().min(1),
  leadId: z.string().optional(),
  campaignId: z.string().optional(),
  telnyx_call_control_id: z.string().optional(),
  direction: z.enum(['outbound', 'inbound']).optional(),
});

calls.post('/manual', zValidator('json', manualCallSchema), async (c) => {
  const body = c.req.valid('json');

  const normalizedPhone = normalizeToE164(body.phoneNumber);
  if (!isValidE164(normalizedPhone)) {
    return c.json({ error: `Invalid number: ${body.phoneNumber}. Must be valid phone format.` }, 400);
  }

  // Check agent & tenant credentials
  const user = await c.env.DB.prepare('SELECT id, username, tenant_id, assigned_phone_number FROM users WHERE id = ?')
    .bind(body.agentId)
    .first<{ id: string; username: string; tenant_id: string | null; assigned_phone_number: string | null }>();

  const tenantId = user?.tenant_id || c.get('tenantId');

  // Pre-flight Credit Verification
  if (tenantId) {
    try {
      await verifyPreCallCredits(c.env.DB, tenantId);
    } catch (creditErr: any) {
      return c.json({ error: creditErr.message }, 402);
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const direction = body.direction || 'outbound';

  // Ensure agent operational record
  try {
    if (user) {
      await c.env.DB.prepare(`
        INSERT INTO agents (id, name, email, tenant_id) 
        VALUES (?, ?, ?, ?) 
        ON CONFLICT(id) DO UPDATE SET tenant_id = excluded.tenant_id
      `).bind(body.agentId, user.username, `${user.username}@system.local`, tenantId || null).run();
    }
  } catch (syncErr: any) {
    console.error(`[calls/manual] Agent sync to agents table failed: ${syncErr?.message}`);
  }

  if (body.leadId) {
    const lead = await c.env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(body.leadId).first();
    if (!lead) {
      body.leadId = undefined;
    }
  }

  // Insert call log with normalized phone and tenant_id
  await c.env.DB.prepare(`
    INSERT INTO call_logs (
      id, tenant_id, agent_id, lead_id, campaign_id, 
      telnyx_call_control_id, direction, status, 
      started_at, start_time, duration_seconds, duration, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ringing', ?, ?, 0, 0, ?)
  `).bind(
    id,
    tenantId || null,
    body.agentId,
    body.leadId || null,
    body.campaignId || null,
    body.telnyx_call_control_id || null,
    direction,
    now,
    now,
    now
  ).run();

  const callLog = await c.env.DB.prepare('SELECT * FROM call_logs WHERE id = ?').bind(id).first();

  // Outbound sticky routing map
  if (direction === 'outbound') {
    try {
      const fromNumber = user?.assigned_phone_number;
      if (fromNumber && normalizedPhone) {
        await c.env.DB.prepare(`
          INSERT INTO outbound_call_map (id, agent_id, from_number, to_number, last_call_at)
          VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(from_number, to_number) DO UPDATE SET
            agent_id = excluded.agent_id,
            last_call_at = excluded.last_call_at
        `).bind(crypto.randomUUID(), body.agentId, fromNumber, normalizedPhone).run();
      }
    } catch {}
  }

  return c.json({ data: callLog }, 201);
});

const updateCallSchema = z.object({
  status: z.string().optional(),
  end_time: z.string().optional(),
  duration: z.number().optional(),
  hangup_cause: z.string().optional(),
  setup_duration_ms: z.number().optional(),
  failure_category: z.string().optional(),
});

calls.patch('/:id', zValidator('json', updateCallSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const updates: string[] = [];
  const values: any[] = [];

  const existingLog = await c.env.DB.prepare('SELECT * FROM call_logs WHERE id = ?').bind(id).first<any>();
  if (!existingLog) {
    return c.json({ error: 'Call log not found' }, 404);
  }

  const callStatus = body.status || existingLog.status || '';
  const nonConnected = ['failed', 'declined', 'busy', 'no_answer', 'invalid number', 'ringing', 'initiated'];
  const isNonConnected = nonConnected.includes(callStatus.toLowerCase());

  if (body.status) {
    updates.push('status = ?');
    values.push(body.status);
  }

  // Duration Safeguards & Normalization
  let resolvedDurationSeconds = 0;

  if (isNonConnected) {
    // Failed, ringing, declined, or unallocated calls MUST have 0 duration
    resolvedDurationSeconds = 0;
  } else if (body.duration !== undefined) {
    resolvedDurationSeconds = Math.max(0, Math.min(86400, Math.floor(body.duration)));
  } else if (body.end_time || existingLog.started_at || existingLog.start_time) {
    const startStr = existingLog.started_at || existingLog.start_time;
    const endStr = body.end_time || new Date().toISOString();
    resolvedDurationSeconds = calculateElapsedSeconds(callStatus, startStr, endStr);
  }

  if (body.end_time) {
    updates.push('end_time = ?', 'ended_at = ?');
    values.push(body.end_time, body.end_time);
  }

  updates.push('duration_seconds = ?', 'duration = ?');
  values.push(resolvedDurationSeconds, resolvedDurationSeconds);

  if (body.hangup_cause) {
    updates.push('hangup_cause = ?');
    values.push(body.hangup_cause);
  }
  if (body.setup_duration_ms !== undefined) {
    updates.push('setup_duration_ms = ?');
    values.push(body.setup_duration_ms);
  }
  if (body.failure_category) {
    updates.push('failure_category = ?');
    values.push(body.failure_category);
  }

  if (updates.length > 0) {
    values.push(id);
    await c.env.DB.prepare(`UPDATE call_logs SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  // Deduct call credits if call completed with positive duration
  if (body.status === 'completed' && resolvedDurationSeconds > 0 && existingLog.tenant_id) {
    try {
      await deductCallCredits(c.env.DB, {
        tenantId: existingLog.tenant_id,
        callId: id,
        durationSeconds: resolvedDurationSeconds,
      });
    } catch (e: any) {
      console.error('[calls.patch] Credit deduction error:', e.message);
    }
  }

  const updatedLog = await c.env.DB.prepare('SELECT * FROM call_logs WHERE id = ?').bind(id).first();
  return c.json({ data: updatedLog });
});

const dispositionSchema = z.object({
  disposition: z.enum(['sale', 'callback', 'not_interested', 'wrong_number', 'voicemail', 'no_answer', 'dnc_request']),
  notes: z.string().optional(),
  callback_time: z.string().optional(),
  callback_notes: z.string().optional(),
});

calls.post('/:id/disposition', zValidator('json', dispositionSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const callLog = await c.env.DB.prepare('SELECT * FROM call_logs WHERE id = ?').bind(id).first<any>();
  if (!callLog) {
    return c.json({ error: 'Call log not found' }, 404);
  }

  await c.env.DB.prepare(`
    UPDATE call_logs 
    SET disposition = ?, disposition_notes = ?
    WHERE id = ?
  `).bind(body.disposition, body.notes || null, id).run();

  // If callback disposition, automatically queue in callbacks table
  if (body.disposition === 'callback' && body.callback_time) {
    const callbackId = crypto.randomUUID();
    const contactPhone = callLog.destination_number || callLog.to || '';
    if (callLog.tenant_id && contactPhone) {
      await c.env.DB.prepare(`
        INSERT INTO callbacks (id, tenant_id, lead_id, phone_number, contact_name, scheduled_time, assigned_agent_id, status, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))
      `).bind(
        callbackId,
        callLog.tenant_id,
        callLog.lead_id || null,
        contactPhone,
        null,
        body.callback_time,
        callLog.agent_id || null,
        body.callback_notes || body.notes || 'Callback requested via disposition'
      ).run();
    }
  }

  return c.json({ success: true, disposition: body.disposition });
});

export default calls;
