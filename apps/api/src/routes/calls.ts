/**
 * apps/api/src/routes/calls.ts
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import {
  listCallLogs,
  getCallLogById,
  insertCallLog,
  updateCallLog,
  getLeadById,
  updateLeadStatus,
  getAgentById,
  updateAgentStatus,
} from '../db/queries';
import { hangupCall } from '../lib/telnyx';
import { tryDialNextLead } from '../dialer/engine';
import type { Disposition } from '@nextgendial/shared-types';

const calls = new Hono<{ Bindings: Env }>();

// ----------------------------------------------------------------
// GET /api/calls?agent_id=&campaign_id=&from=&to=&telnyx_call_control_id=
// ----------------------------------------------------------------
calls.get('/', async (c) => {
  const { agent_id, campaign_id, from, to, telnyx_call_control_id, page, limit } =
    c.req.query();

  const result = await listCallLogs(c.env.DB, {
    agent_id,
    campaign_id,
    telnyx_call_control_id,
    from,
    to,
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? Math.min(parseInt(limit, 10), 200) : 50,
  });

  return c.json({
    data: result.data,
    total: result.total,
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 50,
  });
});

// ----------------------------------------------------------------
// GET /api/calls/:id
// ----------------------------------------------------------------
calls.get('/:id', async (c) => {
  const log = await getCallLogById(c.env.DB, c.req.param('id'));
  if (!log) return c.json({ error: 'Call log not found' }, 404);
  return c.json({ data: log });
});

// ----------------------------------------------------------------
// POST /api/calls/:id/disposition
// ----------------------------------------------------------------
const dispositionSchema = z.object({
  disposition: z.enum([
    'sale',
    'callback',
    'not_interested',
    'wrong_number',
    'voicemail',
    'no_answer',
    'dnc_request',
  ]),
  notes: z.string().optional(),
});

calls.post(
  '/:id/disposition',
  zValidator('json', dispositionSchema),
  async (c) => {
    const id = c.req.param('id');
    const { disposition, notes } = c.req.valid('json');

    const log = await getCallLogById(c.env.DB, id);
    if (!log) return c.json({ error: 'Call log not found' }, 404);
    if (!log.agent_id) return c.json({ error: 'Call log has no linked agent' }, 422);

    // 1. Update the call log with disposition
    await updateCallLog(c.env.DB, id, {
      disposition: disposition as Disposition,
      disposition_notes: notes ?? null,
    });

    // 2. Update the lead status based on disposition
    if (log.lead_id) {
      const lead = await getLeadById(c.env.DB, log.lead_id);
      if (lead) {
        if (disposition === 'dnc_request') {
          await updateLeadStatus(c.env.DB, log.lead_id, 'dnc');
          await c.env.DB
            .prepare('UPDATE leads SET do_not_call = 1, updated_at = ? WHERE id = ?')
            .bind(new Date().toISOString().slice(0, 19).replace('T', ' '), log.lead_id)
            .run();
        } else if (disposition === 'sale' || disposition === 'not_interested') {
          await updateLeadStatus(c.env.DB, log.lead_id, 'completed');
        } else if (disposition === 'callback') {
          await updateLeadStatus(c.env.DB, log.lead_id, 'pending');
        }
        // Other dispositions leave lead status as-is (contacted)
      }
    }

    // 3. Flip agent from wrap_up → available
    const agent = await getAgentById(c.env.DB, log.agent_id);
    if (agent && agent.status === 'wrap_up') {
      await updateAgentStatus(c.env.DB, log.agent_id, 'available');

      // 4. Re-trigger dialer loop — agent is free for the next call
      c.executionCtx.waitUntil(
        tryDialNextLead(c.env, log.agent_id).catch((err) =>
          console.error(`[dialer] post-disposition dial failed for agent ${log.agent_id}:`, err),
        ),
      );
    }

    return c.json({ success: true });
  },
);

// ----------------------------------------------------------------
// POST /api/calls/manual — log an ad-hoc dialpad call
// ----------------------------------------------------------------
const manualCallSchema = z.object({
  agentId: z.string().uuid(),
  phoneNumber: z.string(),
  leadId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  telnyx_call_control_id: z.string().optional(),
});

calls.post(
  '/manual',
  zValidator('json', manualCallSchema),
  async (c) => {
    const { agentId, phoneNumber, leadId, campaignId, telnyx_call_control_id } =
      c.req.valid('json');

    const log = await insertCallLog(c.env.DB, {
      agent_id: agentId,
      lead_id: leadId ?? null,
      campaign_id: campaignId ?? null,
      direction: 'outbound',
      status: 'initiated',
    });

    // If the frontend already has a call_control_id (from the SDK), link it now
    if (telnyx_call_control_id) {
      await updateCallLog(c.env.DB, log.id, { telnyx_call_control_id });
    }

    return c.json({ data: { ...log, telnyx_call_control_id: telnyx_call_control_id ?? null } }, 201);
  },
);

// ----------------------------------------------------------------
// POST /api/calls/:id/hangup — agent-initiated hangup
// ----------------------------------------------------------------
calls.post('/:id/hangup', async (c) => {
  const log = await getCallLogById(c.env.DB, c.req.param('id'));
  if (!log) return c.json({ error: 'Call log not found' }, 404);
  if (!log.telnyx_call_control_id) {
    return c.json({ error: 'Call has no call_control_id to hang up' }, 422);
  }

  // Hangup the lead leg — Telnyx will hangup both bridged legs automatically
  await hangupCall(c.env, log.telnyx_call_control_id);

  return c.json({ success: true });
});

export default calls;
