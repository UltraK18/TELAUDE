import fs from 'fs';
import path from 'path';
import os from 'os';
import { Transformer } from '@napi-rs/image';

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
 * @param dir Optional custom directory (default: global cache)
 */
export function getCachedSticker(fileUniqueId: string, dir?: string): string | null {
  const cachePath = dir
    ? path.join(dir, `${fileUniqueId}.jpg`)
    : getCachePath(fileUniqueId);
  if (fs.existsSync(cachePath)) {
    return cachePath;
  }
  return null;
}

/**
 * Convert WebP sticker buffer to 300px JPG and save to a custom directory.
 */
export async function cacheStickerTo(fileUniqueId: string, webpBuffer: Buffer, dir: string): Promise<string> {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${fileUniqueId}.jpg`);

  const jpgBuf = await new Transformer(webpBuffer).resize(300, 300).jpeg(80);
  fs.writeFileSync(outPath, jpgBuf);

  return outPath;
}

/**
 * Convert WebP sticker buffer to 200px JPG and cache in global dir.
 */
export async function cacheSticker(fileUniqueId: string, webpBuffer: Buffer): Promise<string> {
  ensureCacheDir();
  const cachePath = getCachePath(fileUniqueId);

  const jpgBuf = await new Transformer(webpBuffer).resize(200, 200).jpeg(80);
  fs.writeFileSync(cachePath, jpgBuf);

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
