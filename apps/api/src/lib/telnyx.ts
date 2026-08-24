/**
 * apps/api/src/lib/telnyx.ts
 *
 * Thin fetch-based wrapper around the Telnyx v2 REST API.
 * Uses NO external Telnyx SDK — the telnyx-node package is not
 * Workers-runtime safe. All HTTP calls use the global fetch().
 *
 * Signature verification uses @noble/ed25519, a pure-JS Ed25519
 * implementation that works without native WebCrypto Ed25519 support
 * (which varies across Workers environments).
 */

import { verify } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import type { Env } from '../types';

// @noble/ed25519 v2+ requires a synchronous sha512 implementation
// to be provided in non-Node environments.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).__noble_ed25519_sha512 = sha512;

const TELNYX_BASE = 'https://api.telnyx.com/v2';

// ----------------------------------------------------------------
// Base request helper
// ----------------------------------------------------------------

export async function telnyxRequest(
  env: Env,
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${TELNYX_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telnyx API error ${res.status} on ${method} ${path}: ${text}`);
  }

  // Some Telnyx actions return 200 with no body
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ----------------------------------------------------------------
// Call Control — Dial
// ----------------------------------------------------------------

export interface DialOptions {
  to: string;
  from: string;
  connectionId: string;
  webhookUrl: string;
  clientState: string; // base64-encoded
  answeringMachineDetection?: 'premium' | 'disabled';
  record?: 'record-from-answer';
}

/**
 * Initiate an outbound call via Telnyx Call Control.
 * Returns the call_control_id of the newly created call leg.
 */
export async function dialNumber(env: Env, opts: DialOptions): Promise<string> {
  const body: Record<string, unknown> = {
    connection_id: opts.connectionId,
    to: opts.to,
    from: opts.from,
    webhook_url: opts.webhookUrl,
    client_state: opts.clientState,
  };

  if (opts.answeringMachineDetection && opts.answeringMachineDetection !== 'disabled') {
    body['answering_machine_detection'] = opts.answeringMachineDetection;
  }
  if (opts.record) {
    body['record'] = opts.record;
  }

  const response = (await telnyxRequest(env, '/calls', 'POST', body)) as {
    data: { call_control_id: string };
  };

  return response.data.call_control_id;
}

// ----------------------------------------------------------------
// Call Control — Bridge
// ----------------------------------------------------------------

/**
 * Bridge two call legs together.
 * callControlIdA is the "destination" leg — we call the bridge action
 * on it and pass callControlIdB as the party to bridge with.
 */
export async function bridgeCalls(
  env: Env,
  callControlIdA: string,
  callControlIdB: string,
): Promise<void> {
  await telnyxRequest(
    env,
    `/calls/${callControlIdA}/actions/bridge`,
    'POST',
    { call_control_id: callControlIdB },
  );
}

// ----------------------------------------------------------------
// Call Control — Hangup
// ----------------------------------------------------------------

export async function hangupCall(env: Env, callControlId: string): Promise<void> {
  await telnyxRequest(env, `/calls/${callControlId}/actions/hangup`, 'POST', {});
}

// ----------------------------------------------------------------
// WebRTC Token
// ----------------------------------------------------------------

/**
 * Mint a fresh 24-hour WebRTC login token for the given Telnyx
 * Telephony Credential resource. Always generate a fresh token on
 * login/reconnect rather than caching — tokens expire after 24h.
 */
export async function generateWebrtcToken(
  env: Env,
  telnyxCredentialId: string,
): Promise<string> {
  const response = (await telnyxRequest(
    env,
    `/telephony_credentials/${telnyxCredentialId}/token`,
    'POST',
  )) as string;

  // The token endpoint returns a raw JWT string, not a JSON object
  return response;
}

// ----------------------------------------------------------------
// Webhook Signature Verification
// ----------------------------------------------------------------

/**
 * Verify an incoming Telnyx webhook's Ed25519 signature.
 *
 * Telnyx signs: `${telnyx-timestamp}|${raw request body}`
 * The signature is base64-encoded in the `telnyx-signature-ed25519` header.
 * The public key is base64-encoded in the Telnyx Mission Control dashboard
 * (Keys & Credentials → Ed25519 Public Key).
 *
 * Also rejects events older than 300 seconds to prevent replay attacks.
 *
 * @returns true if signature is valid and timestamp is fresh
 */
export async function verifyTelnyxSignature(
  rawBody: string,
  signatureHeaderB64: string,
  timestampHeader: string,
  publicKeyB64: string,
): Promise<boolean> {
  // Replay-attack protection: reject stale events
  const eventTs = parseInt(timestampHeader, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - eventTs) > 300) {
    console.warn(`Telnyx webhook timestamp too stale: ${timestampHeader}`);
    return false;
  }

  // The signed message is the concatenation: `{timestamp}|{body}`
  const message = `${timestampHeader}|${rawBody}`;

  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(message);
  const signatureBytes = base64ToUint8Array(signatureHeaderB64);
  const publicKeyBytes = base64ToUint8Array(publicKeyB64);

  try {
    return await verify(signatureBytes, messageBytes, publicKeyBytes);
  } catch {
    return false;
  }
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
