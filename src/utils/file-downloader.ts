import { type Api } from 'grammy';
import path from 'path';
import { writeFile } from 'fs/promises';
import { config } from '../config.js';
import { logger } from './logger.js';
import { type MediaType } from '../bot/handlers/media-types.js';

const DEFAULT_EXTENSIONS: Partial<Record<MediaType, string>> = {
  photo: '.jpg',
  voice: '.ogg',
  audio: '.ogg',
  video: '.mp4',
  video_note: '.mp4',
  sticker: '.webp',
  animation: '.mp4',
};

export async function downloadTelegramFile(
  api: Api,
  fileId: string,
  workingDir: string,
  originalFileName?: string,
  mediaType?: MediaType,
): Promise<string> {
  const file = await api.getFile(fileId);
  if (!file.file_path) {
    throw new Error(`Telegram returned no file_path for fileId: ${fileId}`);
  }

  const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;

  logger.info({ fileId, file_path: file.file_path }, 'Downloading Telegram file');

  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download file: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  const timestamp = Date.now();
  let fileName: string;
  if (originalFileName) {
    fileName = `tg_${timestamp}_${originalFileName}`;
  } else if (mediaType) {
    const ext = DEFAULT_EXTENSIONS[mediaType] ?? (path.extname(file.file_path) || '');
    fileName = `tg_${timestamp}_${mediaType}${ext}`;
  } else {
    fileName = `tg_${timestamp}_${path.basename(file.file_path)}`;
  }

  const savePath = path.join(workingDir, fileName);

  await writeFile(savePath, buffer);

  const absolutePath = path.resolve(savePath);
  logger.info({ absolutePath, size: buffer.length }, 'File downloaded successfully');

  return absolutePath;
}
