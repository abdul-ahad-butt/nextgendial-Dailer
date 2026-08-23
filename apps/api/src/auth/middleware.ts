import { createMiddleware } from 'hono/factory';
import { verifyJWT } from './crypto';
import type { AppEnv } from '../types';

/**
 * Parses the Bearer token, verifies it, and attaches userId and role to context.
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
  c.set('role', payload.role as 'admin' | 'agent');

  return next();
});

/**
 * Ensures the authenticated user has the specified role.
 * Must be used AFTER authMiddleware.
 */
export const requireRole = (role: 'admin' | 'agent') =>
  createMiddleware<AppEnv>(async (c, next) => {
    const userRole = c.get('role');
    if (userRole !== role) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    return next();
  });
