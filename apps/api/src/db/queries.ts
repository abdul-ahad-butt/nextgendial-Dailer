/**
 * apps/api/src/db/queries.ts
 *
 * Typed D1 query helpers — raw parameterised SQL, no ORM.
 * Every insert generates its own id via crypto.randomUUID().
 *
 * All helpers accept `db: D1Database` as the first argument so they
 * remain pure and easy to test without a full Env object.
 */

import type {
  Agent,
  AgentStatus,
  Campaign,
  CallLog,
  CallStatus,
  Disposition,
  Lead,
  LeadStatus,
} from '@nextgendial/shared-types';

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ----------------------------------------------------------------
// Agents
// ----------------------------------------------------------------

export async function getAgentById(
  db: D1Database,
  id: string,
): Promise<Agent | null> {
  return db
    .prepare('SELECT * FROM agents WHERE id = ?')
    .bind(id)
    .first<Agent>();
}

export async function listAgents(db: D1Database): Promise<Agent[]> {
  const result = await db.prepare('SELECT * FROM agents ORDER BY name ASC').all<Agent>();
  return result.results;
}

export async function updateAgentStatus(
  db: D1Database,
  id: string,
  status: AgentStatus,
  currentCallLogId?: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE agents
       SET status = ?, current_call_log_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(status, currentCallLogId ?? null, now(), id)
    .run();
}

export async function updateAgent(
  db: D1Database,
  id: string,
  data: Partial<{
    name: string;
    email: string;
    telnyx_credential_id: string;
    telnyx_sip_username: string;
  }>,
): Promise<Agent | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }

  if (fields.length === 0) return getAgentById(db, id);

  fields.push('updated_at = ?');
  values.push(now());
  values.push(id);

  await db
    .prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return getAgentById(db, id);
}

/**
 * Atomic compare-and-swap: flip agent from 'available' → 'dialing'.
 * Returns true if the row was claimed (1 row changed), false if another
 * trigger already claimed it (0 rows changed).
 */
export async function claimAgentForDialing(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE agents
       SET status = 'dialing', updated_at = ?
       WHERE id = ? AND status = 'available'`,
    )
    .bind(now(), id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function insertAgent(
  db: D1Database,
  data: { name: string; email: string; telnyx_credential_id?: string; telnyx_sip_username?: string },
): Promise<Agent> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO agents (id, name, email, telnyx_credential_id, telnyx_sip_username)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, data.name, data.email, data.telnyx_credential_id ?? null, data.telnyx_sip_username ?? null)
    .run();
  return (await getAgentById(db, id))!;
}

// ----------------------------------------------------------------
// Campaigns
// ----------------------------------------------------------------

export async function listCampaigns(db: D1Database): Promise<Campaign[]> {
  const result = await db
    .prepare('SELECT * FROM campaigns ORDER BY created_at DESC')
    .all<Campaign>();
  return result.results;
}

export async function getCampaignById(
  db: D1Database,
  id: string,
): Promise<Campaign | null> {
  return db
    .prepare('SELECT * FROM campaigns WHERE id = ?')
    .bind(id)
    .first<Campaign>();
}

export async function insertCampaign(
  db: D1Database,
  data: {
    name: string;
    caller_id_number: string;
    dial_ratio?: number;
    max_attempts_per_lead?: number;
    retry_delay_minutes?: number;
    script?: string;
  },
): Promise<Campaign> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO campaigns
         (id, name, caller_id_number, dial_ratio, max_attempts_per_lead, retry_delay_minutes, script)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      data.name,
      data.caller_id_number,
      data.dial_ratio ?? 1.0,
      data.max_attempts_per_lead ?? 3,
      data.retry_delay_minutes ?? 60,
      data.script ?? null,
    )
    .run();
  return (await getCampaignById(db, id))!;
}

export async function updateCampaign(
  db: D1Database,
  id: string,
  data: Partial<{
    name: string;
    status: string;
    caller_id_number: string;
    dial_ratio: number;
    max_attempts_per_lead: number;
    retry_delay_minutes: number;
    script: string | null;
  }>,
): Promise<Campaign | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }

  if (fields.length === 0) return getCampaignById(db, id);

  fields.push('updated_at = ?');
  values.push(now());
  values.push(id);

  await db
    .prepare(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return getCampaignById(db, id);
}

// ----------------------------------------------------------------
// Leads
// ----------------------------------------------------------------

export async function getNextDialableLead(
  db: D1Database,
  campaignId?: string,
): Promise<(Lead & { campaign: Campaign }) | null> {
  const campaignFilter = campaignId ? 'AND leads.campaign_id = ?' : '';
  const params: string[] = campaignId ? [campaignId] : [];

  const row = await db
    .prepare(
      `SELECT
         leads.*,
         campaigns.caller_id_number AS campaign_caller_id_number,
         campaigns.max_attempts_per_lead AS campaign_max_attempts_per_lead,
         campaigns.retry_delay_minutes AS campaign_retry_delay_minutes,
         campaigns.dial_ratio AS campaign_dial_ratio,
         campaigns.name AS campaign_name,
         campaigns.script AS campaign_script,
         campaigns.status AS campaign_status,
         campaigns.created_at AS campaign_created_at,
         campaigns.updated_at AS campaign_updated_at
       FROM leads
       JOIN campaigns ON leads.campaign_id = campaigns.id
       WHERE campaigns.status = 'active'
         AND leads.status = 'pending'
         AND leads.do_not_call = 0
         AND leads.attempts < campaigns.max_attempts_per_lead
         AND (leads.next_attempt_at IS NULL OR leads.next_attempt_at <= datetime('now'))
         ${campaignFilter}
       ORDER BY leads.created_at ASC
       LIMIT 1`,
    )
    .bind(...params)
    .first<
      Lead & {
        campaign_caller_id_number: string;
        campaign_max_attempts_per_lead: number;
        campaign_retry_delay_minutes: number;
        campaign_dial_ratio: number;
        campaign_name: string;
        campaign_script: string | null;
        campaign_status: string;
        campaign_created_at: string;
        campaign_updated_at: string;
      }
    >();

  if (!row) return null;

  // Reshape the flat join into a nested structure
  const lead: Lead = {
    id: row.id,
    campaign_id: row.campaign_id,
    first_name: row.first_name,
    last_name: row.last_name,
    phone_number: row.phone_number,
    timezone: row.timezone,
    status: row.status,
    attempts: row.attempts,
    last_attempt_at: row.last_attempt_at,
    next_attempt_at: row.next_attempt_at,
    do_not_call: row.do_not_call,
    consent_on_file: row.consent_on_file,
    custom_fields: row.custom_fields,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  const campaign: Campaign = {
    id: row.campaign_id,
    name: row.campaign_name,
    status: row.campaign_status as Campaign['status'],
    caller_id_number: row.campaign_caller_id_number,
    dial_ratio: row.campaign_dial_ratio,
    max_attempts_per_lead: row.campaign_max_attempts_per_lead,
    retry_delay_minutes: row.campaign_retry_delay_minutes,
    script: row.campaign_script,
    created_at: row.campaign_created_at,
    updated_at: row.campaign_updated_at,
  };

  return { ...lead, campaign };
}

export async function getLeadById(
  db: D1Database,
  id: string,
): Promise<Lead | null> {
  return db.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Lead>();
}

export interface LeadFilters {
  campaign_id?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export async function listLeads(
  db: D1Database,
  filters: LeadFilters = {},
): Promise<{ data: Lead[]; total: number }> {
  const { campaign_id, status, page = 1, limit = 50 } = filters;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (campaign_id) {
    conditions.push('campaign_id = ?');
    params.push(campaign_id);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [dataResult, countResult] = await Promise.all([
    db
      .prepare(`SELECT * FROM leads ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset)
      .all<Lead>(),
    db
      .prepare(`SELECT COUNT(*) AS total FROM leads ${where}`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return {
    data: dataResult.results,
    total: countResult?.total ?? 0,
  };
}

export async function incrementLeadAttempt(
  db: D1Database,
  id: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE leads
       SET attempts = attempts + 1, last_attempt_at = ?, status = 'dialing', updated_at = ?
       WHERE id = ?`,
    )
    .bind(now(), now(), id)
    .run();
}

export async function updateLeadStatus(
  db: D1Database,
  id: string,
  status: LeadStatus,
  nextAttemptAt?: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE leads
       SET status = ?, next_attempt_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(status, nextAttemptAt ?? null, now(), id)
    .run();
}

export async function requeueLead(
  db: D1Database,
  leadId: string,
  retryDelayMinutes: number,
  maxAttempts: number,
  currentAttempts: number,
): Promise<void> {
  if (currentAttempts >= maxAttempts) {
    await updateLeadStatus(db, leadId, 'failed');
    return;
  }
  const retryAt = new Date(Date.now() + retryDelayMinutes * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  await updateLeadStatus(db, leadId, 'pending', retryAt);
}

export async function insertLead(
  db: D1Database,
  data: {
    campaign_id: string;
    first_name?: string | null;
    last_name?: string | null;
    phone_number: string;
    timezone?: string | null;
    consent_on_file?: number;
    custom_fields?: string | null;
  },
): Promise<Lead> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO leads
         (id, campaign_id, first_name, last_name, phone_number, timezone, consent_on_file, custom_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      data.campaign_id,
      data.first_name ?? null,
      data.last_name ?? null,
      data.phone_number,
      data.timezone ?? null,
      data.consent_on_file ?? 0,
      data.custom_fields ?? null,
    )
    .run();
  return (await getLeadById(db, id))!;
}

export async function updateLead(
  db: D1Database,
  id: string,
  data: Partial<{
    do_not_call: number;
    status: LeadStatus;
    next_attempt_at: string | null;
    first_name: string | null;
    last_name: string | null;
  }>,
): Promise<Lead | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }

  if (fields.length === 0) return getLeadById(db, id);

  fields.push('updated_at = ?');
  values.push(now());
  values.push(id);

  await db
    .prepare(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return getLeadById(db, id);
}

// ----------------------------------------------------------------
// Call Logs
// ----------------------------------------------------------------

export interface InsertCallLogData {
  lead_id?: string | null;
  agent_id?: string | null;
  campaign_id?: string | null;
  direction?: 'outbound' | 'inbound';
  status?: CallStatus;
}

export async function insertCallLog(
  db: D1Database,
  data: InsertCallLogData,
): Promise<CallLog> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO call_logs (id, lead_id, agent_id, campaign_id, direction, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      data.lead_id ?? null,
      data.agent_id ?? null,
      data.campaign_id ?? null,
      data.direction ?? 'outbound',
      data.status ?? 'initiated',
      now(),
    )
    .run();
  return (await getCallLogById(db, id))!;
}

export async function getCallLogById(
  db: D1Database,
  id: string,
): Promise<CallLog | null> {
  return db
    .prepare('SELECT * FROM call_logs WHERE id = ?')
    .bind(id)
    .first<CallLog>();
}

export async function getCallLogByControlId(
  db: D1Database,
  callControlId: string,
): Promise<CallLog | null> {
  return db
    .prepare('SELECT * FROM call_logs WHERE telnyx_call_control_id = ?')
    .bind(callControlId)
    .first<CallLog>();
}

export async function getCallLogByAgentLegControlId(
  db: D1Database,
  callControlId: string,
): Promise<CallLog | null> {
  return db
    .prepare('SELECT * FROM call_logs WHERE agent_leg_call_control_id = ?')
    .bind(callControlId)
    .first<CallLog>();
}

export interface UpdateCallLogData {
  telnyx_call_control_id?: string | null;
  agent_leg_call_control_id?: string | null;
  status?: CallStatus;
  disposition?: Disposition | null;
  disposition_notes?: string | null;
  answered_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
  hangup_cause?: string | null;
  recording_url?: string | null;
}

export async function updateCallLog(
  db: D1Database,
  id: string,
  data: UpdateCallLogData,
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }

  if (fields.length === 0) return;

  values.push(id);
  await db
    .prepare(`UPDATE call_logs SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function updateCallLogByControlId(
  db: D1Database,
  callControlId: string,
  data: UpdateCallLogData,
): Promise<void> {
  const log = await getCallLogByControlId(db, callControlId);
  if (log) await updateCallLog(db, log.id, data);
}

export interface CallLogFilters {
  agent_id?: string;
  campaign_id?: string;
  telnyx_call_control_id?: string;
  from?: string; // ISO date string
  to?: string;
  page?: number;
  limit?: number;
}

export async function listCallLogs(
  db: D1Database,
  filters: CallLogFilters = {},
): Promise<{ data: CallLog[]; total: number }> {
  const { agent_id, campaign_id, telnyx_call_control_id, from, to, page = 1, limit = 50 } = filters;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (agent_id) { conditions.push('agent_id = ?'); params.push(agent_id); }
  if (campaign_id) { conditions.push('campaign_id = ?'); params.push(campaign_id); }
  if (telnyx_call_control_id) { conditions.push('telnyx_call_control_id = ?'); params.push(telnyx_call_control_id); }
  if (from) { conditions.push('created_at >= ?'); params.push(from); }
  if (to) { conditions.push('created_at <= ?'); params.push(to); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [dataResult, countResult] = await Promise.all([
    db
      .prepare(`SELECT * FROM call_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset)
      .all<CallLog>(),
    db
      .prepare(`SELECT COUNT(*) AS total FROM call_logs ${where}`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return {
    data: dataResult.results,
    total: countResult?.total ?? 0,
  };
}
