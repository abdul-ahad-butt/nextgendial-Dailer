import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { authMiddleware } from '../auth/middleware';

const calls = new Hono<AppEnv>();

calls.use('*', authMiddleware);

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

export default calls;
