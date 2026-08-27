/**
 * apps/api/src/auth/crypto.ts
 *
 * Password hashing and JWT utilities using the Web Crypto API.
 */

// ── Base64Url / Hex Utilities ──────────────────────────────────

function bufferToBase64Url(buffer: ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function stringToBase64Url(str: string): string {
  const encoder = new TextEncoder();
  return bufferToBase64Url(encoder.encode(str).buffer);
}

function base64UrlToBuffer(b64url: string): ArrayBuffer {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) {
    b64 += '=';
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bufferToHex(buffer: ArrayBufferLike): string {
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

// ── Password Hashing ──────────────────────────────────────────
//
// Format: "<16-byte-salt-as-hex>:<32-byte-PBKDF2-hash-as-hex>"
// PBKDF2 params: SHA-256, 100 000 iterations, 256-bit output.
//
// verifyPassword also accepts the legacy plain-SHA-256 format
// (a 64-char hex string with no colon) so that any accounts
// hashed before this change can still log in; auth.ts's
// auto-migration block will upgrade them on the next successful
// login.

export async function hashPassword(pwd: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pwd),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
    keyMaterial,
    256,
  );

  const saltHex = bufferToHex(salt.buffer as ArrayBufferLike);
  const hashHex = bufferToHex(bits);
  return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  // ── PBKDF2 path ───────────────────────────────────────────
  if (stored.includes(':')) {
    const colonIdx = stored.indexOf(':');
    const saltHex = stored.slice(0, colonIdx);
    const storedHashHex = stored.slice(colonIdx + 1);

    if (!saltHex || !storedHashHex) return false;

    const salt = hexToBuffer(saltHex);

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );

    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations: 100_000 },
      keyMaterial,
      256,
    );

    const derivedHex = bufferToHex(bits);

    // Timing-safe comparison of the hash half only
    if (derivedHex.length !== storedHashHex.length) return false;
    let mismatch = 0;
    for (let i = 0; i < derivedHex.length; i++) {
      mismatch |= derivedHex.charCodeAt(i) ^ storedHashHex.charCodeAt(i);
    }
    return mismatch === 0;
  }

  // ── Legacy SHA-256 fallback (plain 64-char hex, no salt) ──
  // Used only to allow login while a hash upgrade is pending.
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  const legacyHash = bufferToHex(buf);

  if (legacyHash.length !== stored.length) return false;
  let mismatch = 0;
  for (let i = 0; i < legacyHash.length; i++) {
    mismatch |= legacyHash.charCodeAt(i) ^ stored.charCodeAt(i);
  }
  return mismatch === 0;
}

// ── JWT ───────────────────────────────────────────────────────

export async function signJWT(
  payload: { sub: string; role: 'admin' | 'agent' },
  secret: string | undefined,
  expiresInSeconds = 86400
): Promise<string> {
  if (!secret) {
    throw new Error('JWT_SECRET is not configured on the server.');
  }

  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + expiresInSeconds;
  
  const fullPayload = { ...payload, iat, exp };

  const encodedHeader = stringToBase64Url(JSON.stringify(header));
  const encodedPayload = stringToBase64Url(JSON.stringify(fullPayload));

  const dataToSign = `${encodedHeader}.${encodedPayload}`;
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(dataToSign)
  );

  const encodedSignature = bufferToBase64Url(signatureBuffer);
  return `${dataToSign}.${encodedSignature}`;
}

export async function verifyJWT(token: string, secret: string | undefined): Promise<{ sub: string; role: string } | null> {
  if (!secret) {
    console.error('JWT_SECRET is not configured on the server.');
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const dataToSign = `${encodedHeader}.${encodedPayload}`;
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  try {
    const signatureBuffer = base64UrlToBuffer(encodedSignature);
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      encoder.encode(dataToSign)
    );

    if (!isValid) return null;

    const decodedPayloadStr = new TextDecoder().decode(base64UrlToBuffer(encodedPayload));
    const payload = JSON.parse(decodedPayloadStr);

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }

    return payload;
  } catch (e) {
    return null; // parse or verification error
  }
}
