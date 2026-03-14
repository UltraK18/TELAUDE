import { type Api } from 'grammy';
import { downloadTelegramFile } from '../../utils/file-downloader.js';
import { type MediaType, buildMediaText } from './media-types.js';
import { logger } from '../../utils/logger.js';

interface PendingItem {
  fileId: string;
  mediaType: MediaType;
  originalFileName?: string;
}

interface PendingGroup {
  userId: number;
  chatId: number;
  threadId: number;
  items: PendingItem[];
  caption: string;
  api: Api;
  workingDir: string;
  debounceTimer: ReturnType<typeof setTimeout>;
  maxTimer: ReturnType<typeof setTimeout>;
}

type GroupCompleteCallback = (
  userId: number,
  chatId: number,
  text: string,
  api: Api,
  threadId: number,
) => void;

const DEBOUNCE_MS = 1500;
const MAX_COLLECT_MS = 5000;

export class MediaGroupCollector {
  private groups = new Map<string, PendingGroup>();
  private onComplete: GroupCompleteCallback;

  constructor(onComplete: GroupCompleteCallback) {
    this.onComplete = onComplete;
  }

  add(
    mediaGroupId: string,
    item: PendingItem,
    caption: string | undefined,
    userId: number,
    chatId: number,
    api: Api,
    workingDir: string,
    threadId?: number,
  ): void {
    let group = this.groups.get(mediaGroupId);

    if (!group) {
      group = {
        userId,
        chatId,
        threadId: threadId ?? 0,
        items: [],
        caption: caption ?? '',
        api,
        workingDir,
        debounceTimer: setTimeout(() => this.flush(mediaGroupId), DEBOUNCE_MS),
        maxTimer: setTimeout(() => this.flush(mediaGroupId), MAX_COLLECT_MS),
      };
      this.groups.set(mediaGroupId, group);
    } else {
      // Reset debounce timer on each new item
      clearTimeout(group.debounceTimer);
      group.debounceTimer = setTimeout(() => this.flush(mediaGroupId), DEBOUNCE_MS);
      // Capture caption from any message (usually first)
      if (caption && !group.caption) {
        group.caption = caption;
      }
    }

    group.items.push(item);
    logger.info(
      { mediaGroupId, itemCount: group.items.length, mediaType: item.mediaType },
      'Added item to media group',
    );
  }

  private async flush(mediaGroupId: string): Promise<void> {
    const group = this.groups.get(mediaGroupId);
    if (!group) return;

    clearTimeout(group.debounceTimer);
    clearTimeout(group.maxTimer);
    this.groups.delete(mediaGroupId);

    logger.info(
      { mediaGroupId, itemCount: group.items.length },
      'Flushing media group',
    );

    // Download in batches of 3 to limit concurrency
    const BATCH_SIZE = 3;
    const results: PromiseSettledResult<string>[] = [];
    for (let i = 0; i < group.items.length; i += BATCH_SIZE) {
      const batch = group.items.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(item =>
          downloadTelegramFile(group.api, item.fileId, group.workingDir, item.originalFileName, item.mediaType)
        ),
      );
      results.push(...batchResults);
    }

    const successItems: Array<{ mediaType: MediaType; savedPath: string }> = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        successItems.push({
          mediaType: group.items[i].mediaType,
          savedPath: result.value,
        });
      } else {
        logger.error(
          { err: result.reason, fileId: group.items[i].fileId },
          'Failed to download media group file',
        );
      }
    }

    const failCount = results.length - successItems.length;

    if (successItems.length === 0) {
      try {
        await group.api.sendMessage(group.chatId, '\u274C 미디어 그룹 다운로드에 실패했습니다.');
      } catch { /* ignore */ }
      return;
    }

    let text = buildMediaText(successItems, group.caption);
    if (failCount > 0) {
      text += `\n(${failCount} of ${results.length} files failed to download)`;
    }
    this.onComplete(group.userId, group.chatId, text, group.api, group.threadId);
  }

  cleanup(): void {
    for (const group of this.groups.values()) {
      clearTimeout(group.debounceTimer);
      clearTimeout(group.maxTimer);
    }
    this.groups.clear();
  }
}
