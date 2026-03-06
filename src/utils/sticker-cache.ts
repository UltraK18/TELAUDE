import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';

const CACHE_DIR = path.join(os.homedir(), '.telaude', 'data', 'sticker-cache');
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCachePath(fileUniqueId: string): string {
  return path.join(CACHE_DIR, `${fileUniqueId}.jpg`);
}

/**
 * Get cached sticker JPG path, or null if not cached.
 * Touching atime on hit for expiry tracking.
 */
export function getCachedSticker(fileUniqueId: string): string | null {
  const cachePath = getCachePath(fileUniqueId);
  if (fs.existsSync(cachePath)) {
    // Touch access time
    const now = new Date();
    fs.utimesSync(cachePath, now, fs.statSync(cachePath).mtime);
    return cachePath;
  }
  return null;
}

/**
 * Convert WebP sticker buffer to 128x JPG and cache it.
 */
export async function cacheSticker(fileUniqueId: string, webpBuffer: Buffer): Promise<string> {
  ensureCacheDir();
  const cachePath = getCachePath(fileUniqueId);

  await sharp(webpBuffer)
    .resize(200, 200, { fit: 'inside' })
    .jpeg({ quality: 80 })
    .toFile(cachePath);

  return cachePath;
}

/**
 * Clean up sticker cache files not accessed in the last week.
 */
export function cleanStickerCache(): void {
  if (!fs.existsSync(CACHE_DIR)) return;

  const now = Date.now();
  for (const file of fs.readdirSync(CACHE_DIR)) {
    const filePath = path.join(CACHE_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.atimeMs > CACHE_EXPIRY_MS) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // ignore
    }
  }
}
