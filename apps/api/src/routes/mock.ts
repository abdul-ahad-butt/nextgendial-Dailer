import { Hono } from 'hono';

export const mockRoute = new Hono();

// Mock Campaigns
mockRoute.get('/campaigns', (c) => c.json({ data: [] }));

// Mock Calls
mockRoute.get('/calls', (c) => c.json({ data: [], meta: { total: 0, page: 1, limit: 20 } }));

// Mock Agents (for WebRTC and status)
mockRoute.get('/agents/:id', (c) => c.json({ data: { id: c.req.param('id'), name: 'Agent', status: 'offline' } }));
mockRoute.get('/agents/:id/status', (c) => c.json({ data: { status: 'offline' } }));
mockRoute.patch('/agents/:id/status', async (c) => {
  const body = await c.req.json();
  return c.json({ data: { status: body.status || 'offline' } });
});
mockRoute.post('/agents/:id/webrtc-token', (c) => c.json({ token: 'mock-token' }));
