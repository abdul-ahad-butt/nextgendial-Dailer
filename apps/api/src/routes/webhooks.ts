import { Hono } from 'hono';
import type { AppEnv } from '../types';

const webhooks = new Hono<AppEnv>();

// Note: No authMiddleware here since Telnyx is calling this endpoint

webhooks.post('/telnyx', async (c) => {
  // Ideally, verify the Telnyx signature here using c.env.TELNYX_PUBLIC_KEY
  // See https://developers.telnyx.com/docs/api/v2/overview/webhooks for signature verification details.
  
  // For now, we'll just log and acknowledge the webhook event.
  try {
    const payload = await c.req.json();
    const eventType = payload?.data?.event_type;
    const callControlId = payload?.data?.payload?.call_control_id;
    const callState = payload?.data?.payload?.state;
    
    console.log(`[Telnyx Webhook] Event: ${eventType}, Call ID: ${callControlId}, State: ${callState}`);
    
    // TODO: Update D1 database with call status/duration if needed based on event type.

    return c.json({ received: true });
  } catch (error: any) {
    console.error('[Telnyx Webhook Error]', error);
    return c.json({ error: 'Failed to process webhook' }, 500);
  }
});

export default webhooks;
