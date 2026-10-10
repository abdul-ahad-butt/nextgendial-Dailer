import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { authMiddleware, requireRole } from '../auth/middleware';
import { hashPassword, verifyPassword, signJWT } from '../auth/crypto';
import { getTelnyxBalance, getTelnyxPhoneNumbers } from '../services/telnyx';
import { grantTenantCredits } from '../services/creditEngine';

const superAdmin = new Hono<AppEnv>();

// ----------------------------------------------------------------
// Super Admin Authentication
// ----------------------------------------------------------------

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

superAdmin.post('/auth/login', zValidator('json', loginSchema), async (c) => {
  const { username, password } = c.req.valid('json');
  const cleanUsername = username.trim().toLowerCase();
  const cleanPassword = password.trim();

  // Ensure super_admins table exists
  try {
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS super_admins (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch {}

  let admin = await c.env.DB.prepare('SELECT id, username, password_hash FROM super_admins WHERE LOWER(username) = ?')
    .bind(cleanUsername)
    .first<{ id: string; username: string; password_hash: string }>();

  // Default seed fallback if no super admin exists yet
  if (!admin && (cleanUsername === 'superadmin' || cleanUsername === 'admin')) {
    const passwordHash = await hashPassword(cleanPassword || 'superadmin123');
    const newId = crypto.randomUUID();
    try {
      await c.env.DB.prepare(
        'INSERT INTO super_admins (id, username, password_hash) VALUES (?, ?, ?)'
      ).bind(newId, 'superadmin', passwordHash).run();

      admin = { id: newId, username: 'superadmin', password_hash: passwordHash };
    } catch {}
  }

  if (!admin) {
    return c.json({ error: 'Invalid super admin credentials' }, 401);
  }

  const isValid = await verifyPassword(cleanPassword, admin.password_hash);
  if (!isValid) {
    return c.json({ error: 'Invalid super admin credentials' }, 401);
  }

  const token = await signJWT(
    { sub: admin.id, role: 'super_admin' },
    c.env.JWT_SECRET
  );

  return c.json({
    success: true,
    token,
    role: 'super_admin',
    user: {
      id: admin.id,
      username: admin.username,
      role: 'super_admin',
    },
  });
});

// All routes below require super_admin role
superAdmin.use('*', authMiddleware);
superAdmin.use('*', requireRole('super_admin'));

// ----------------------------------------------------------------
// Executive Dashboard & Vitals
// ----------------------------------------------------------------

superAdmin.get('/dashboard', async (c) => {
  // 1. Fetch Telnyx Master Balance
  const telnyxBalance = await getTelnyxBalance(c.env.TELNYX_API_KEY);

  // 2. Aggregate tenant counts & credit distribution
  let activeTenants = 0;
  let totalAllocated = 0;
  let totalSpent = 0;

  try {
    const tenantStats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total_tenants,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_tenants,
        COALESCE(SUM(allocated_credits), 0) as total_allocated,
        COALESCE(SUM(spent_credits), 0) as total_spent
      FROM tenants
    `).first<{
      total_tenants: number;
      active_tenants: number;
      total_allocated: number;
      total_spent: number;
    }>();

    activeTenants = tenantStats?.active_tenants ?? 0;
    totalAllocated = Math.round((tenantStats?.total_allocated ?? 0) * 100) / 100;
    totalSpent = Math.round((tenantStats?.total_spent ?? 0) * 100) / 100;
  } catch (err: any) {
    console.warn('[superAdmin] Tenant stats query warning:', err.message);
  }

  // 3. Registered Agents count
  let totalAgents = 0;
  try {
    const agentStats = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM users WHERE role = 'agent' AND COALESCE(status, 'offline') != 'deleted'"
    ).first<{ count: number }>();
    totalAgents = agentStats?.count ?? 0;
  } catch {}

  // 4. Live calls count
  let liveCalls = 0;
  try {
    const callStats = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM call_logs WHERE status IN ('initiated', 'ringing', 'answered', 'bridged')"
    ).first<{ count: number }>();
    liveCalls = callStats?.count ?? 0;
  } catch {}

  return c.json({
    data: {
      active_tenants: activeTenants,
      total_agents: totalAgents,
      live_calls: liveCalls,
      total_allocated_credits: totalAllocated,
      total_spent_credits: totalSpent,
      telnyx_balance: telnyxBalance.balance,
      telnyx_currency: telnyxBalance.currency,
      credit_limit: telnyxBalance.credit_limit,
    },
  });
});

// ----------------------------------------------------------------
// Telnyx Master Balance & Numbers
// ----------------------------------------------------------------

superAdmin.get('/telnyx/balance', async (c) => {
  const balance = await getTelnyxBalance(c.env.TELNYX_API_KEY);
  return c.json({ data: balance });
});

superAdmin.get('/telnyx/numbers', async (c) => {
  // 1. Fetch live Telnyx inventory
  const telnyxNumbers = await getTelnyxPhoneNumbers(c.env.TELNYX_API_KEY);

  // 2. Fetch local phone_inventory assignments
  let localAssignments: any[] = [];
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT 
        pi.phone_number,
        pi.friendly_name,
        pi.status,
        pi.assigned_tenant_id,
        t.name as assigned_tenant_name,
        pi.assigned_agent_id,
        u.username as assigned_agent_username
      FROM phone_inventory pi
      LEFT JOIN tenants t ON pi.assigned_tenant_id = t.id
      LEFT JOIN users u ON pi.assigned_agent_id = u.id
    `).all();
    localAssignments = results || [];
  } catch (err: any) {
    console.warn('[superAdmin] phone_inventory query warning:', err.message);
  }

  const map = new Map<string, any>();
  for (const item of localAssignments) {
    map.set(item.phone_number, item);
  }

  // Merge Telnyx numbers with local assignment metadata
  const merged = telnyxNumbers.map((tn) => {
    const local = map.get(tn.phone_number);
    return {
      phone_number: tn.phone_number,
      friendly_name: local?.friendly_name || tn.tags?.[0] || 'Direct Line',
      telnyx_id: tn.id,
      status: tn.status,
      assigned_tenant_id: local?.assigned_tenant_id || null,
      assigned_tenant_name: local?.assigned_tenant_name || null,
      assigned_agent_id: local?.assigned_agent_id || null,
      assigned_agent_username: local?.assigned_agent_username || null,
    };
  });

  return c.json({ data: merged });
});

// Sync Telnyx numbers into phone_inventory table
superAdmin.post('/numbers/sync', async (c) => {
  const telnyxNumbers = await getTelnyxPhoneNumbers(c.env.TELNYX_API_KEY);

  const stmts = telnyxNumbers.map((num) =>
    c.env.DB.prepare(`
      INSERT INTO phone_inventory (phone_number, friendly_name, telnyx_id, status)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(phone_number) DO UPDATE SET
        telnyx_id = excluded.telnyx_id,
        status = excluded.status
    `).bind(num.phone_number, num.tags?.[0] || 'Telnyx Number', num.id, num.status)
  );

  if (stmts.length > 0) {
    await c.env.DB.batch(stmts);
  }

  return c.json({ success: true, count: telnyxNumbers.length });
});

// ----------------------------------------------------------------
// Tenant Organization Management
// ----------------------------------------------------------------

superAdmin.get('/tenants', async (c) => {
  const { results: tenants } = await c.env.DB.prepare(`
    SELECT 
      t.id,
      t.name,
      t.admin_username,
      t.allocated_credits,
      t.spent_credits,
      t.max_agents,
      t.is_active,
      t.created_at,
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.role = 'agent' AND COALESCE(u.status, 'offline') != 'deleted') as agent_count
    FROM tenants t
    ORDER BY t.created_at DESC
  `).all();

  // Fetch assigned phone numbers for each tenant
  const { results: numbers } = await c.env.DB.prepare(`
    SELECT phone_number, assigned_tenant_id
    FROM phone_inventory
    WHERE assigned_tenant_id IS NOT NULL
  `).all();

  const numbersByTenant: Record<string, string[]> = {};
  for (const n of numbers as any[]) {
    if (!numbersByTenant[n.assigned_tenant_id]) {
      numbersByTenant[n.assigned_tenant_id] = [];
    }
    numbersByTenant[n.assigned_tenant_id]?.push(n.phone_number);
  }

  const enriched = (tenants || []).map((t: any) => ({
    ...t,
    available_credits: Number(t.available_credits ?? Math.max(0, (t.allocated_credits ?? 0) - (t.spent_credits ?? 0) - (t.distributed_credits ?? 0))),
    allocated_credits: Number(t.allocated_credits ?? 0),
    distributed_credits: Number(t.distributed_credits ?? 0),
    spent_credits: Number(t.spent_credits ?? 0),
    remaining_balance: Math.round(((t.allocated_credits ?? 0) - (t.spent_credits ?? 0)) * 100) / 100,
    assigned_numbers: numbersByTenant[t.id] || [],
  }));

  return c.json({ data: enriched });
});

const createTenantSchema = z.object({
  name: z.string().min(1),
  admin_username: z.string().min(1),
  admin_password: z.string().min(1),
  max_agents: z.number().int().positive().default(5),
  initial_credits: z.number().nonnegative().default(10.0),
  phone_numbers: z.array(z.string()).max(2).optional(),
});

superAdmin.post('/tenants', zValidator('json', createTenantSchema), async (c) => {
  const { name, admin_username, admin_password, max_agents, initial_credits, phone_numbers } = c.req.valid('json');

  const cleanUser = admin_username.trim().toLowerCase();
  const cleanPass = admin_password.trim();

  // Check username uniqueness
  const existingUser = await c.env.DB.prepare(
    'SELECT id FROM users WHERE LOWER(username) = ?'
  ).bind(cleanUser).first();

  if (existingUser) {
    return c.json({ error: 'Username already in use by another admin or agent' }, 409);
  }

  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(cleanPass);

  // 1. Create tenant
  await c.env.DB.prepare(`
    INSERT INTO tenants (id, name, admin_username, admin_password_hash, allocated_credits, spent_credits, max_agents, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 0.00, ?, 1, datetime('now'))
  `).bind(tenantId, name.trim(), cleanUser, passwordHash, initial_credits, max_agents).run();

  // 2. Create admin user in users table
  await c.env.DB.prepare(`
    INSERT INTO users (id, username, password_hash, role, tenant_id, status, created_at)
    VALUES (?, ?, ?, 'admin', ?, 'offline', datetime('now'))
  `).bind(userId, cleanUser, passwordHash, tenantId).run();

  // 3. Record initial credit grant in ledger
  if (initial_credits > 0) {
    await c.env.DB.prepare(`
      INSERT INTO credit_ledger (id, tenant_id, amount, type, reference_id, balance_after, created_at)
      VALUES (?, ?, ?, 'SUPER_ADMIN_GRANT', 'INITIAL_PROVISION', ?, datetime('now'))
    `).bind(crypto.randomUUID(), tenantId, initial_credits, initial_credits).run();
  }

  // 4. Assign phone numbers if provided
  if (phone_numbers && phone_numbers.length > 0) {
    for (const num of phone_numbers) {
      await c.env.DB.prepare(`
        INSERT INTO phone_inventory (phone_number, assigned_tenant_id, status)
        VALUES (?, ?, 'active')
        ON CONFLICT(phone_number) DO UPDATE SET
          assigned_tenant_id = excluded.assigned_tenant_id
      `).bind(num, tenantId).run();
    }
  }

  return c.json({
    success: true,
    data: {
      id: tenantId,
      name,
      admin_username: cleanUser,
      allocated_credits: initial_credits,
      remaining_balance: initial_credits,
      max_agents,
      assigned_numbers: phone_numbers || [],
    },
  }, 201);
});

const updateTenantSchema = z.object({
  name: z.string().optional(),
  max_agents: z.number().int().positive().optional(),
  is_active: z.number().int().min(0).max(1).optional(),
});

superAdmin.patch('/tenants/:id', zValidator('json', updateTenantSchema), async (c) => {
  const tenantId = c.req.param('id');
  const body = c.req.valid('json');

  const updates: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name);
  }
  if (body.max_agents !== undefined) {
    updates.push('max_agents = ?');
    values.push(body.max_agents);
  }
  if (body.is_active !== undefined) {
    updates.push('is_active = ?');
    values.push(body.is_active);
  }

  if (updates.length > 0) {
    values.push(tenantId);
    await c.env.DB.prepare(`UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  const updated = await c.env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
  return c.json({ data: updated });
});

// Grant / Allocate credits
const creditGrantSchema = z.object({
  amount: z.number().positive(),
  notes: z.string().optional(),
});

superAdmin.post('/tenants/:id/credits', zValidator('json', creditGrantSchema), async (c) => {
  const tenantId = c.req.param('id');
  const { amount, notes } = c.req.valid('json');

  const result = await grantTenantCredits(c.env.DB, {
    tenantId,
    amount,
    referenceId: notes || 'SUPER_ADMIN_REFILL',
  });

  return c.json({
    success: true,
    granted: result.granted,
    remaining_balance: result.newBalance,
  });
});

// Alias for /admins/:id/credits
superAdmin.post('/admins/:id/credits', zValidator('json', creditGrantSchema), async (c) => {
  const tenantId = c.req.param('id');
  const { amount, notes } = c.req.valid('json');

  const result = await grantTenantCredits(c.env.DB, {
    tenantId,
    amount,
    referenceId: notes || 'SUPER_ADMIN_REFILL',
  });

  return c.json({
    success: true,
    granted: result.granted,
    remaining_balance: result.newBalance,
  });
});

// Allocate phone numbers to tenant (1-2 lines per tenant)
const assignNumbersSchema = z.object({
  tenant_id: z.string(),
  phone_numbers: z.array(z.string()).min(1).max(2),
});

superAdmin.post('/numbers/assign', zValidator('json', assignNumbersSchema), async (c) => {
  const { tenant_id, phone_numbers } = c.req.valid('json');

  // Verify tenant exists
  const tenant = await c.env.DB.prepare('SELECT id, name FROM tenants WHERE id = ?').bind(tenant_id).first();
  if (!tenant) {
    return c.json({ error: 'Tenant organization not found' }, 404);
  }

  // Clear previous assignments for this tenant if reassigned
  await c.env.DB.prepare('UPDATE phone_inventory SET assigned_tenant_id = NULL WHERE assigned_tenant_id = ?')
    .bind(tenant_id)
    .run();

  // Assign requested numbers
  for (const num of phone_numbers) {
    await c.env.DB.prepare(`
      INSERT INTO phone_inventory (phone_number, assigned_tenant_id, status)
      VALUES (?, ?, 'active')
      ON CONFLICT(phone_number) DO UPDATE SET
        assigned_tenant_id = excluded.assigned_tenant_id,
        status = 'active'
    `).bind(num, tenant_id).run();
  }

  return c.json({
    success: true,
    tenant_id,
    assigned_numbers: phone_numbers,
  });
});

// ----------------------------------------------------------------
// Credit Audit Ledger (Real-time logs)
// ----------------------------------------------------------------

superAdmin.get('/ledger', async (c) => {
  const { tenant_id, page = '1', limit = '50' } = c.req.query();
  const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limitNum;

  const conditions: string[] = [];
  const params: any[] = [];

  if (tenant_id) {
    conditions.push('cl.tenant_id = ?');
    params.push(tenant_id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { results } = await c.env.DB.prepare(`
    SELECT 
      cl.id,
      cl.tenant_id,
      t.name as tenant_name,
      cl.amount,
      cl.type,
      cl.reference_id,
      cl.balance_after,
      cl.created_at
    FROM credit_ledger cl
    LEFT JOIN tenants t ON cl.tenant_id = t.id
    ${where}
    ORDER BY cl.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limitNum, offset).all();

  const total = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM credit_ledger cl ${where}
  `).bind(...params).first<{ count: number }>();

  return c.json({
    data: results || [],
    total: total?.count ?? 0,
    page: parseInt(page, 10) || 1,
    limit: limitNum,
  });
});

export default superAdmin;
