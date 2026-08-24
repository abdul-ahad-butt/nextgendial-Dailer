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
      if (eventType === 'call.recording.saved') {
        // Handle recording saved locally
        const recordingUrl = payload.data.payload.recording_urls?.wav || payload.data.payload.recording_urls?.mp3;
        const callControlId = payload.data.payload.call_control_id;
        if (recordingUrl && callControlId) {
          const callLog = await c.env.DB.prepare(
            'SELECT agent_id, lead_id FROM call_logs WHERE telnyx_call_control_id = ? OR agent_leg_call_control_id = ?'
          ).bind(callControlId, callControlId).first<{ agent_id: string, lead_id: string }>();
          
          if (callLog) {
            let agentUsername = '';
            let destNumber = '';
            let durationSeconds = 0;
            
            if (callLog.agent_id) {
               const agent = await c.env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(callLog.agent_id).first<{username: string}>();
               if (agent) agentUsername = agent.username;
            }
            if (callLog.lead_id) {
               const lead = await c.env.DB.prepare('SELECT phone_number FROM leads WHERE id = ?').bind(callLog.lead_id).first<{phone_number: string}>();
               if (lead) destNumber = lead.phone_number;
            }
            
            await c.env.DB.prepare(`
              INSERT INTO call_recordings (id, call_control_id, agent_id, agent_username, destination_number, duration_seconds, recording_url)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(crypto.randomUUID(), callControlId, callLog.agent_id || null, agentUsername, destNumber, durationSeconds, recordingUrl).run();
          }
        }
      } else {
        c.executionCtx.waitUntil(handleTelnyxWebhook(c.env, payload.data));
      }
    }

    return c.json({ received: true });
  } catch (error: any) {
    console.error('[Telnyx Webhook Error]', error);
    return c.json({ error: 'Failed to process webhook' }, 500);
  }
});

export default webhooks;
