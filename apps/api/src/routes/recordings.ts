import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { authMiddleware, requireRole } from '../auth/middleware';

const recordings = new Hono<AppEnv>();

// Admin-only: proxy audio from R2 so raw credentials are never exposed to the browser
recordings.use('*', authMiddleware);
recordings.use('*', requireRole('admin'));

/**
 * GET /recordings/:key  
 * Streams the audio file from R2 to the client.
 * The :key param is a URL-encoded R2 object key, e.g. "recordings%2Fcall-uuid.wav"
 */
recordings.get('/:key{.+}', async (c) => {
  const r2Key = decodeURIComponent(c.req.param('key'));

  if (!c.env.RECORDINGS) {
    return c.json({ error: 'R2 recordings bucket not configured' }, 503);
  }

  const obj = await c.env.RECORDINGS.get(r2Key);
  if (!obj) {
    return c.json({ error: 'Recording not found' }, 404);
  }

  const contentType = obj.httpMetadata?.contentType || 'audio/wav';
  const body = await obj.arrayBuffer();

  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `inline; filename="${r2Key.split('/').pop()}"`,
    },
  });
});

export default recordings;
