import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const RELOAD_FLAG = path.join(os.homedir(), '.telaude', 'data', '.reload-flag');

while (true) {
  try {
    execSync('bun src/index.ts', { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } });
  } catch {
    // process.exit() throws
  }

  // Only restart if reload flag exists (set by /reload command)
  if (fs.existsSync(RELOAD_FLAG)) {
    console.log('[dev-loop] Restarting...');
    continue;
  }

  // Normal exit — stop the loop
  break;
}
