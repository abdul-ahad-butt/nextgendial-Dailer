import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { handleTelnyxWebhook } from '../dialer/engine';

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
    } else {
      c.executionCtx.waitUntil(handleTelnyxWebhook(c.env, payload.data));
    }

    return c.json({ received: true });
  } catch (error: any) {
    console.error('[Telnyx Webhook Error]', error);
    return c.json({ error: 'Failed to process webhook' }, 500);
  }
});

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
      'SELECT id, agent_id, lead_id, direction FROM call_logs WHERE telnyx_call_control_id = ? OR agent_leg_call_control_id = ?'
    ).bind(callControlId, callControlId).first<{ id: string; agent_id: string; lead_id: string; direction: string }>();

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
    } else if (!env.RECORDINGS) {
      console.warn('[recording] RECORDINGS R2 binding not configured — skipping R2 upload. Falling back to Telnyx URL.');
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
      audioBuffer ? null : recordingUrl, // only use Telnyx URL as fallback
      audioBuffer ? r2Key : null,
    ).run();

    // Also update call_logs.recording_url for quick access
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
