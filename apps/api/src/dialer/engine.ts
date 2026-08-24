/**
 * apps/api/src/dialer/engine.ts
 *
 * The pacing loop for the NextGenDial auto-dialer.
 *
 * This module is intentionally stateless — every call re-reads from D1
 * and issues Telnyx API calls, so it's safe to run across multiple
 * Workers isolates and tolerates webhook redelivery gracefully.
 *
 * Two public exports:
 *   - tryDialNextLead(env, agentId) — called when an agent goes 'available'
 *   - handleTelnyxWebhook(env, event) — called from the webhook route
 *
 * The closed-loop flow:
 *   agent → available
 *     → tryDialNextLead → dials lead (AMD premium)
 *       → call.machine.premium.detection.ended (human)
 *         → dial agent WebRTC leg
 *           → call.answered (agent leg)
 *             → bridgeCalls
 *               → call.hangup (either leg)
 *                 → status = completed, agent → wrap_up
 *                   → /calls/:id/disposition (separate route)
 *                     → agent → available → loop
 */

import type { Env } from '../types';
import type { TelnyxWebhookEvent } from '@nextgendial/shared-types';
import {
  claimAgentForDialing,
  getAgentById,
  updateAgentStatus,
  getNextDialableLead,
  incrementLeadAttempt,
  updateLeadStatus,
  requeueLead,
  insertCallLog,
  updateCallLog,
  getCallLogByControlId,
  getCallLogByAgentLegControlId,
  getCallLogById,
  getCampaignById,
} from '../db/queries';
import {
  dialNumber,
  bridgeCalls,
  hangupCall,
} from '../lib/telnyx';
import { encodeClientState, decodeClientState } from '../lib/clientState';

// ----------------------------------------------------------------
// tryDialNextLead
// ----------------------------------------------------------------

/**
 * Find the next eligible lead and initiate an outbound call for the
 * given agent. The agent must already be in 'available' status.
 *
 * Race-safety: uses an atomic CAS (compare-and-swap) UPDATE to claim
 * the agent, so concurrent triggers (e.g. duplicate webhook delivery)
 * don't double-dial.
 */
export async function tryDialNextLead(env: Env, agentId: string): Promise<void> {
  // Step 1: Atomically claim the agent (available → dialing)
  const claimed = await claimAgentForDialing(env.DB, agentId);
  if (!claimed) {
    // Another trigger already claimed this agent; bail out
    console.log(`[dialer] Agent ${agentId} already claimed — skipping`);
    return;
  }

  let leadId: string | null = null;

  try {
    // Step 2: Find next dialable lead across all active campaigns
    const leadWithCampaign = await getNextDialableLead(env.DB);

    if (!leadWithCampaign) {
      // No leads available right now — revert agent to available
      console.log(`[dialer] No dialable leads found — agent ${agentId} reverted to available`);
      await updateAgentStatus(env.DB, agentId, 'available');
      return;
    }

    const { campaign, ...lead } = leadWithCampaign;
    leadId = lead.id;

    // Step 3: Mark lead as dialing and increment attempt counter
    await incrementLeadAttempt(env.DB, lead.id);

    // Step 4: Create a call_logs row
    const callLog = await insertCallLog(env.DB, {
      lead_id: lead.id,
      agent_id: agentId,
      campaign_id: campaign.id,
      direction: 'outbound',
      status: 'initiated',
    });

    // Link the call log to the agent's current_call_log_id
    await env.DB
      .prepare('UPDATE agents SET current_call_log_id = ?, updated_at = ? WHERE id = ?')
      .bind(callLog.id, nowStr(), agentId)
      .run();

    // Step 5: Build client_state and dial the lead
    const clientState = encodeClientState({
      leg: 'lead',
      leadId: lead.id,
      agentId,
      campaignId: campaign.id,
      callLogId: callLog.id,
    });

    const callControlId = await dialNumber(env, {
      to: lead.phone_number,
      from: campaign.caller_id_number,
      connectionId: env.TELNYX_CONNECTION_ID,
      webhookUrl: `${env.APP_BASE_URL}/api/webhooks/telnyx`,
      clientState,
      answeringMachineDetection: 'premium',
      record: 'record-from-answer',
    });

    // Step 6: Store the call_control_id on the call log
    await updateCallLog(env.DB, callLog.id, {
      telnyx_call_control_id: callControlId,
    });

    console.log(
      `[dialer] Dialing lead ${lead.id} (${lead.phone_number}) for agent ${agentId} — ccid: ${callControlId}`,
    );
  } catch (err) {
    console.error(`[dialer] tryDialNextLead error for agent ${agentId}:`, err);
    // Ensure agent doesn't get stuck in 'dialing' state on error
    await updateAgentStatus(env.DB, agentId, 'available');
    // Revert lead to pending if we managed to mark it
    if (leadId) {
      await updateLeadStatus(env.DB, leadId, 'pending').catch(() => {});
    }
  }
}

// ----------------------------------------------------------------
// handleTelnyxWebhook
// ----------------------------------------------------------------

/**
 * Dispatch Telnyx call events to the appropriate handler.
 * All branches are idempotent — they guard on current DB state before
 * writing, so duplicate webhook delivery is safe.
 */
export async function handleTelnyxWebhook(
  env: Env,
  event: TelnyxWebhookEvent['data'],
): Promise<void> {
  const { event_type, payload } = event;

  console.log(`[webhook] ${event_type} ccid=${payload.call_control_id}`);

  switch (event_type) {
    case 'call.initiated':
      // No-op: call log already exists from tryDialNextLead
      break;

    case 'call.machine.premium.detection.ended':
      await handleAmdResult(env, payload);
      break;

    case 'call.answered':
      await handleCallAnswered(env, payload);
      break;

    case 'call.bridged':
      await handleCallBridged(env, payload);
      break;

    case 'call.hangup':
      await handleCallHangup(env, payload);
      break;

    default:
      console.log(`[webhook] Unhandled event type: ${event_type}`);
  }
}

// ----------------------------------------------------------------
// AMD Result Handler
// ----------------------------------------------------------------

async function handleAmdResult(
  env: Env,
  payload: TelnyxWebhookEvent['data']['payload'],
): Promise<void> {
  if (!payload.client_state) return;

  const state = decodeClientState(payload.client_state);
  if (state.leg !== 'lead') return;

  const result = payload.result;

  if (result === 'human') {
    // Human detected — now dial the agent's WebRTC leg
    await dialAgentLeg(env, state, payload.call_control_id);
  } else {
    // Machine, not_sure, or silence — treat conservatively as voicemail
    console.log(`[dialer] AMD: ${result} for lead ${state.leadId} — hanging up`);

    // Hangup the lead leg
    await hangupCall(env, payload.call_control_id).catch((err) =>
      console.error('[dialer] AMD hangup error:', err),
    );

    // Mark call log as voicemail
    const callLog = await getCallLogById(env.DB, state.callLogId);
    if (callLog && callLog.status !== 'voicemail') {
      await updateCallLog(env.DB, state.callLogId, {
        status: 'voicemail',
        ended_at: nowStr(),
      });
    }

    // Requeue or fail the lead
    const campaign = await getCampaignById(env.DB, state.campaignId);
    if (campaign) {
      const lead = await env.DB
        .prepare('SELECT attempts FROM leads WHERE id = ?')
        .bind(state.leadId)
        .first<{ attempts: number }>();

      if (lead) {
        await requeueLead(
          env.DB,
          state.leadId,
          campaign.retry_delay_minutes,
          campaign.max_attempts_per_lead,
          lead.attempts,
        );
      }
    }

    // Revert agent → available and continue pacing
    await updateAgentStatus(env.DB, state.agentId, 'available');
    await tryDialNextLead(env, state.agentId).catch((err) =>
      console.error('[dialer] post-AMD retrigger error:', err),
    );
  }
}

// ----------------------------------------------------------------
// Call Answered Handler
// ----------------------------------------------------------------

async function handleCallAnswered(
  env: Env,
  payload: TelnyxWebhookEvent['data']['payload'],
): Promise<void> {
  if (!payload.client_state) return;

  const state = decodeClientState(payload.client_state);

  if (state.leg === 'lead') {
    // Lead answered — this is the fallback path for calls WITHOUT AMD.
    // (With AMD enabled, we get call.machine.premium.detection.ended instead.)
    // Proceed to dial the agent leg immediately.
    const callLog = await getCallLogById(env.DB, state.callLogId);
    if (!callLog) return;

    // Guard: if AMD was enabled and we already dialed the agent leg, skip
    if (callLog.agent_leg_call_control_id) {
      console.log('[dialer] call.answered (lead leg): agent leg already dialed, skipping');
      return;
    }

    await updateCallLog(env.DB, state.callLogId, {
      status: 'answered',
      answered_at: nowStr(),
    });

    await dialAgentLeg(env, state, payload.call_control_id);
  } else if (state.leg === 'agent') {
    // Agent's WebRTC browser auto-answered — bridge the two legs
    const callLog = await getCallLogById(env.DB, state.callLogId);
    if (!callLog) return;
    if (!callLog.telnyx_call_control_id) return;

    // Idempotency: don't bridge twice
    if (callLog.status === 'bridged') {
      console.log('[dialer] call.answered (agent leg): already bridged, skipping');
      return;
    }

    console.log(`[dialer] Bridging lead leg ${callLog.telnyx_call_control_id} with agent leg ${payload.call_control_id}`);

    await bridgeCalls(env, callLog.telnyx_call_control_id, payload.call_control_id);

    await updateCallLog(env.DB, state.callLogId, {
      status: 'bridged',
      answered_at: nowStr(),
    });
  }
}

// ----------------------------------------------------------------
// Call Bridged Handler (idempotent fallback)
// ----------------------------------------------------------------

async function handleCallBridged(
  env: Env,
  payload: TelnyxWebhookEvent['data']['payload'],
): Promise<void> {
  if (!payload.client_state) return;

  const state = decodeClientState(payload.client_state);
  const callLog = await getCallLogById(env.DB, state.callLogId);
  if (!callLog || callLog.status === 'bridged') return;

  await updateCallLog(env.DB, state.callLogId, {
    status: 'bridged',
    answered_at: callLog.answered_at ?? nowStr(),
  });
}

// ----------------------------------------------------------------
// Call Hangup Handler
// ----------------------------------------------------------------

async function handleCallHangup(
  env: Env,
  payload: TelnyxWebhookEvent['data']['payload'],
): Promise<void> {
  // Find the call log by either leg's control ID
  let callLog = await getCallLogByControlId(env.DB, payload.call_control_id);
  if (!callLog) {
    callLog = await getCallLogByAgentLegControlId(env.DB, payload.call_control_id);
  }
  if (!callLog) {
    console.warn(`[dialer] call.hangup: no call log found for ccid ${payload.call_control_id}`);
    return;
  }

  // Derive duration
  const startedAt = callLog.started_at ? new Date(callLog.started_at).getTime() : null;
  const duration = startedAt
    ? Math.floor((Date.now() - startedAt) / 1000)
    : null;

  const wasEverBridged = callLog.status === 'bridged';

  if (wasEverBridged) {
    // ---- Post-bridge hangup: call completed normally ----
    // Idempotency: only update if not already completed
    if (callLog.status === 'completed') return;

    await updateCallLog(env.DB, callLog.id, {
      status: 'completed',
      ended_at: nowStr(),
      duration_seconds: duration,
      hangup_cause: payload.hangup_cause ?? null,
    });

    // Set lead to 'contacted' (not completed — disposition does that)
    if (callLog.lead_id) {
      await updateLeadStatus(env.DB, callLog.lead_id, 'contacted');
    }

    // Agent goes to wrap_up — must submit disposition before re-entering the loop
    if (callLog.agent_id) {
      await updateAgentStatus(env.DB, callLog.agent_id, 'wrap_up');
      
      // Update agent activity logs
      await env.DB.prepare(`
        INSERT INTO agent_activity_logs (id, agent_id, date) 
        VALUES (?, ?, date('now'))
        ON CONFLICT(agent_id, date) DO NOTHING
      `).bind(crypto.randomUUID(), callLog.agent_id).run();
      
      await env.DB.prepare(`
        UPDATE agent_activity_logs 
        SET total_calls_made = total_calls_made + 1,
            total_talk_time_seconds = total_talk_time_seconds + ?
        WHERE agent_id = ? AND date = date('now')
      `).bind(duration ?? 0, callLog.agent_id).run();
    }

    console.log(`[dialer] Call ${callLog.id} completed — agent ${callLog.agent_id} in wrap_up`);
  } else {
    // ---- Pre-bridge hangup: lead didn't answer, busy, or AMD handled it ----
    // Some of these are already handled (AMD voicemail path). Guard on status.
    if (['completed', 'failed', 'no_answer', 'busy', 'voicemail'].includes(callLog.status)) {
      return;
    }

    const hangupCause = payload.hangup_cause ?? 'unknown';
    let newCallStatus: 'no_answer' | 'busy' | 'failed';

    if (hangupCause === 'no_answer' || hangupCause === 'originator_cancel') {
      newCallStatus = 'no_answer';
    } else if (hangupCause === 'user_busy') {
      newCallStatus = 'busy';
    } else {
      newCallStatus = 'failed';
    }

    await updateCallLog(env.DB, callLog.id, {
      status: newCallStatus,
      ended_at: nowStr(),
      duration_seconds: duration,
      hangup_cause: hangupCause,
    });

    // Requeue or fail the lead
    if (callLog.lead_id && callLog.campaign_id) {
      const campaign = await getCampaignById(env.DB, callLog.campaign_id);
      if (campaign) {
        const lead = await env.DB
          .prepare('SELECT attempts FROM leads WHERE id = ?')
          .bind(callLog.lead_id)
          .first<{ attempts: number }>();

        if (lead) {
          await requeueLead(
            env.DB,
            callLog.lead_id,
            campaign.retry_delay_minutes,
            campaign.max_attempts_per_lead,
            lead.attempts,
          );
        }
      }
    }

    // Revert agent → available and keep pacing
    if (callLog.agent_id) {
      await updateAgentStatus(env.DB, callLog.agent_id, 'available');
      await tryDialNextLead(env, callLog.agent_id).catch((err) =>
        console.error('[dialer] post-hangup retrigger error:', err),
      );
    }
  }
}

// ----------------------------------------------------------------
// Dial Agent Leg (shared helper)
// ----------------------------------------------------------------

/**
 * Dial the agent's WebRTC SIP URI to connect them to the live lead call.
 * The agent's browser will auto-answer this incoming leg.
 */
async function dialAgentLeg(
  env: Env,
  state: ReturnType<typeof decodeClientState>,
  leadCallControlId: string,
): Promise<void> {
  const agent = await getAgentById(env.DB, state.agentId);
  if (!agent) {
    console.error(`[dialer] dialAgentLeg: agent ${state.agentId} not found`);
    return;
  }
  if (!agent.telnyx_sip_username) {
    console.error(`[dialer] dialAgentLeg: agent ${state.agentId} has no SIP username`);
    await hangupCall(env, leadCallControlId).catch(() => {});
    await updateAgentStatus(env.DB, state.agentId, 'available');
    return;
  }

  const agentClientState = encodeClientState({
    leg: 'agent',
    leadId: state.leadId,
    agentId: state.agentId,
    campaignId: state.campaignId,
    callLogId: state.callLogId,
  });

  const agentCallControlId = await dialNumber(env, {
    to: `sip:${agent.telnyx_sip_username}@sip.telnyx.com`,
    from: await getCallerIdForCampaign(env, state.campaignId),
    connectionId: env.TELNYX_CONNECTION_ID,
    webhookUrl: `${env.APP_BASE_URL}/api/webhooks/telnyx`,
    clientState: agentClientState,
    // No AMD for the agent leg — we know it's a person
  });

  // Store agent leg's call_control_id on the call log
  await updateCallLog(env.DB, state.callLogId, {
    agent_leg_call_control_id: agentCallControlId,
  });

  // Update agent status to on_call
  await updateAgentStatus(env.DB, state.agentId, 'on_call');

  console.log(
    `[dialer] Agent leg dialed: ${agent.telnyx_sip_username} — ccid: ${agentCallControlId}`,
  );
}

// ----------------------------------------------------------------
// Utility
// ----------------------------------------------------------------

async function getCallerIdForCampaign(env: Env, campaignId: string): Promise<string> {
  const campaign = await getCampaignById(env.DB, campaignId);
  return campaign?.caller_id_number ?? '';
}

function nowStr(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
