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

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LENGTH_BYTES = 32; // 256 bits

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    PBKDF2_KEY_LENGTH_BYTES * 8 // in bits
  );

  const saltHex = bufferToHex(salt.buffer);
  const hashHex = bufferToHex(hashBuffer);

  return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, storedHashHex] = stored.split(':');
  if (!saltHex || !storedHashHex) return false;

  const saltBuffer = hexToBuffer(saltHex);
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    PBKDF2_KEY_LENGTH_BYTES * 8
  );

  const newHashHex = bufferToHex(hashBuffer);

  // Timing safe comparison approximation for hex strings
  if (newHashHex.length !== storedHashHex.length) return false;
  
  let mismatch = 0;
  for (let i = 0; i < newHashHex.length; i++) {
    mismatch |= newHashHex.charCodeAt(i) ^ storedHashHex.charCodeAt(i);
  }
  return mismatch === 0;
}

// ── JWT ───────────────────────────────────────────────────────

export async function signJWT(
  payload: { sub: string; role: 'admin' | 'agent' },
  secret: string,
  expiresInSeconds = 86400
): Promise<string> {
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

export async function verifyJWT(token: string, secret: string): Promise<{ sub: string; role: string } | null> {
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
