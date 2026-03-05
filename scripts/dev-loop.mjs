import { execSync } from 'child_process';

while (true) {
  try {
    execSync('tsx src/index.ts', { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } });
  } catch {
    // process.exit() throws — restart
  }
  console.log('[dev-loop] Restarting...');
}
