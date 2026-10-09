/**
 * apps/api/src/services/creditEngine.ts
 *
 * Atomic credit reservation, balance verification, and deduction engine.
 * Enforces strict call-cutoff when prepaid balance falls below threshold.
 */

export interface TenantBalance {
  tenant_id: string;
  name: string;
  allocated_credits: number;
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
    .prepare('SELECT id, name, allocated_credits, spent_credits, is_active FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first<{
      id: string;
      name: string;
      allocated_credits: number;
      spent_credits: number;
      is_active: number;
    }>();

  if (!tenant) return null;

  const allocated = Number(tenant.allocated_credits ?? 0);
  const spent = Number(tenant.spent_credits ?? 0);
  const remaining = Math.round((allocated - spent) * 1000) / 1000;

  return {
    tenant_id: tenant.id,
    name: tenant.name,
    allocated_credits: allocated,
    spent_credits: spent,
    remaining_balance: remaining,
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
  }
): Promise<{ deducted: number; newBalance: number }> {
  const { tenantId, callId, durationSeconds } = params;

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

  await db.batch([
    db.prepare('UPDATE tenants SET spent_credits = ? WHERE id = ?').bind(newSpent, tenantId),
    db.prepare(`
      INSERT INTO credit_ledger (id, tenant_id, amount, type, reference_id, balance_after, created_at)
      VALUES (?, ?, ?, 'CALL_OUTBOUND', ?, ?, datetime('now'))
    `).bind(ledgerId, tenantId, -amountToDeduct, callId, newBalance),
  ]);

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
  const newBalance = Math.round((newAllocated - tenant.spent_credits) * 1000) / 1000;
  const ledgerId = crypto.randomUUID();

  await db.batch([
    db.prepare('UPDATE tenants SET allocated_credits = ? WHERE id = ?').bind(newAllocated, tenantId),
    db.prepare(`
      INSERT INTO credit_ledger (id, tenant_id, amount, type, reference_id, balance_after, created_at)
      VALUES (?, ?, ?, 'SUPER_ADMIN_GRANT', ?, ?, datetime('now'))
    `).bind(ledgerId, tenantId, amount, referenceId || null, newBalance),
  ]);

  return {
    granted: amount,
    newBalance,
  };
}
