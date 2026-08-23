import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { authMiddleware } from '../auth/middleware';

const agent = new Hono<AppEnv>();

// Require authentication for all agent routes
agent.use('*', authMiddleware);

agent.get('/caller-id', async (c) => {
  const userId = c.get('userId');
  
  const user = await c.env.DB.prepare('SELECT assigned_phone_number FROM users WHERE id = ?')
    .bind(userId)
    .first<{ assigned_phone_number: string }>();

  // Fallback to the default if not assigned
  const callerId = user?.assigned_phone_number || '+19564461280';

  return c.json({ callerId });
});

export default agent;
