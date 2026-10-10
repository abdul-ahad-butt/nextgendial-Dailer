/**
 * apps/api/src/services/creditEngine.ts
 *
 * Atomic credit reservation, balance verification, and deduction engine.
 * Enforces strict call-cutoff when prepaid balance falls below threshold.
 */

export interface TenantBalance {
  tenant_id: string;
  name: string;
  available_credits: number;
  allocated_credits: number;
  distributed_credits: number;
  spent_credits: number;
  remaining_balance: number;
  is_active: boolean;
}

const CALL_RATE_PER_MINUTE = 0.015; // $0.015 per minute
const SMS_RATE_PER_MESSAGE = 0.0075; // $0.0075 per SMS
const MIN_CALL_BALANCE_REQUIRED = 0.05; // $0.05 minimum to start or sustain a call

/**
 * Retrieves the current balance for a tenant organization.
 */
export async function getTenantBalance(db: D1Database, tenantId: string): Promise<TenantBalance | null> {
  const tenant = await db
    .prepare('SELECT id, name, available_credits, allocated_credits, distributed_credits, spent_credits, is_active FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first<{
      id: string;
      name: string;
      available_credits: number;
      allocated_credits: number;
      distributed_credits: number;
      spent_credits: number;
      is_active: number;
    }>();

  if (!tenant) return null;

  const allocated = Number(tenant.allocated_credits ?? 0);
  const spent = Number(tenant.spent_credits ?? 0);
  const distributed = Number(tenant.distributed_credits ?? 0);
  const available = tenant.available_credits !== undefined && tenant.available_credits !== null
    ? Number(tenant.available_credits)
    : Math.max(0, Math.round((allocated - spent - distributed) * 1000) / 1000);
  const remaining = Math.round((allocated - spent) * 1000) / 1000;

  return {
    tenant_id: tenant.id,
    name: tenant.name,
    available_credits: available,
    allocated_credits: allocated,
    distributed_credits: distributed,
    spent_credits: spent,
    remaining_balance: available,
    is_active: Boolean(tenant.is_active),
  };
}

/**
 * Pre-flight Check:
 * Throws an Error if tenant does not have enough prepaid credit to initiate a call.
 */
export async function verifyPreCallCredits(db: D1Database, tenantId: string): Promise<TenantBalance> {
  const balance = await getTenantBalance(db, tenantId);

  if (!balance) {
    throw new Error('TENANT_NOT_FOUND: Organization does not exist.');
  }

  if (!balance.is_active) {
    throw new Error('TENANT_SUSPENDED: Organization account has been suspended by Super Admin.');
  }

  if (balance.remaining_balance < MIN_CALL_BALANCE_REQUIRED) {
    throw new Error('INSUFFICIENT_CREDITS: Please contact Super Admin to refill calling credits.');
  }

  return balance;
}

/**
 * Deduct credits for a completed outbound call.
 * Inserts an entry into credit_ledger and updates tenants.spent_credits atomically.
 */
export async function deductCallCredits(
  db: D1Database,
  params: {
    tenantId: string;
    callId: string;
    durationSeconds: number;
    agentId?: string;
  }
): Promise<{ deducted: number; newBalance: number }> {
  const { tenantId, callId, durationSeconds, agentId } = params;

  if (durationSeconds <= 0) {
    const cur = await getTenantBalance(db, tenantId);
    return { deducted: 0, newBalance: cur?.remaining_balance ?? 0 };
  }

  // Cost calculation: rounded up to nearest 6 seconds (or minute-based calculation)
  // Standard telephony billing: bill by 60s increments or prorated per second
  const billableMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
  const amountToDeduct = Math.round(billableMinutes * CALL_RATE_PER_MINUTE * 1000) / 1000;

  const tenant = await getTenantBalance(db, tenantId);
  if (!tenant) {
    return { deducted: 0, newBalance: 0 };
  }

  const newSpent = tenant.spent_credits + amountToDeduct;
  const newBalance = Math.round((tenant.allocated_credits - newSpent) * 1000) / 1000;
  const ledgerId = crypto.randomUUID();

  const updates = [
    db.prepare(`
      UPDATE tenants 
      SET spent_credits = spent_credits + ?,
          distributed_credits = MAX(0, distributed_credits - ?)
      WHERE id = ?
    `).bind(amountToDeduct, amountToDeduct, tenantId),
    db.prepare(`
      INSERT INTO credit_ledger (id, tenant_id, amount, type, reference_id, balance_after, created_at)
      VALUES (?, ?, ?, 'CALL_OUTBOUND', ?, ?, datetime('now'))
    `).bind(ledgerId, tenantId, -amountToDeduct, callId, newBalance),
  ];

  if (agentId) {
    updates.push(
      db.prepare(`
        UPDATE users 
        SET balance_credits = MAX(0, COALESCE(balance_credits, 0) - ?),
            spent_credits = COALESCE(spent_credits, 0) + ? 
        WHERE id = ?
      `).bind(amountToDeduct, amountToDeduct, agentId),
      db.prepare(`
        UPDATE agents 
        SET balance_credits = MAX(0, COALESCE(balance_credits, 0) - ?),
            spent_credits = COALESCE(spent_credits, 0) + ? 
        WHERE id = ?
      `).bind(amountToDeduct, amountToDeduct, agentId)
    );
  }

  await db.batch(updates);

  return {
    deducted: amountToDeduct,
    newBalance,
  };
}

/**
 * Deduct credits for an outbound SMS message.
 */
export async function deductSmsCredits(
  db: D1Database,
  params: {
    tenantId: string;
    messageId: string;
  }
): Promise<{ deducted: number; newBalance: number }> {
  const { tenantId, messageId } = params;
  const amountToDeduct = SMS_RATE_PER_MESSAGE;

  const tenant = await getTenantBalance(db, tenantId);
  if (!tenant) {
    throw new Error('TENANT_NOT_FOUND');
  }

  if (tenant.remaining_balance < amountToDeduct) {
    throw new Error('INSUFFICIENT_CREDITS: Please contact Super Admin to refill SMS credits.');
  }

  const newSpent = tenant.spent_credits + amountToDeduct;
  const newBalance = Math.round((tenant.allocated_credits - newSpent) * 1000) / 1000;
  const ledgerId = crypto.randomUUID();

  await db.batch([
    db.prepare('UPDATE tenants SET spent_credits = ? WHERE id = ?').bind(newSpent, tenantId),
    db.prepare(`
      INSERT INTO credit_ledger (id, tenant_id, amount, type, reference_id, balance_after, created_at)
      VALUES (?, ?, ?, 'SMS_SENT', ?, ?, datetime('now'))
    `).bind(ledgerId, tenantId, -amountToDeduct, messageId, newBalance),
  ]);

  return {
    deducted: amountToDeduct,
    newBalance,
  };
}

/**
 * Super Admin grants prepaid credits to a tenant organization.
 */
export async function grantTenantCredits(
  db: D1Database,
  params: {
    tenantId: string;
    amount: number;
    referenceId?: string;
  }
): Promise<{ granted: number; newBalance: number }> {
  const { tenantId, amount, referenceId } = params;
  if (amount <= 0) {
    throw new Error('Grant amount must be greater than zero.');
  }

  const tenant = await getTenantBalance(db, tenantId);
  if (!tenant) {
    throw new Error('Tenant organization not found.');
  }

  const newAllocated = tenant.allocated_credits + amount;
  const newAvailable = tenant.available_credits + amount;
  const ledgerId = crypto.randomUUID();
  const transferId = crypto.randomUUID();

  await db.batch([
    db.prepare(`
      UPDATE tenants 
      SET allocated_credits = allocated_credits + ?,
          available_credits = available_credits + ?
      WHERE id = ?
    `).bind(amount, amount, tenantId),
    db.prepare(`
      INSERT INTO credit_ledger (id, tenant_id, amount, type, reference_id, balance_after, created_at)
      VALUES (?, ?, ?, 'SUPER_ADMIN_GRANT', ?, ?, datetime('now'))
    `).bind(ledgerId, tenantId, amount, referenceId || null, newAvailable),
    db.prepare(`
      INSERT INTO credit_transfers (id, from_type, from_id, to_type, to_id, amount, notes, created_at)
      VALUES (?, 'SUPER_ADMIN', 'master_pool', 'TENANT', ?, ?, ?, datetime('now'))
    `).bind(transferId, tenantId, amount, referenceId || 'Super Admin balance grant'),
  ]);

  return {
    granted: amount,
    newBalance: newAvailable,
  };
}
