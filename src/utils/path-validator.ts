import path from 'path';
import fs from 'fs';
import { config } from '../config.js';

export function isPathAllowed(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);

  // No allowed roots configured = allow all
  if (config.paths.allowedRoots.length === 0) return true;

  return config.paths.allowedRoots.some(root => {
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
