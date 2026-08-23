const { spawn } = require('child_process');
const crypto = require('crypto');

// Generate 32 random bytes as hex string
const secret = crypto.randomBytes(32).toString('hex');
console.log('Generated JWT_SECRET:', secret);

const child = spawn('npx.cmd', ['wrangler', 'secret', 'put', 'JWT_SECRET'], {
  stdio: ['pipe', 'inherit', 'inherit'],
  shell: true
});

child.stdin.write(secret + '\n');
child.stdin.end();

child.on('close', (code) => {
  console.log('wrangler secret put exited with code', code);
});
