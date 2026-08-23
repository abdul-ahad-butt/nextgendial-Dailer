import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

import { hashPassword } from '../src/auth/crypto';

async function main() {
  const rl = readline.createInterface({ input, output });

  try {
    const password = await rl.question('Enter password for new admin user: ');
    
    if (!password) {
      console.error('Password cannot be empty.');
      process.exit(1);
    }

    const hashedPassword = await hashPassword(password);
    const userId = crypto.randomUUID();

    // The SQL to insert the admin
    const sql = `
INSERT INTO users (id, username, password_hash, role)
VALUES ('${userId}', 'admin', '${hashedPassword}', 'admin');
    `.trim();

    console.log('\nRun the following command to insert the admin user:');
    console.log(`\nnpx wrangler d1 execute autodialer_db --local --command "${sql}"\n`);
    
    // In production, we'd run:
    // console.log(`npx wrangler d1 execute autodialer_db --remote --command "${sql}"`);

  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error('Error seeding admin:', err);
  process.exit(1);
});
