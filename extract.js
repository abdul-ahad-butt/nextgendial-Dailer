const fs = require('fs');
const readline = require('readline');

async function extractLastUserMessage() {
  const fileStream = fs.createReadStream('C:\\Users\\Abdul Ahad Butt\\.gemini\\antigravity-ide\\brain\\fed7b4dd-e349-493d-8208-2f2613e58b9d\\.system_generated\\logs\\transcript.jsonl');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lastUserInput = '';

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const step = JSON.parse(line);
      if (step.type === 'USER_INPUT') {
        lastUserInput = step.content;
      }
    } catch (e) {
      // ignore
    }
  }

  // extract phase 4, 5, 6
  const idx = lastUserInput.indexOf('## Phase 4');
  if (idx !== -1) {
    console.log(lastUserInput.substring(idx, idx + 6000));
  } else {
    console.log("Not found in last user input. Input length:", lastUserInput.length);
  }
}

extractLastUserMessage();
