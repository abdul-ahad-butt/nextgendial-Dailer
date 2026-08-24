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
  
  // Calculate time spent in previous state if agent_status exists
  const previousStatusRow = await c.env.DB.prepare('SELECT status, changed_at FROM agent_status WHERE user_id = ?').bind(id).first<{ status: string, changed_at: string }>();
  
  if (previousStatusRow && previousStatusRow.changed_at) {
    const changedAtMs = new Date(previousStatusRow.changed_at).getTime();
    const nowMs = Date.now();
    const diffSeconds = Math.max(0, Math.floor((nowMs - changedAtMs) / 1000));
    
    // Ensure an activity log row exists for today
    await c.env.DB.prepare(`
      INSERT INTO agent_activity_logs (id, agent_id, date) 
      VALUES (?, ?, date('now'))
      ON CONFLICT(agent_id, date) DO NOTHING
    `).bind(crypto.randomUUID(), id).run();

    if (['available', 'dialing', 'on_call', 'wrap_up'].includes(previousStatusRow.status)) {
      await c.env.DB.prepare(`
        UPDATE agent_activity_logs SET total_active_seconds = total_active_seconds + ? 
        WHERE agent_id = ? AND date = date('now')
      `).bind(diffSeconds, id).run();
    } else if (previousStatusRow.status === 'break') {
      await c.env.DB.prepare(`
        UPDATE agent_activity_logs SET total_break_seconds = total_break_seconds + ? 
        WHERE agent_id = ? AND date = date('now')
      `).bind(diffSeconds, id).run();
    }
  }

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(status, id),
    c.env.DB.prepare(`
      INSERT INTO agent_status (user_id, status, changed_at) 
      VALUES (?, ?, datetime('now')) 
      ON CONFLICT(user_id) DO UPDATE SET status = ?, changed_at = datetime('now')
    `).bind(id, status, status)
  ]);
    
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
    const rawApiKey = c.env.TELNYX_API_KEY;
    if (!rawApiKey) {
      console.warn('[telnyx] Missing TELNYX_API_KEY in Cloudflare Worker secrets');
      return c.json({ error: 'MISSING_TELNYX_CREDENTIALS', status: 400 }, 200);
    }
    const apiKey = rawApiKey.trim().replace(/^["']|["']$/g, '');

    if (!c.env.TELNYX_CONNECTION_ID) {
      console.warn('[telnyx] Missing TELNYX_CONNECTION_ID in Cloudflare Worker secrets');
      return c.json({ error: 'MISSING_TELNYX_CREDENTIALS', status: 400 }, 200);
    }
    
    const sipUsername = user.telnyx_sip_username || `agent_${id.replace(/-/g, '')}`;
    try {
      const telnyxRes = await fetch('https://api.telnyx.com/v2/telephony_credentials', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
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
        
        if (errText.includes('malformed') || errText.includes('Authentication failed')) {
          return c.json({ error: 'INVALID_TELNYX_API_KEY', status: 400 }, 200);
        }
        return c.json({ error: `Telnyx auto-provisioning failed: ${errText}`, status: 400 }, 200);
      }
    } catch (e) {
      console.error('[telnyx] error auto-provisioning telephony credential:', e);
      return c.json({ error: 'Failed to contact Telnyx for auto-provisioning', status: 500 }, 200);
    }
  }

  if (!credentialId) {
    return c.json({ error: 'Agent does not have a telephony credential' }, 400);
  }
  
  const rawApiKey = c.env.TELNYX_API_KEY;
  if (!rawApiKey) {
    return c.json({ error: 'MISSING_TELNYX_CREDENTIALS', status: 400 }, 200);
  }
  const apiKey = rawApiKey.trim().replace(/^["']|["']$/g, '');

  // Call Telnyx API to mint token
  const res = await fetch(`https://api.telnyx.com/v2/telephony_credentials/${credentialId}/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json'
    }
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    console.error('[telnyx] failed to generate token:', errorText);
    if (errorText.includes('malformed') || errorText.includes('Authentication failed')) {
      return c.json({ error: 'INVALID_TELNYX_API_KEY', status: 400 }, 200);
    }
    return c.json({ error: 'Failed to generate WebRTC token', status: 500 }, 200);
  }
  
  const textRes = await res.text();
  
  let tokenData = textRes;
  try {
    const parsed = JSON.parse(textRes);
    tokenData = parsed.data || parsed.token || parsed;
  } catch (e) {
    // Expected behavior: Telnyx returns raw JWT string (eyJ...) which isn't valid JSON
  }

  return c.json({ token: tokenData });
});

export default agents;
