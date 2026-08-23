const { webcrypto: crypto } = require('crypto');

function bufferToHex(buffer) {
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LENGTH_BYTES = 32;

async function verifyPassword(password, stored) {
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

  if (newHashHex.length !== storedHashHex.length) return false;
  
  let mismatch = 0;
  for (let i = 0; i < newHashHex.length; i++) {
    mismatch |= newHashHex.charCodeAt(i) ^ storedHashHex.charCodeAt(i);
  }
  return mismatch === 0;
}

verifyPassword('DevAhad@$$', 'd7743f3f718b9aa9593526c929588d1b:3343ba56dcd1464feb5bfcb92c477ef5b4d6113f021007f1e44bfe31212c4762')
  .then(res => console.log('Result:', res))
  .catch(console.error);
