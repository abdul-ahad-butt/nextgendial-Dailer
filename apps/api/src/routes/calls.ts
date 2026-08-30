import { Hono } from 'hono';
import { tryDialNextLead } from '../dialer/engine';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { authMiddleware } from '../auth/middleware';

const calls = new Hono<AppEnv>();

calls.use('*', authMiddleware);

// ── GET /calls — list call logs with optional filters ────────────────
calls.get('/', async (c) => {
  const { agent_id, campaign_id, telnyx_call_control_id, page = '1', limit = '50' } = c.req.query();
  
  const conditions: string[] = [];
  const params: any[] = [];
  
  if (agent_id) { conditions.push('agent_id = ?'); params.push(agent_id); }
  if (campaign_id) { conditions.push('campaign_id = ?'); params.push(campaign_id); }
  if (telnyx_call_control_id) {
    conditions.push('(telnyx_call_control_id = ? OR agent_leg_call_control_id = ?)');
    params.push(telnyx_call_control_id, telnyx_call_control_id);
  }
  
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitNum = Math.min(parseInt(limit, 10) || 50, 200);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limitNum;
  
  const rows = await c.env.DB.prepare(
    `SELECT * FROM call_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, limitNum, offset).all();
  
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM call_logs ${where}`
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

  // 1. Get the assigned number for this user
  const user = await c.env.DB.prepare('SELECT assigned_phone_number FROM users WHERE id = ?')
    .bind(userId)
    .first<{ assigned_phone_number: string }>();

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
        to,
        from: callerId,
        // The webhook URL that Telnyx will hit for call events
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
  agentId: z.string().uuid(),
  phoneNumber: z.string().min(1),
  leadId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  telnyx_call_control_id: z.string().optional(),
  direction: z.enum(['outbound', 'inbound']).optional(),
});

calls.post('/manual', zValidator('json', manualCallSchema), async (c) => {
  const body = c.req.valid('json');
  
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const direction = body.direction || 'outbound';
  
  // Ensure the agent exists in the agents table (call_logs.agent_id references agents.id).
  // The system uses two tables: users (auth) and agents (dialer). We auto-sync them here.
  try {
    const user = await c.env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(body.agentId).first<{ username: string }>();
    if (user) {
      await c.env.DB.prepare(`
        INSERT INTO agents (id, name, email) 
        VALUES (?, ?, ?) 
        ON CONFLICT(id) DO NOTHING
      `).bind(body.agentId, user.username, `${user.username}@system.local`).run();
    } else {
      console.warn(`[calls/manual] Agent ${body.agentId} not found in users table — call_log FK may fail.`);
    }
  } catch (syncErr: any) {
    // Log but don't abort — the call log insert below has a FK fallback.
    console.error(`[calls/manual] Agent sync to agents table failed: ${syncErr?.message}`);
  }
  
  if (body.leadId) {
    const lead = await c.env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(body.leadId).first();
    if (!lead) {
      console.warn(`[calls/manual] leadId ${body.leadId} not found — omitting from call_log.`);
      body.leadId = undefined;
    }
  }

  try {
    // Write both start_time (legacy column added in migration 0005) AND started_at
    // (original schema column). The frontend CallTimer reads started_at for the
    // elapsed call duration display.
    await c.env.DB.prepare(`
      INSERT INTO call_logs (id, agent_id, lead_id, campaign_id, telnyx_call_control_id, direction, status, started_at, start_time, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ringing', ?, ?, ?)
    `)
    .bind(
      id,
      body.agentId,
      body.leadId || null,
      body.campaignId || null,
      body.telnyx_call_control_id || null,
      direction,
      now, // started_at — read by frontend CallTimer
      now, // start_time — legacy column
      now  // created_at
    ).run();
  } catch (error: any) {
    if (error.message && error.message.includes('FOREIGN KEY constraint failed')) {
      // agent_id FK failed — insert without agent_id as a last resort
      console.error(`[calls/manual] FK constraint on agent_id=${body.agentId}. Inserting call_log without agent reference.`);
      await c.env.DB.prepare(`
        INSERT INTO call_logs (id, agent_id, lead_id, campaign_id, telnyx_call_control_id, direction, status, started_at, start_time, created_at)
        VALUES (?, NULL, NULL, NULL, ?, ?, 'ringing', ?, ?, ?)
      `)
      .bind(
        id,
        body.telnyx_call_control_id || null,
        direction,
        now, // started_at
        now, // start_time
        now  // created_at
      ).run();
    } else {
      throw error;
    }
  }
  
  const callLog = await c.env.DB.prepare('SELECT * FROM call_logs WHERE id = ?').bind(id).first();
  return c.json({ data: callLog });
});


const updateCallSchema = z.object({
  status: z.string().optional(),
  end_time: z.string().optional(),
  duration: z.number().optional(),
});

calls.patch('/:id', zValidator('json', updateCallSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  
  const updates: string[] = [];
  const values: any[] = [];
  
  if (body.status) {
    updates.push('status = ?');
    values.push(body.status);
  }
  if (body.end_time) {
    updates.push('end_time = ?');
    values.push(body.end_time);
    
    // Automatically calculate duration if not provided
    if (body.duration === undefined) {
      const log = await c.env.DB.prepare('SELECT start_time FROM call_logs WHERE id = ?').bind(id).first<{ start_time: string }>();
      if (log?.start_time) {
        const start = new Date(log.start_time).getTime();
        const end = new Date(body.end_time).getTime();
        body.duration = Math.floor((end - start) / 1000);
      }
    }
  }
  if (body.duration !== undefined) {
    updates.push('duration = ?');
    values.push(body.duration);
  }
  
  if (updates.length > 0) {
    values.push(id);
    await c.env.DB.prepare(`UPDATE call_logs SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }
  
  const callLog = await c.env.DB.prepare('SELECT * FROM call_logs WHERE id = ?').bind(id).first();
  return c.json({ data: callLog });
});

const dispositionSchema = z.object({
  disposition: z.string(),
  notes: z.string().optional(),
});

calls.post('/:id/disposition', zValidator('json', dispositionSchema), async (c) => {
  const id = c.req.param('id');
  const { disposition, notes } = c.req.valid('json');
  
  const callLog = await c.env.DB.prepare('SELECT lead_id, agent_id FROM call_logs WHERE id = ?').bind(id).first<{ lead_id: string | null, agent_id: string | null }>();
  if (!callLog) return c.json({ error: 'Call not found' }, 404);

  await c.env.DB.prepare('UPDATE call_logs SET disposition = ?, disposition_notes = ? WHERE id = ?')
    .bind(disposition, notes || null, id)
    .run();
    
  if (callLog.lead_id) {
     let leadStatus = 'completed';
     if (disposition === 'dnc_request') leadStatus = 'dnc';
     else if (disposition === 'callback') leadStatus = 'pending';
     else if (disposition === 'wrong_number' || disposition === 'no_answer' || disposition === 'voicemail') leadStatus = 'failed';
     
     await c.env.DB.prepare('UPDATE leads SET status = ?, updated_at = datetime("now") WHERE id = ?')
       .bind(leadStatus, callLog.lead_id)
       .run();
  }
  
  if (callLog.agent_id) {
     const result = await c.env.DB.prepare(`
       UPDATE agent_status SET status = 'available', changed_at = datetime('now')
       WHERE user_id = ? AND status = 'wrap_up'
     `).bind(callLog.agent_id).run();
     
     if (result.meta.changes > 0) {
        c.executionCtx.waitUntil((async () => {
           await new Promise(resolve => setTimeout(resolve, 3000));
           await tryDialNextLead(c.env, callLog.agent_id!);
        })());
     }
  }

  return c.json({ success: true });
});

export default calls;
