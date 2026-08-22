/**
 * apps/api/src/lib/clientState.ts
 *
 * Telnyx passes client_state back in every webhook event unchanged.
 * We store a small JSON blob (base64-encoded) so every webhook handler
 * can identify which leg (lead vs agent) the event belongs to, and which
 * call_log row to update — without querying the DB just for correlation.
 */

import type { ClientState } from '@nextgendial/shared-types';

export function encodeClientState(obj: ClientState): string {
  return btoa(JSON.stringify(obj));
}

export function decodeClientState(str: string): ClientState {
  return JSON.parse(atob(str)) as ClientState;
}
