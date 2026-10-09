import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { handleTelnyxWebhook } from '../dialer/engine';
import { normalizeToE164 } from '../utils/phone';

const webhooks = new Hono<AppEnv>();

// Note: No authMiddleware here since Telnyx is calling this endpoint

webhooks.post('/telnyx', async (c) => {
  try {
    const payload = await c.req.json();
    const eventType = payload?.data?.event_type;
    const callControlId = payload?.data?.payload?.call_control_id;
    const callState = payload?.data?.payload?.state;
    
    console.log(`[Telnyx Webhook] Event: ${eventType}, Call ID: ${callControlId}, State: ${callState}`);
    
    if (!payload?.data) {
      return c.json({ received: true });
    }

    if (eventType === 'call.recording.saved') {
      // Handle recording saved — download from Telnyx, upload to R2
      c.executionCtx.waitUntil(handleRecordingSaved(c.env, payload.data.payload));
    } else if (eventType === 'message.received') {
      // Inbound SMS/MMS reception
      c.executionCtx.waitUntil(handleInboundMessage(c.env, payload.data.payload));
    } else {
      c.executionCtx.waitUntil(handleTelnyxWebhook(c.env, payload.data));
    }

    return c.json({ received: true });
  } catch (error: any) {
    console.error('[Telnyx Webhook Error]', error);
    return c.json({ error: 'Failed to process webhook' }, 500);
  }
});

async function handleInboundMessage(
  env: AppEnv['Bindings'],
  payload: any
): Promise<void> {
  try {
    const fromRaw = payload.from?.phone_number || payload.from || '';
    const toRaw = Array.isArray(payload.to)
      ? payload.to[0]?.phone_number || payload.to[0] || ''
      : payload.to?.phone_number || payload.to || '';
    
    const fromNumber = normalizeToE164(fromRaw);
    const toNumber = normalizeToE164(toRaw);
    const bodyText = payload.text || payload.body || '';

    if (!fromNumber || !toNumber) {
      console.warn('[webhook] Inbound SMS missing from or to number:', payload);
      return;
    }

    // Lookup tenant and agent assigned to destination number in phone_inventory
    const inv = await env.DB.prepare(
      'SELECT assigned_tenant_id, assigned_agent_id FROM phone_inventory WHERE phone_number = ?'
    ).bind(toNumber).first<{ assigned_tenant_id: string | null; assigned_agent_id: string | null }>();

    let tenantId = inv?.assigned_tenant_id;
    let agentId = inv?.assigned_agent_id;

    if (!tenantId) {
      const def = await env.DB.prepare('SELECT id FROM tenants LIMIT 1').first<{ id: string }>();
      tenantId = def?.id || 'default_tenant';
    }

    const messageId = payload.id || crypto.randomUUID();

    await env.DB.prepare(`
      INSERT INTO messages (id, tenant_id, from_number, to_number, direction, body, status, agent_id, created_at)
      VALUES (?, ?, ?, ?, 'inbound', ?, 'received', ?, datetime('now'))
    `).bind(messageId, tenantId, fromNumber, toNumber, bodyText, agentId || null).run();

    console.log(`[webhook] Inbound SMS stored successfully: ${messageId} (from: ${fromNumber}, to: ${toNumber}, tenant: ${tenantId})`);
  } catch (err: any) {
    console.error('[webhook] handleInboundMessage error:', err?.message);
  }
}

async function handleRecordingSaved(
  env: AppEnv['Bindings'],
  payload: any,
): Promise<void> {
  try {
    const recordingUrl = payload.recording_urls?.wav || payload.recording_urls?.mp3;
    const ext = payload.recording_urls?.wav ? 'wav' : 'mp3';
    const callControlId: string = payload.call_control_id;
    const durationSeconds: number = Math.round(payload.duration_millis / 1000) || 0;

    if (!recordingUrl || !callControlId) {
      console.warn('[recording] Missing recording_url or call_control_id in payload');
      return;
    }

    // Lookup associated call log
    const callLog = await env.DB.prepare(
      'SELECT id, agent_id, lead_id, direction, tenant_id FROM call_logs WHERE telnyx_call_control_id = ? OR agent_leg_call_control_id = ?'
    ).bind(callControlId, callControlId).first<{ id: string; agent_id: string; lead_id: string; direction: string; tenant_id: string }>();

    let agentUsername = '';
    let destNumber = '';
    let callLogId: string | null = null;
    let direction = 'outbound';

    if (callLog) {
      callLogId = callLog.id;
      direction = callLog.direction || 'outbound';
      if (callLog.agent_id) {
        const agent = await env.DB.prepare('SELECT username FROM users WHERE id = ?')
          .bind(callLog.agent_id).first<{ username: string }>();
        if (agent) agentUsername = agent.username;
      }
      if (callLog.lead_id) {
        const lead = await env.DB.prepare('SELECT phone_number FROM leads WHERE id = ?')
          .bind(callLog.lead_id).first<{ phone_number: string }>();
        if (lead) destNumber = lead.phone_number;
      }
    }

    // Download recording from Telnyx CDN
    let audioBuffer: ArrayBuffer | null = null;
    try {
      const audioRes = await fetch(recordingUrl, {
        headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}` },
      });
      if (audioRes.ok) {
        audioBuffer = await audioRes.arrayBuffer();
      } else {
        console.error('[recording] Failed to download from Telnyx:', audioRes.status);
      }
    } catch (dlErr: any) {
      console.error('[recording] Download error:', dlErr?.message);
    }

    // Upload to R2 if download succeeded
    const r2Key = callLogId
      ? `recordings/${callLogId}.${ext}`
      : `recordings/${callControlId}.${ext}`;

    if (audioBuffer && env.RECORDINGS) {
      try {
        await env.RECORDINGS.put(r2Key, audioBuffer, {
          httpMetadata: { contentType: ext === 'wav' ? 'audio/wav' : 'audio/mpeg' },
        });
        console.log(`[recording] Uploaded to R2: ${r2Key}`);
      } catch (r2Err: any) {
        console.error('[recording] R2 upload error:', r2Err?.message);
      }
    }

    // Store recording metadata in D1
    await env.DB.prepare(`
      INSERT INTO call_recordings (id, call_control_id, call_log_id, agent_id, agent_username, destination_number, direction, duration_seconds, recording_url, r2_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      callControlId,
      callLogId,
      callLog?.agent_id || null,
      agentUsername,
      destNumber,
      direction,
      durationSeconds,
      audioBuffer ? null : recordingUrl,
      audioBuffer ? r2Key : null,
    ).run();

    if (callLogId) {
      await env.DB.prepare('UPDATE call_logs SET recording_url = ? WHERE id = ?')
        .bind(audioBuffer ? r2Key : recordingUrl, callLogId)
        .run();
    }

    console.log(`[recording] Metadata saved. call_log_id=${callLogId}, r2_key=${r2Key}`);
  } catch (err: any) {
    console.error('[recording] handleRecordingSaved failed (non-fatal):', err?.message);
  }
}

export default webhooks;
