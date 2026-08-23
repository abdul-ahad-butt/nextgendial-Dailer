import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { authMiddleware } from '../auth/middleware';

const agents = new Hono<AppEnv>();

// Require authentication for all agents routes
agents.use('*', authMiddleware);

agents.get('/:id', async (c) => {
  const id = c.req.param('id');
  
  // Self-Healing Schema Guard for new columns
  try { await c.env.DB.prepare("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'offline';").run(); } catch (e) {}
  try { await c.env.DB.prepare("ALTER TABLE users ADD COLUMN telnyx_credential_id TEXT;").run(); } catch (e) {}
  try { await c.env.DB.prepare("ALTER TABLE users ADD COLUMN telnyx_sip_username TEXT;").run(); } catch (e) {}

  const user = await c.env.DB.prepare('SELECT id, username, status, telnyx_credential_id, telnyx_sip_username FROM users WHERE id = ?')
    .bind(id)
    .first();
  if (!user) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  return c.json({ data: user });
});

agents.patch('/:id/status', zValidator('json', z.object({ status: z.string() })), async (c) => {
  const id = c.req.param('id');
  const { status } = c.req.valid('json');
  
  await c.env.DB.prepare('UPDATE users SET status = ? WHERE id = ?')
    .bind(status, id)
    .run();
    
  return c.json({ data: { status } });
});

agents.post('/:id/webrtc-token', async (c) => {
  const id = c.req.param('id');
  const user = await c.env.DB.prepare('SELECT telnyx_credential_id FROM users WHERE id = ?')
    .bind(id)
    .first<{ telnyx_credential_id: string }>();
    
  if (!user || !user.telnyx_credential_id) {
    return c.json({ error: 'Agent does not have a telephony credential' }, 400);
  }
  
  // Call Telnyx API to mint token
  const res = await fetch(`https://api.telnyx.com/v2/telephony_credentials/${user.telnyx_credential_id}/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.TELNYX_API_KEY}`,
      'Accept': 'application/json'
    }
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    console.error('[telnyx] failed to generate token:', errorText);
    return c.json({ error: 'Failed to generate WebRTC token' }, 500);
  }
  
  const telnyxData = await res.json() as any;
  return c.json({ token: telnyxData.data });
});

export default agents;
