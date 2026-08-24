import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { handleTelnyxWebhook } from '../dialer/engine';

const webhooks = new Hono<AppEnv>();

// Note: No authMiddleware here since Telnyx is calling this endpoint

webhooks.post('/telnyx', async (c) => {
  // Ideally, verify the Telnyx signature here using c.env.TELNYX_PUBLIC_KEY
  // See https://developers.telnyx.com/docs/api/v2/overview/webhooks for signature verification details.
  
  try {
    const payload = await c.req.json();
    const eventType = payload?.data?.event_type;
    const callControlId = payload?.data?.payload?.call_control_id;
    const callState = payload?.data?.payload?.state;
    
    console.log(`[Telnyx Webhook] Event: ${eventType}, Call ID: ${callControlId}, State: ${callState}`);
    
    // Dispatch to dialer engine for pacing and state machine updates
    if (payload?.data) {
      c.executionCtx.waitUntil(handleTelnyxWebhook(c.env, payload.data));
    }

    return c.json({ received: true });
  } catch (error: any) {
    console.error('[Telnyx Webhook Error]', error);
    return c.json({ error: 'Failed to process webhook' }, 500);
  }
});

export default webhooks;
