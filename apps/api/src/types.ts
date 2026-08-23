/**
 * apps/api/src/types.ts
 * Cloudflare Worker Env bindings.
 */
export interface Env {
  /** D1 database binding */
  DB: D1Database;

  /** Telnyx Bearer token for REST API calls */
  TELNYX_API_KEY: string;

  /**
   * Ed25519 public key (base64-encoded) from Telnyx Mission Control →
   * Keys & Credentials → Ed25519 Public Key.
   * Used to verify incoming webhook signatures.
   */
  TELNYX_PUBLIC_KEY: string;

  /**
   * Telnyx Call Control Application / Connection ID.
   * All outbound dials go through this connection.
   */
  TELNYX_CONNECTION_ID: string;

  /**
   * Public URL of this Worker, e.g.
   * https://nextgendial-api.your-subdomain.workers.dev
   * Used to build the webhook_url passed to Telnyx on every dial.
   */
  APP_BASE_URL: string;

  /**
   * Allowed origin for CORS (the frontend URL).
   */
  ALLOWED_ORIGIN: string;

  /**
   * JWT Secret key for signing and verifying authentication tokens.
   */
  JWT_SECRET: string;

  /**
   * The default Telnyx phone number used if an agent doesn't have one assigned.
   */
  TELNYX_DEFAULT_NUMBER: string;
}

/**
 * Hono context variables injected by middleware.
 */
export interface Variables {
  userId: string;
  role: 'admin' | 'agent';
}

/**
 * Convenience type for Hono app generic argument.
 */
export type AppEnv = {
  Bindings: Env;
  Variables: Variables;
};
