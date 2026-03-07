import path from 'path';
import fs from 'fs';
import os from 'os';
import { config } from '../config.js';

const ALLOWED_ROOTS_PATH = path.join(os.homedir(), '.telaude', 'allowed_project_roots.json');

export function loadAllowedRoots(): string[] {
  if (fs.existsSync(ALLOWED_ROOTS_PATH)) {
    try {
      const raw = fs.readFileSync(ALLOWED_ROOTS_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === 'string');
    } catch {
      // malformed JSON — fall through
    }
  }
  return config.paths.allowedRoots;
}

export function isPathAllowed(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const roots = loadAllowedRoots();

  // No allowed roots configured = allow all
  if (roots.length === 0) return true;

  return roots.some(root => {
    const normalizedRoot = path.resolve(root);
    return resolved === normalizedRoot || resolved.startsWith(normalizedRoot + path.sep);
  });
}

export function isPathExists(targetPath: string): boolean {
  try {
    return fs.existsSync(path.resolve(targetPath));
  } catch {
    return false;
  }
}

export function validatePath(targetPath: string): { valid: boolean; resolved: string; error?: string } {
  const resolved = path.resolve(targetPath);

  if (!isPathAllowed(resolved)) {
    return {
      valid: false,
      resolved,
      error: `Path not allowed: ${resolved}\nAllowed: ${config.paths.allowedRoots.join(', ')}`,
    };
  }

  if (!isPathExists(resolved)) {
    return { valid: false, resolved, error: `Path does not exist: ${resolved}` };
  }

  return { valid: true, resolved };
}
