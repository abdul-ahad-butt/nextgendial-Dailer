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

    // Look up the user by username in D1
    const user = await c.env.DB.prepare(
      'SELECT id, password_hash, role FROM users WHERE username = ?'
    )
      .bind(username)
      .first<{ id: string; password_hash: string; role: string }>();

    // Generic 401 if not found
    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Generic 401 if password fails
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Sign a new JWT
    const token = await signJWT(
      { sub: user.id, role: user.role as 'admin' | 'agent' },
      c.env.JWT_SECRET
    );

    return c.json({
      token,
      role: user.role,
      userId: user.id,
    });
  }
);

export default auth;
