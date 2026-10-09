import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { verifyPassword, signJWT, hashPassword } from '../auth/crypto';

const auth = new Hono<AppEnv>();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

auth.post(
  '/login',
  zValidator('json', loginSchema),
  async (c) => {
    const { username, password } = c.req.valid('json');
    const sanitizedUsername = username.trim().toLowerCase();
    const sanitizedPassword = password.trim();

    // 1. Check if user is a Super Admin
    try {
      const superAdmin = await c.env.DB.prepare(
        'SELECT id, username, password_hash FROM super_admins WHERE LOWER(username) = ?'
      ).bind(sanitizedUsername).first<{ id: string; username: string; password_hash: string }>();

      if (superAdmin) {
        const isSuperValid = await verifyPassword(sanitizedPassword, superAdmin.password_hash);
        if (isSuperValid) {
          const token = await signJWT(
            { sub: superAdmin.id, role: 'super_admin' },
            c.env.JWT_SECRET
          );
          return c.json({
            success: true,
            token,
            role: 'super_admin',
            user: {
              id: superAdmin.id,
              username: superAdmin.username,
              role: 'super_admin',
            },
          });
        }
      }
    } catch {}

    // 2. Look up the user by username in users table
    let user = await c.env.DB.prepare(
      'SELECT id, username, password_hash, role, tenant_id, status FROM users WHERE LOWER(username) = ?'
    )
      .bind(sanitizedUsername)
      .first<{ id: string; username: string; password_hash: string; role: 'super_admin' | 'admin' | 'agent'; tenant_id: string | null; status: string }>();

    let isValid = false;

    if (user) {
      isValid = await verifyPassword(sanitizedPassword, user.password_hash);

      // Auto-migration upgrade for plain-text legacy passwords
      if (!isValid && user.password_hash === sanitizedPassword) {
        console.log(`[Auto-Migration] Upgrading plain text password for user: ${sanitizedUsername}`);
        const newHash = await hashPassword(sanitizedPassword);
        await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
          .bind(newHash, user.id)
          .run();
        isValid = true;
      }
    }

    // 3. If user not in users table, check if it's a tenant admin in tenants table
    if (!user) {
      try {
        const tenant = await c.env.DB.prepare(
          'SELECT id, name, admin_username, admin_password_hash, is_active FROM tenants WHERE LOWER(admin_username) = ?'
        ).bind(sanitizedUsername).first<{
          id: string;
          name: string;
          admin_username: string;
          admin_password_hash: string;
          is_active: number;
        }>();

        if (tenant && tenant.is_active) {
          const isTenantValid = await verifyPassword(sanitizedPassword, tenant.admin_password_hash);
          if (isTenantValid) {
            // Auto-create/sync user record
            const newUserId = crypto.randomUUID();
            await c.env.DB.prepare(`
              INSERT INTO users (id, username, password_hash, role, tenant_id, status, created_at)
              VALUES (?, ?, ?, 'admin', ?, 'offline', datetime('now'))
            `).bind(newUserId, tenant.admin_username, tenant.admin_password_hash, tenant.id).run();

            user = {
              id: newUserId,
              username: tenant.admin_username,
              password_hash: tenant.admin_password_hash,
              role: 'admin',
              tenant_id: tenant.id,
              status: 'offline',
            };
            isValid = true;
          }
        }
      } catch {}
    }

    // 4. Emergency Admin Fallback (Auto-Create only for default admin)
    if ((sanitizedUsername === 'admin' || sanitizedUsername === 'admin123') && !user) {
      console.log(`[Emergency Fallback] Creating default admin account & tenant.`);
      const newHash = await hashPassword(sanitizedPassword);
      const defaultTenantId = crypto.randomUUID();

      try {
        // Create default tenant if not exists
        await c.env.DB.prepare(`
          INSERT INTO tenants (id, name, admin_username, admin_password_hash, allocated_credits, spent_credits, max_agents, is_active)
          VALUES (?, 'Default Organization', ?, ?, 25.00, 0.00, 10, 1)
          ON CONFLICT(admin_username) DO NOTHING
        `).bind(defaultTenantId, sanitizedUsername, newHash).run();

        const newId = crypto.randomUUID();
        await c.env.DB.prepare(`
          INSERT INTO users (id, username, password_hash, role, tenant_id, status)
          VALUES (?, ?, ?, 'admin', ?, 'offline')
        `).bind(newId, sanitizedUsername, newHash, defaultTenantId).run();

        isValid = true;
        user = {
          id: newId,
          username: sanitizedUsername,
          password_hash: newHash,
          role: 'admin',
          tenant_id: defaultTenantId,
          status: 'offline',
        };
      } catch (upsertErr: any) {
        console.error('[Emergency Fallback Error]:', upsertErr);
      }
    }

    if (!isValid || !user) {
      console.log(`Login failed for user:`, sanitizedUsername);
      return c.json({ success: false, error: 'Invalid credentials' }, 401);
    }

    // Ensure tenant_id is linked
    let tenantId = user.tenant_id;
    if (!tenantId && user.role !== 'super_admin') {
      try {
        const defTenant = await c.env.DB.prepare('SELECT id FROM tenants LIMIT 1').first<{ id: string }>();
        if (defTenant) {
          tenantId = defTenant.id;
          await c.env.DB.prepare('UPDATE users SET tenant_id = ? WHERE id = ?').bind(tenantId, user.id).run();
        }
      } catch {}
    }

    // Sign a new JWT with tenantId
    const token = await signJWT(
      { sub: user.id, role: user.role, tenantId: tenantId || undefined },
      c.env.JWT_SECRET
    );

    return c.json({
      success: true,
      token,
      role: user.role || 'agent',
      tenant_id: tenantId || null,
      agent: {
        id: user.id,
        username: user.username,
        role: user.role || 'agent',
        tenant_id: tenantId || null,
      },
    }, 200);
  }
);

export default auth;
