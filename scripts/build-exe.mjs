import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

console.log('[build] Compiling single binary...');
execSync(
  'bun build --compile src/index.ts --outfile TELAUDE.exe --external mock-aws-s3 --external aws-sdk --external nock --external @napi-rs/keyring --external term.js --external pty.js',
  { cwd: root, stdio: 'inherit' }
);

// Note: path scrubbing disabled — it breaks blessed's terminfo lookup.
// Build path (D:\Development\TELAUDE) contains no personal info.
// If building from a path with personal info, use scrub-paths.py manually.

console.log('[build] Applying icon...');
execSync(
  `python "${resolve(root, 'scripts', 'apply-icon.py')}" "${resolve(root, 'TELAUDE.exe')}" "${resolve(root, 'TELAUDE.ico')}"`,
  { cwd: root, stdio: 'inherit' }
);

console.log('[build] Done: TELAUDE.exe');
