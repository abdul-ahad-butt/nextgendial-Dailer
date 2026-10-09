import { createMiddleware } from 'hono/factory';
import { verifyJWT } from './crypto';
import type { AppEnv } from '../types';

/**
 * Parses the Bearer token, verifies it, and attaches userId, role, and tenantId to context.
 */
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return c.json({ error: 'Token missing' }, 401);
  }

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  c.set('userId', payload.sub);
  c.set('role', payload.role);

  // If token has tenantId, attach it directly
  if (payload.tenantId) {
    c.set('tenantId', payload.tenantId);
  } else if (payload.role !== 'super_admin') {
    // Resolve tenantId from DB for existing users or tokens without tenantId in payload
    try {
      const user = await c.env.DB.prepare('SELECT tenant_id FROM users WHERE id = ?')
        .bind(payload.sub)
        .first<{ tenant_id: string | null }>();
      if (user?.tenant_id) {
        c.set('tenantId', user.tenant_id);
      }
    } catch {
      // Non-fatal if table doesn't have column yet
    }
  }

  return next();
});

/**
 * Ensures the authenticated user has one of the specified roles.
 * Must be used AFTER authMiddleware.
 */
export const requireRole = (roleOrRoles: ('super_admin' | 'admin' | 'agent') | Array<'super_admin' | 'admin' | 'agent'>) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const userRole = c.get('role');
    const allowed = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
    if (!allowed.includes(userRole)) {
      return c.json({ error: 'Forbidden: Insufficient privileges' }, 403);
    }
    return next();
  });

/**
 * Ensures that the request has an active tenantId associated.
 * Must be used AFTER authMiddleware.
 */
export const requireTenant = createMiddleware<AppEnv>(async (c, next) => {
  const role = c.get('role');
  if (role === 'super_admin') {
    return next(); // Super admin bypasses tenant constraint
  }

  const tenantId = c.get('tenantId');
  if (!tenantId) {
    return c.json({ error: 'Tenant organization context required' }, 403);
  }

  return next();
});
