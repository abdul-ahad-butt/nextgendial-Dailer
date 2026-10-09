/**
 * apps/api/src/routes/messages.ts
 *
 * Two-way SMS messaging endpoints:
 *  - GET /api/messages — fetch message history or conversation threads
 *  - POST /api/messages — send outbound SMS with credit deduction
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { authMiddleware } from '../auth/middleware';
import { normalizeToE164, isValidE164 } from '../utils/phone';
import { sendTelnyxSMS } from '../services/telnyx';
import { deductSmsCredits, getTenantBalance } from '../services/creditEngine';

const messages = new Hono<AppEnv>();

messages.use('*', authMiddleware);

// ----------------------------------------------------------------
// GET /messages — List messages or thread by phone number
// ----------------------------------------------------------------
messages.get('/', async (c) => {
  const { phone_number, limit = '50', page = '1' } = c.req.query();
  const userId = c.get('userId');
  const role = c.get('role');
  let tenantId = c.get('tenantId');

  // Resolve tenantId if not already present
  if (!tenantId) {
    const user = await c.env.DB.prepare('SELECT tenant_id FROM users WHERE id = ?')
      .bind(userId)
      .first<{ tenant_id: string | null }>();
    tenantId = user?.tenant_id || undefined;
  }

  if (!tenantId && role !== 'super_admin') {
    return c.json({ error: 'Tenant context required' }, 403);
  }

  const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limitNum;

  const conditions: string[] = [];
  const params: any[] = [];

  if (tenantId) {
    conditions.push('tenant_id = ?');
    params.push(tenantId);
  }

  if (phone_number) {
    const norm = normalizeToE164(phone_number);
    conditions.push('(from_number = ? OR to_number = ?)');
    params.push(norm, norm);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { results } = await c.env.DB.prepare(`
    SELECT id, tenant_id, from_number, to_number, direction, body, status, agent_id, created_at
    FROM messages
    ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limitNum, offset).all();

  const total = await c.env.DB.prepare(`
    SELECT COUNT(*) as cnt FROM messages ${where}
  `).bind(...params).first<{ cnt: number }>();

  return c.json({
    data: (results || []).reverse(), // chronologically ascending for chat views
    total: total?.cnt ?? 0,
    page: parseInt(page, 10) || 1,
    limit: limitNum,
  });
});

// ----------------------------------------------------------------
// POST /messages — Send Outbound SMS
// ----------------------------------------------------------------
const sendMessageSchema = z.object({
  to: z.string().min(1),
  from: z.string().optional(),
  body: z.string().min(1),
});

messages.post('/', zValidator('json', sendMessageSchema), async (c) => {
  const { to, from, body } = c.req.valid('json');
  const userId = c.get('userId');
  let tenantId = c.get('tenantId');

  // Resolve user info
  const user = await c.env.DB.prepare(
    'SELECT tenant_id, assigned_phone_number FROM users WHERE id = ?'
  ).bind(userId).first<{ tenant_id: string | null; assigned_phone_number: string | null }>();

  if (!tenantId) {
    tenantId = user?.tenant_id || undefined;
  }

  if (!tenantId) {
    return c.json({ error: 'Tenant organization context required to send SMS' }, 403);
  }

  // Determine sender number: specified 'from' > user assigned > tenant number
  let senderNumber = from ? normalizeToE164(from) : user?.assigned_phone_number;
  if (!senderNumber) {
    const tenantNum = await c.env.DB.prepare(
      'SELECT phone_number FROM phone_inventory WHERE assigned_tenant_id = ? LIMIT 1'
    ).bind(tenantId).first<{ phone_number: string }>();
    senderNumber = tenantNum?.phone_number || c.env.TELNYX_DEFAULT_NUMBER || '+19564461280';
  }

  const recipientNumber = normalizeToE164(to);
  if (!isValidE164(recipientNumber)) {
    return c.json({ error: `Invalid recipient phone number format: ${to}` }, 400);
  }

  // Pre-flight Credit Check:
  const balance = await getTenantBalance(c.env.DB, tenantId);
  if (!balance || balance.remaining_balance < 0.0075) {
    return c.json({
      error: 'INSUFFICIENT_CREDITS: Balance too low to send SMS. Please contact Super Admin.',
    }, 402);
  }

  // Send through Telnyx REST API
  const telnyxRes = await sendTelnyxSMS(c.env.TELNYX_API_KEY, {
    from: senderNumber,
    to: recipientNumber,
    text: body,
  });

  if (!telnyxRes.success) {
    return c.json({ error: telnyxRes.error || 'Failed to dispatch SMS via Telnyx' }, 502);
  }

  const messageId = telnyxRes.id || crypto.randomUUID();

  // Deduct SMS credit from tenant balance & log in credit_ledger
  await deductSmsCredits(c.env.DB, {
    tenantId,
    messageId,
  });

  // Store in messages table
  await c.env.DB.prepare(`
    INSERT INTO messages (id, tenant_id, from_number, to_number, direction, body, status, agent_id, created_at)
    VALUES (?, ?, ?, ?, 'outbound', ?, 'sent', ?, datetime('now'))
  `).bind(messageId, tenantId, senderNumber, recipientNumber, body, userId).run();

  const createdMessage = await c.env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(messageId).first();

  return c.json({ success: true, data: createdMessage }, 201);
});

export default messages;
