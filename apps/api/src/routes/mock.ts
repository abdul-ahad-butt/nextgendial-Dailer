import { Hono } from 'hono';

export const mockRoute = new Hono();

// Mock Campaigns
mockRoute.get('/campaigns', (c) => c.json({ data: [] }));

// Mock Calls
mockRoute.get('/calls', (c) => c.json({ data: [], meta: { total: 0, page: 1, limit: 20 } }));

// Mock Agents (for WebRTC and status)
// Removed mock agents routes because they are now implemented in agents.ts
