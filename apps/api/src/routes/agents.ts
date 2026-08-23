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
    
  const user = await c.env.DB.prepare('SELECT id, username, status, telnyx_credential_id, telnyx_sip_username FROM users WHERE id = ?')
    .bind(id)
    .first();
    
  return c.json({ data: user });
});

agents.post('/:id/webrtc-token', async (c) => {
  const id = c.req.param('id');
  const user = await c.env.DB.prepare('SELECT id, username, telnyx_credential_id, telnyx_sip_username FROM users WHERE id = ?')
    .bind(id)
    .first<{ id: string, username: string, telnyx_credential_id: string, telnyx_sip_username: string }>();
    
  if (!user) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  let credentialId = user.telnyx_credential_id;

  if (!credentialId) {
    // Attempt auto-provisioning
    if (!c.env.TELNYX_API_KEY) {
      return c.json({ error: 'Missing TELNYX_API_KEY in Cloudflare Worker secrets' }, 400);
    }
    if (!c.env.TELNYX_CONNECTION_ID) {
      return c.json({ error: 'Missing TELNYX_CONNECTION_ID in Cloudflare Worker secrets' }, 400);
    }
    
    const sipUsername = user.telnyx_sip_username || `agent_${id.replace(/-/g, '')}`;
    try {
      const telnyxRes = await fetch('https://api.telnyx.com/v2/telephony_credentials', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          connection_id: c.env.TELNYX_CONNECTION_ID,
          sip_username: sipUsername,
          sip_password: crypto.randomUUID().slice(0, 16) + 'Aa1!' // Requires complexity
        })
      });
      
      if (telnyxRes.ok) {
        const telnyxData = await telnyxRes.json() as any;
        credentialId = telnyxData.data.id;
        
        // Update database with new credentials
        await c.env.DB.prepare('UPDATE users SET telnyx_credential_id = ?, telnyx_sip_username = ? WHERE id = ?')
          .bind(credentialId, sipUsername, id)
          .run();
      } else {
        const errText = await telnyxRes.text();
        console.error('[telnyx] failed to auto-provision telephony credential:', errText);
        return c.json({ error: `Telnyx auto-provisioning failed: ${errText}` }, 400);
      }
    } catch (e) {
      console.error('[telnyx] error auto-provisioning telephony credential:', e);
      return c.json({ error: 'Failed to contact Telnyx for auto-provisioning' }, 500);
    }
  }

  if (!credentialId) {
    return c.json({ error: 'Agent does not have a telephony credential' }, 400);
  }
  
  // Call Telnyx API to mint token
  const res = await fetch(`https://api.telnyx.com/v2/telephony_credentials/${credentialId}/token`, {
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
