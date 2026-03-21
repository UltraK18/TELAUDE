import { type Context } from 'grammy';

export type MediaType =
  | 'photo'
  | 'document'
  | 'audio'
  | 'voice'
  | 'video'
  | 'video_note'
  | 'sticker'
  | 'animation';

export interface MediaInfo {
  fileId: string;
  mediaType: MediaType;
  originalFileName?: string;
  mimeType?: string;
  fileSize?: number;
  /** Sticker-specific metadata */
  stickerEmoji?: string;
  stickerSetName?: string;
  fileUniqueId?: string;
  stickerThumbnailFileId?: string;
}

export const MEDIA_LABELS: Record<MediaType, string> = {
  photo: 'Photo',
  document: 'File',
  audio: 'Audio',
  voice: 'Voice message',
  video: 'Video',
  video_note: 'Video message',
  sticker: 'Sticker',
  animation: 'GIF',
};

export function extractMediaInfo(ctx: Context): MediaInfo | null {
  const msg = ctx.message;
  if (!msg) return null;

  if (msg.photo) {
    const largest = msg.photo[msg.photo.length - 1];
    return {
      fileId: largest.file_id,
      mediaType: 'photo',
      fileSize: largest.file_size,
    };
  }
  if (msg.document) {
    return {
      fileId: msg.document.file_id,
      mediaType: 'document',
      originalFileName: msg.document.file_name,
      mimeType: msg.document.mime_type,
      fileSize: msg.document.file_size,
    };
  }
  if (msg.audio) {
    return {
      fileId: msg.audio.file_id,
      mediaType: 'audio',
      originalFileName: msg.audio.file_name,
      mimeType: msg.audio.mime_type,
      fileSize: msg.audio.file_size,
    };
  }
  if (msg.voice) {
    return {
      fileId: msg.voice.file_id,
      mediaType: 'voice',
      mimeType: msg.voice.mime_type,
      fileSize: msg.voice.file_size,
    };
  }
  if (msg.video) {
    return {
      fileId: msg.video.file_id,
      mediaType: 'video',
      originalFileName: msg.video.file_name,
      mimeType: msg.video.mime_type,
      fileSize: msg.video.file_size,
    };
  }
  if (msg.video_note) {
    return {
      fileId: msg.video_note.file_id,
      mediaType: 'video_note',
      fileSize: msg.video_note.file_size,
    };
  }
  if (msg.sticker) {
    return {
      fileId: msg.sticker.file_id,
      mediaType: 'sticker',
      fileSize: msg.sticker.file_size,
      stickerEmoji: msg.sticker.emoji,
      stickerSetName: msg.sticker.set_name,
      fileUniqueId: msg.sticker.file_unique_id,
      stickerThumbnailFileId: msg.sticker.thumbnail?.file_id,
    };
  }
  if (msg.animation) {
    return {
      fileId: msg.animation.file_id,
      mediaType: 'animation',
      originalFileName: msg.animation.file_name,
      mimeType: msg.animation.mime_type,
      fileSize: msg.animation.file_size,
    };
  }
  return null;
}

export function buildMediaText(
  items: Array<{ mediaType: MediaType; savedPath: string }>,
  caption: string,
): string {
  if (items.length === 1) {
    const { mediaType, savedPath } = items[0];
    const label = MEDIA_LABELS[mediaType];
    return caption
      ? `[${label} received: ${savedPath}]\n${caption}`
      : `[${label} received: ${savedPath}]`;
  }

  const header = `[Media group received: ${items.length} files]`;
  const fileList = items
    .map((item, i) => `${i + 1}. ${MEDIA_LABELS[item.mediaType]}: ${item.savedPath}`)
    .join('\n');

  return caption
    ? `${header}\n${fileList}\n\n${caption}`
    : `${header}\n${fileList}`;
}
