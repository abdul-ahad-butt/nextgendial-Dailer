/**
 * apps/api/src/routes/campaigns.ts
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import {
  listCampaigns,
  getCampaignById,
  insertCampaign,
  updateCampaign,
} from '../db/queries';

const campaigns = new Hono<{ Bindings: Env }>();

// ----------------------------------------------------------------
// GET /api/campaigns
// ----------------------------------------------------------------
campaigns.get('/', async (c) => {
  const data = await listCampaigns(c.env.DB);
  return c.json({ data });
});

// ----------------------------------------------------------------
// GET /api/campaigns/:id
// ----------------------------------------------------------------
campaigns.get('/:id', async (c) => {
  const campaign = await getCampaignById(c.env.DB, c.req.param('id'));
  if (!campaign) return c.json({ error: 'Campaign not found' }, 404);
  return c.json({ data: campaign });
});

// ----------------------------------------------------------------
// POST /api/campaigns
// ----------------------------------------------------------------
const createCampaignSchema = z.object({
  name: z.string().min(1),
  caller_id_number: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Must be E.164 format'),
  dial_ratio: z.number().min(1).max(10).optional(),
  max_attempts_per_lead: z.number().int().min(1).max(20).optional(),
  retry_delay_minutes: z.number().int().min(1).optional(),
  script: z.string().optional(),
});

campaigns.post(
  '/',
  zValidator('json', createCampaignSchema),
  async (c) => {
    const body = c.req.valid('json');
    const campaign = await insertCampaign(c.env.DB, body);
    return c.json({ data: campaign }, 201);
  },
);

// ----------------------------------------------------------------
// PATCH /api/campaigns/:id
// ----------------------------------------------------------------
const updateCampaignSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['active', 'paused', 'completed']).optional(),
  caller_id_number: z.string().regex(/^\+[1-9]\d{1,14}$/).optional(),
  dial_ratio: z.number().min(1).max(10).optional(),
  max_attempts_per_lead: z.number().int().min(1).max(20).optional(),
  retry_delay_minutes: z.number().int().min(1).optional(),
  script: z.string().nullable().optional(),
});

campaigns.patch(
  '/:id',
  zValidator('json', updateCampaignSchema),
  async (c) => {
    const id = c.req.param('id');
    const existing = await getCampaignById(c.env.DB, id);
    if (!existing) return c.json({ error: 'Campaign not found' }, 404);

    const body = c.req.valid('json');
    const updated = await updateCampaign(c.env.DB, id, body);
    return c.json({ data: updated });
  },
);

export default campaigns;
