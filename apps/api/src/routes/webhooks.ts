/**
 * apps/api/src/routes/webhooks.ts
 *
 * Telnyx sends signed POST requests to this endpoint for every call-leg event.
 *
 * Critical rule: read the raw body as text FIRST before any JSON.parse(),
 * because the signature is computed over the exact raw bytes. Any intermediate
 * parsing or re-serialisation will produce a different byte sequence and
 * fail signature verification.
 *
 * Return 200 immediately — Telnyx marks a webhook as failed if no 2xx is
 * received within a few seconds, and will retry with exponential backoff.
 * Heavy processing happens via handleTelnyxWebhook (async, no block on 200).
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { verifyTelnyxSignature } from '../lib/telnyx';
import { handleTelnyxWebhook } from '../dialer/engine';
import type { TelnyxWebhookEvent } from '@nextgendial/shared-types';

const webhooks = new Hono<{ Bindings: Env }>();

webhooks.post('/telnyx', async (c) => {
  // 1. Read the raw body as text — MUST happen before any other body read
  const rawBody = await c.req.text();

  // 2. Extract signature headers
  const signatureB64 = c.req.header('telnyx-signature-ed25519');
  const timestamp = c.req.header('telnyx-timestamp');

  if (!signatureB64 || !timestamp) {
    return c.json({ error: 'Missing signature headers' }, 401);
  }

  // 3. Verify the Ed25519 signature + timestamp freshness
  const valid = await verifyTelnyxSignature(
    rawBody,
    signatureB64,
    timestamp,
    c.env.TELNYX_PUBLIC_KEY,
  );

  if (!valid) {
    console.warn('[webhook] Telnyx signature verification failed');
    return c.json({ error: 'Invalid signature' }, 401);
  }

  // 4. Parse the verified body
  let event: TelnyxWebhookEvent;
  try {
    event = JSON.parse(rawBody) as TelnyxWebhookEvent;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // 5. Delegate to the dialer engine asynchronously.
  //    waitUntil keeps the Worker alive until processing completes
  //    without blocking the 200 response back to Telnyx.
  c.executionCtx.waitUntil(
    handleTelnyxWebhook(c.env, event.data).catch((err) =>
      console.error('[webhook] handleTelnyxWebhook error:', err),
    ),
  );

  // 6. Always return 200 immediately — Telnyx needs a fast ack
  return c.json({ received: true });
});

export default webhooks;
