/**
 * apps/api/src/routes/agents.ts
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import {
  listAgents,
  getAgentById,
  updateAgentStatus,
  insertAgent,
  updateAgent,
} from '../db/queries';
import { generateWebrtcToken } from '../lib/telnyx';
import { tryDialNextLead } from '../dialer/engine';
import type { AgentStatus } from '@nextgendial/shared-types';

const agents = new Hono<{ Bindings: Env }>();

// Valid agent status transitions
const VALID_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  offline: ['available', 'break'],
  available: ['break', 'offline'],
  dialing: [], // engine-controlled only
  on_call: [], // engine-controlled only
  wrap_up: [], // cleared only by disposition submission
  break: ['available', 'offline'],
};

// ----------------------------------------------------------------
// GET /api/agents
// ----------------------------------------------------------------
agents.get('/', async (c) => {
  const data = await listAgents(c.env.DB);
  return c.json({ data });
});

// ----------------------------------------------------------------
// GET /api/agents/:id
// ----------------------------------------------------------------
agents.get('/:id', async (c) => {
  const agent = await getAgentById(c.env.DB, c.req.param('id'));
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  return c.json({ data: agent });
});

// ----------------------------------------------------------------
// POST /api/agents — create agent
// ----------------------------------------------------------------
const createAgentSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  telnyx_credential_id: z.string().optional(),
  telnyx_sip_username: z.string().optional(),
});

agents.post(
  '/',
  zValidator('json', createAgentSchema),
  async (c) => {
    const body = c.req.valid('json');
    const agent = await insertAgent(c.env.DB, body);
    return c.json({ data: agent }, 201);
  },
);

// ----------------------------------------------------------------
// PATCH /api/agents/:id/status
// ----------------------------------------------------------------
const updateStatusSchema = z.object({
  status: z.enum(['offline', 'available', 'dialing', 'on_call', 'wrap_up', 'break']),
});

agents.patch(
  '/:id/status',
  zValidator('json', updateStatusSchema),
  async (c) => {
    const id = c.req.param('id');
    const { status: newStatus } = c.req.valid('json');

    const agent = await getAgentById(c.env.DB, id);
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    const allowed = VALID_TRANSITIONS[agent.status] ?? [];
    if (!allowed.includes(newStatus as AgentStatus)) {
      return c.json(
        {
          error: `Cannot transition from '${agent.status}' to '${newStatus}'`,
          allowed,
        },
        422,
      );
    }

    await updateAgentStatus(c.env.DB, id, newStatus as AgentStatus);

    // Trigger the dialer asynchronously when agent goes available.
    // A dial failure must NOT fail the status-update response.
    if (newStatus === 'available') {
      c.executionCtx.waitUntil(
        tryDialNextLead(c.env, id).catch((err) =>
          console.error(`[dialer] tryDialNextLead failed for agent ${id}:`, err),
        ),
      );
    }

    const updated = await getAgentById(c.env.DB, id);
    return c.json({ data: updated });
  },
);

// ----------------------------------------------------------------
// POST /api/agents/:id/webrtc-token
// ----------------------------------------------------------------
agents.post('/:id/webrtc-token', async (c) => {
  const agent = await getAgentById(c.env.DB, c.req.param('id'));
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  if (!agent.telnyx_credential_id) {
    return c.json({ error: 'Agent has no Telnyx credential configured' }, 422);
  }

  const token = await generateWebrtcToken(c.env, agent.telnyx_credential_id);
  return c.json({ token });
});

// ----------------------------------------------------------------
// POST /api/agents/:id/provision-telnyx
// ----------------------------------------------------------------
const provisionTelnyxSchema = z.object({
  credential_id: z.string().min(1),
  sip_username: z.string().min(1),
});

agents.post(
  '/:id/provision-telnyx',
  zValidator('json', provisionTelnyxSchema),
  async (c) => {
    const id = c.req.param('id');
    const { credential_id, sip_username } = c.req.valid('json');

    const agent = await getAgentById(c.env.DB, id);
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    const updated = await updateAgent(c.env.DB, id, {
      telnyx_credential_id: credential_id,
      telnyx_sip_username: sip_username,
    });

    return c.json({ data: updated });
  },
);

export default agents;
