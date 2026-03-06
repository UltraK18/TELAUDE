/**
 * OS-native credential protection for sensitive files (.env).
 *
 * - Windows: DPAPI (CurrentUser scope) — only the same Windows account can decrypt
 * - macOS:   Keychain Services via @napi-rs/keyring — only the same macOS account can decrypt
 * - Linux:   AES-256-GCM with machine-id + UID key derivation (headless server compatible)
 */
import crypto from 'crypto';
import os from 'os';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const ENC_HEADER = 'TELAUDE_ENC:';
const ENC_HEADER_V2 = 'TELAUDE_ENCv2:';

// --- Platform-specific backends ---

interface CryptoBackend {
  encrypt(data: Buffer): Buffer;
  decrypt(data: Buffer): Buffer | null;
}

function getWindowsBackend(): CryptoBackend {
  const { Dpapi } = require('@primno/dpapi');
  return {
    encrypt(data: Buffer): Buffer {
      return Buffer.from(Dpapi.protectData(data, null, 'CurrentUser'));
    },
    decrypt(data: Buffer): Buffer | null {
      try {
        return Buffer.from(Dpapi.unprotectData(data, null, 'CurrentUser'));
      } catch {
        return null;
      }
    },
  };
}

function getMacBackend(): CryptoBackend {
  const { Entry } = require('@napi-rs/keyring');
  const SERVICE = 'com.telaude.env';
  const ACCOUNT = 'encryption-key';

  // Get or create a persistent AES key stored in macOS Keychain
  function getOrCreateKey(): Buffer {
    const entry = new Entry(SERVICE, ACCOUNT);
    try {
      const existing = entry.getPassword();
      return Buffer.from(existing, 'base64');
    } catch {
      // No key yet — generate and store
      const key = crypto.randomBytes(32);
      entry.setPassword(key.toString('base64'));
      return key;
    }
  }

  return {
    encrypt(data: Buffer): Buffer {
      const key = getOrCreateKey();
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      const authTag = cipher.getAuthTag();
      // Format: iv(16) + authTag(16) + ciphertext
      return Buffer.concat([iv, authTag, encrypted]);
    },
    decrypt(data: Buffer): Buffer | null {
      try {
        const key = getOrCreateKey();
        const iv = data.subarray(0, 16);
        const authTag = data.subarray(16, 32);
        const ciphertext = data.subarray(32);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      } catch {
        return null;
      }
    },
  };
}

function getLinuxBackend(): CryptoBackend {
  // Derive key from machine-id + UID (headless server compatible, no D-Bus needed)
  function deriveKey(): Buffer {
    let machineId = 'unknown';
    for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      try {
        machineId = fs.readFileSync(p, 'utf-8').trim();
        break;
      } catch { /* try next */ }
    }
    const uid = process.getuid?.() ?? 'no-uid';
    const fingerprint = `${machineId}:${uid}:telaude`;
    return crypto.scryptSync(fingerprint, 'telaude-linux-v2', 32);
  }

  return {
    encrypt(data: Buffer): Buffer {
      const key = deriveKey();
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return Buffer.concat([iv, authTag, encrypted]);
    },
    decrypt(data: Buffer): Buffer | null {
      try {
        const key = deriveKey();
        const iv = data.subarray(0, 16);
        const authTag = data.subarray(16, 32);
        const ciphertext = data.subarray(32);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      } catch {
        return null;
      }
    },
  };
}

let _backend: CryptoBackend | null = null;

function getBackend(): CryptoBackend {
  if (_backend) return _backend;

  switch (process.platform) {
    case 'win32':
      _backend = getWindowsBackend();
      break;
    case 'darwin':
      _backend = getMacBackend();
      break;
    default:
      _backend = getLinuxBackend();
      break;
  }
  return _backend;
}

// --- Public API (unchanged interface) ---

/** Encrypt a file in-place. Adds v2 marker header. */
export function encryptFile(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (content.startsWith(ENC_HEADER_V2) || content.startsWith(ENC_HEADER)) return; // already encrypted

  const backend = getBackend();
  const encrypted = backend.encrypt(Buffer.from(content, 'utf-8'));
  fs.writeFileSync(filePath, `${ENC_HEADER_V2}${encrypted.toString('base64')}`, 'utf-8');
}

/** Decrypt a file and return contents. Returns null if wrong machine/user. */
export function decryptFile(filePath: string): string | null {
  const raw = fs.readFileSync(filePath, 'utf-8');

  // v2 format (OS-native)
  if (raw.startsWith(ENC_HEADER_V2)) {
    const data = Buffer.from(raw.slice(ENC_HEADER_V2.length), 'base64');
    const result = getBackend().decrypt(data);
    return result ? result.toString('utf-8') : null;
  }

  // v1 format (legacy machine-lock) — decrypt then re-encrypt as v2
  if (raw.startsWith(ENC_HEADER)) {
    const v1Result = decryptV1(raw.slice(ENC_HEADER.length));
    if (v1Result !== null) {
      // Auto-migrate to v2
      fs.writeFileSync(filePath, v1Result, 'utf-8');
      encryptFile(filePath);
    }
    return v1Result;
  }

  // Not encrypted — return as-is
  return raw;
}

/** Check if a file is encrypted */
export function isEncrypted(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const head = fs.readFileSync(filePath, 'utf-8').slice(0, ENC_HEADER_V2.length);
  return head.startsWith(ENC_HEADER_V2) || head.startsWith(ENC_HEADER);
}

// --- v1 backward compatibility (will be removed in future) ---

function decryptV1(encoded: string): string | null {
  try {
    const [ivB64, tagB64, cipherB64] = encoded.split(':');
    if (!ivB64 || !tagB64 || !cipherB64) return null;

    const key = deriveKeyV1();
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(cipherB64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

function deriveKeyV1(): Buffer {
  const hostname = os.hostname();
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
  const fingerprint = `${hostname}:${mac}:${process.cwd()}`;
  return crypto.scryptSync(fingerprint, 'telaude-machine-lock-v1', 32);
}
