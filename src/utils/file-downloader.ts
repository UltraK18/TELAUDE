import { type Api } from 'grammy';
import path from 'path';
import { writeFile } from 'fs/promises';
import { config } from '../config.js';
import { logger } from './logger.js';

export async function downloadTelegramFile(
  api: Api,
  fileId: string,
  workingDir: string,
  originalFileName?: string,
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
  const fileName = originalFileName
    ? `tg_${timestamp}_${originalFileName}`
    : `tg_${timestamp}_${path.basename(file.file_path)}`;

  const savePath = path.join(workingDir, fileName);

  await writeFile(savePath, buffer);

  const absolutePath = path.resolve(savePath);
  logger.info({ absolutePath, size: buffer.length }, 'File downloaded successfully');

  return absolutePath;
}
