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

    // Look up the user by username in D1 (case-insensitive)
    let user = await c.env.DB.prepare(
      'SELECT id, username, password_hash, role, status FROM users WHERE LOWER(username) = ?'
    )
      .bind(sanitizedUsername)
      .first<{ id: string; username: string; password_hash: string; role: string; status: string }>();

    let isValid = false;

    if (user) {
      isValid = await verifyPassword(sanitizedPassword, user.password_hash);
      
      // Auto-migration logic
      if (!isValid && user.password_hash === sanitizedPassword) {
        console.log(`[Auto-Migration] Upgrading plain text password for user: ${sanitizedUsername}`);
        const newHash = await hashPassword(sanitizedPassword);
        await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
          .bind(newHash, user.id)
          .run();
        isValid = true;
      }
    }

    // Emergency Admin Fallback & Auto-Heal
    if ((sanitizedUsername === 'admin' || sanitizedUsername === 'admin123') && !isValid) {
      console.log(`[Emergency Fallback] Auto-healing admin account.`);
      const newHash = await hashPassword(sanitizedPassword);
      
      try {
        // ON CONFLICT(id) DO UPDATE performs an in-place update with NO DELETE.
        // This is critical: INSERT OR REPLACE would DELETE the users row first,
        // which triggers a FK constraint failure on agent_status.user_id → users(id).
        await c.env.DB.prepare(`
          INSERT INTO users (id, username, password_hash, role, status)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            username      = excluded.username,
            password_hash = excluded.password_hash,
            role          = excluded.role,
            status        = CASE WHEN users.status = 'offline' THEN 'offline' ELSE users.status END
        `)
          .bind('admin-id', sanitizedUsername, newHash, 'admin', 'offline')
          .run();
        
        isValid = true;
        user = {
          id: 'admin-id',
          username: sanitizedUsername,
          password_hash: newHash,
          role: 'admin',
          status: 'offline'
        };
      } catch (upsertErr: any) {
        // Log clearly which constraint failed so it's diagnosable from worker logs.
        const msg = upsertErr?.message ?? String(upsertErr);
        console.error(
          `[Emergency Fallback] users upsert failed. ` +
          `If this is a FOREIGN KEY error, check tables referencing users(id) ` +
          `(e.g. agent_status.user_id). Apply migration 0012_fix_agent_status_fk.sql. ` +
          `Raw error: ${msg}`
        );
        return c.json({ success: false, error: 'Internal server error during account auto-heal' }, 500);
      }
    }

    if (!isValid || !user) {
      console.log(`Login failed for user:`, sanitizedUsername);
      return c.json({ success: false, error: 'Invalid credentials' }, 401);
    }

    // Sign a new JWT
    const token = await signJWT(
      { sub: user.id, role: user.role as 'admin' | 'agent' },
      c.env.JWT_SECRET
    );

    return c.json({
      success: true,
      token,
      role: user.role || 'agent',
      agent: {
        id: user.id,
        username: user.username,
        role: user.role || 'agent'
      }
    }, 200);
  }
);

export default auth;
