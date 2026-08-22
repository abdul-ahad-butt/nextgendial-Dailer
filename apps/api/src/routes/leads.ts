/**
 * apps/api/src/routes/leads.ts
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import {
  listLeads,
  getLeadById,
  insertLead,
  updateLead,
} from '../db/queries';

const leads = new Hono<{ Bindings: Env }>();

const e164 = z.string().regex(/^\+[1-9]\d{1,14}$/, 'Must be E.164 format');

// ----------------------------------------------------------------
// GET /api/leads?campaign_id=&status=&page=&limit=
// ----------------------------------------------------------------
leads.get('/', async (c) => {
  const { campaign_id, status, page, limit } = c.req.query();
  const result = await listLeads(c.env.DB, {
    campaign_id,
    status,
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
// GET /api/leads/:id
// ----------------------------------------------------------------
leads.get('/:id', async (c) => {
  const lead = await getLeadById(c.env.DB, c.req.param('id'));
  if (!lead) return c.json({ error: 'Lead not found' }, 404);
  return c.json({ data: lead });
});

// ----------------------------------------------------------------
// POST /api/leads — single lead
// ----------------------------------------------------------------
const createLeadSchema = z.object({
  campaign_id: z.string().uuid(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone_number: e164,
  timezone: z.string().optional(),
  consent_on_file: z.boolean().optional(),
  custom_fields: z.record(z.unknown()).optional(),
});

leads.post(
  '/',
  zValidator('json', createLeadSchema),
  async (c) => {
    const body = c.req.valid('json');
    const lead = await insertLead(c.env.DB, {
      ...body,
      consent_on_file: body.consent_on_file ? 1 : 0,
      custom_fields: body.custom_fields
        ? JSON.stringify(body.custom_fields)
        : null,
    });
    return c.json({ data: lead }, 201);
  },
);

// ----------------------------------------------------------------
// POST /api/leads/bulk — batch import (CSV flows)
// ----------------------------------------------------------------
const bulkCreateSchema = z.object({
  leads: z.array(createLeadSchema).min(1).max(5000),
});

leads.post(
  '/bulk',
  zValidator('json', bulkCreateSchema),
  async (c) => {
    const { leads: leadsData } = c.req.valid('json');

    // D1 batch API: execute all inserts in a single round-trip
    const stmts = leadsData.map((l) => {
      const id = crypto.randomUUID();
      return c.env.DB.prepare(
        `INSERT INTO leads
           (id, campaign_id, first_name, last_name, phone_number, timezone, consent_on_file, custom_fields)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        l.campaign_id,
        l.first_name ?? null,
        l.last_name ?? null,
        l.phone_number,
        l.timezone ?? null,
        l.consent_on_file ? 1 : 0,
        l.custom_fields ? JSON.stringify(l.custom_fields) : null,
      );
    });

    await c.env.DB.batch(stmts);
    return c.json({ inserted: leadsData.length }, 201);
  },
);

// ----------------------------------------------------------------
// PATCH /api/leads/:id
// ----------------------------------------------------------------
const updateLeadSchema = z.object({
  do_not_call: z.boolean().optional(),
  status: z.enum(['pending', 'dialing', 'contacted', 'completed', 'failed', 'dnc']).optional(),
  next_attempt_at: z.string().datetime().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
});

leads.patch(
  '/:id',
  zValidator('json', updateLeadSchema),
  async (c) => {
    const id = c.req.param('id');
    const existing = await getLeadById(c.env.DB, id);
    if (!existing) return c.json({ error: 'Lead not found' }, 404);

    const body = c.req.valid('json');
    const updated = await updateLead(c.env.DB, id, {
      ...body,
      do_not_call: body.do_not_call !== undefined ? (body.do_not_call ? 1 : 0) : undefined,
    });
    return c.json({ data: updated });
  },
);

export default leads;
