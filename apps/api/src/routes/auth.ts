import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { verifyPassword, signJWT } from '../auth/crypto';

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
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    // Look up the user by username in D1 (case-insensitive)
    const user = await c.env.DB.prepare(
      'SELECT id, username, password_hash, role, status FROM users WHERE LOWER(username) = LOWER(?)'
    )
      .bind(trimmedUsername)
      .first<{ id: string; username: string; password_hash: string; role: string; status: string }>();

    // Generic 401 if not found
    if (!user) {
      console.log(`[Login Failed] Username not found: ${trimmedUsername}`);
      return c.json({ error: 'Invalid username or password' }, 401);
    }

    // Check password
    let isValid = await verifyPassword(trimmedPassword, user.password_hash);
    
    // Auto-migration logic: If the password fails the new hash check, 
    // see if it matches the stored hash exactly (i.e. was stored as plain text)
    if (!isValid && user.password_hash === trimmedPassword) {
      console.log(`[Auto-Migration] Upgrading plain text password for user: ${trimmedUsername}`);
      const newHash = await hashPassword(trimmedPassword);
      await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .bind(newHash, user.id)
        .run();
      isValid = true;
    }

    if (!isValid) {
      console.log(`Login failed for user:`, trimmedUsername);
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
      agent: {
        id: user.id,
        username: user.username,
        status: user.status || 'offline',
      }
    }, 200);
  }
);

export default auth;
