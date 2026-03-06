/**
 * Machine-bound encryption for sensitive files (.env, telaude.db).
 *
 * Derives an AES-256 key from machine-specific values (hostname + MAC + install path).
 * Files encrypted on one machine cannot be decrypted on another.
 */
import crypto from 'crypto';
import os from 'os';
import fs from 'fs';

const ALGORITHM = 'aes-256-gcm';
const SALT = 'telaude-machine-lock-v1';

/** Collect machine fingerprint: hostname + first non-internal MAC + install path */
function getMachineFingerprint(): string {
  const hostname = os.hostname();
  const installPath = process.cwd();

  // Get first non-internal MAC address
  let mac = 'no-mac';
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        mac = iface.mac;
        break;
      }
    }
    if (mac !== 'no-mac') break;
  }

  return `${hostname}:${mac}:${installPath}`;
}

/** Derive AES-256 key from machine fingerprint */
function deriveKey(): Buffer {
  const fingerprint = getMachineFingerprint();
  return crypto.scryptSync(fingerprint, SALT, 32);
}

/** Encrypt plaintext string → base64 encoded (iv:authTag:ciphertext) */
export function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/** Decrypt base64 encoded string → plaintext. Returns null on failure (wrong machine). */
export function decrypt(encoded: string): string | null {
  try {
    const [ivB64, tagB64, cipherB64] = encoded.split(':');
    if (!ivB64 || !tagB64 || !cipherB64) return null;

    const key = deriveKey();
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(cipherB64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

/** Encrypt a file in-place. Adds .enc marker header. */
export function encryptFile(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (content.startsWith('TELAUDE_ENC:')) return; // already encrypted
  const encrypted = encrypt(content);
  fs.writeFileSync(filePath, `TELAUDE_ENC:${encrypted}`, 'utf-8');
}

/** Decrypt a file and return contents. Returns null if wrong machine. */
export function decryptFile(filePath: string): string | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.startsWith('TELAUDE_ENC:')) return content; // not encrypted, return as-is
  return decrypt(content.slice('TELAUDE_ENC:'.length));
}

/** Check if a file is encrypted */
export function isEncrypted(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const head = fs.readFileSync(filePath, 'utf-8').slice(0, 12);
  return head === 'TELAUDE_ENC:';
}
