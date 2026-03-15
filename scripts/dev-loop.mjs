import { execSync } from 'child_process';
import { createConnection } from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';

const RELOAD_FLAG = path.join(os.homedir(), '.telaude', 'data', '.reload-flag');
const PORT = 19816;
const MAX_WAIT_MS = 30000;

/** Wait until port is free (connection refused = free) */
async function waitForPortFree() {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const inUse = await new Promise(resolve => {
      const sock = createConnection({ port: PORT, host: '127.0.0.1' });
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => resolve(false));
    });
    if (!inUse) return;
    await new Promise(r => setTimeout(r, 500));
  }
  console.warn(`[dev-loop] Port ${PORT} still in use after ${MAX_WAIT_MS / 1000}s, proceeding anyway`);
}

while (true) {
  let exitCode = 0;
  try {
    execSync('bun src/index.ts', { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } });
  } catch (err) {
    exitCode = err.status ?? 1;
  }

  // Only restart if reload flag exists (set by /reload command)
  if (fs.existsSync(RELOAD_FLAG)) {
    if (exitCode !== 0) {
      // Process crashed — remove flag to prevent infinite loop
      console.error(`[dev-loop] Process exited with code ${exitCode}, stopping restart loop.`);
      try { fs.unlinkSync(RELOAD_FLAG); } catch {}
      break;
    }
    console.log('[dev-loop] Restarting...');
    await waitForPortFree();
    continue;
  }

  // Normal exit — stop the loop
  break;
}
