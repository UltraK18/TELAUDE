import { logger } from './logger.js';
import type { MessageEntity } from 'grammy/types';

const FETCH_TIMEOUT_MS = 3000;
const TOTAL_TIMEOUT_MS = 5000;

// Match x.com or twitter.com status URLs
const TWITTER_RE = /^https?:\/\/(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)\/([\w]+)\/status\/(\d+)/i;

// Generic URL pattern for fallback extraction (when entities are unavailable)
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/**
 * Extract URLs from Telegram message text + entities.
 * Falls back to regex extraction when entities are not available (e.g. forwarded messages).
 */
export function extractUrls(text: string, entities?: MessageEntity[]): string[] {
  const urls = new Set<string>();

  if (entities && entities.length > 0) {
    for (const entity of entities) {
      if (entity.type === 'url') {
        urls.add(text.slice(entity.offset, entity.offset + entity.length));
      } else if (entity.type === 'text_link' && entity.url) {
        urls.add(entity.url);
      }
    }
  } else {
    // Fallback: extract URLs from plain text via regex
    const matches = text.match(URL_RE);
    if (matches) {
      for (const m of matches) urls.add(m);
    }
  }

  return Array.from(urls);
}

interface ProxyMatch {
  proxyUrl: string;
  type: string;
}

/**
 * Convert a URL to its proxy API equivalent.
 * Returns null if no proxy is available for this URL type.
 */
function toProxyUrl(url: string): ProxyMatch | null {
  const m = url.match(TWITTER_RE);
  if (m) {
    // Extract path from the original URL after the domain
    const urlObj = new URL(url);
    const pathname = urlObj.pathname; // e.g. /username/status/1234567890
    return {
      proxyUrl: `https://api.fxtwitter.com${pathname}`,
      type: 'twitter',
    };
  }
  return null;
}

/**
 * Format a number for display: 1234 → "1.2K", 1234567 → "1.2M"
 */
function formatCount(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return v % 1 === 0 ? `${v}M` : `${v.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return v % 1 === 0 ? `${v}K` : `${v.toFixed(1)}K`;
  }
  return String(n);
}

interface FxTweet {
  tweet?: {
    text?: string;
    author?: { name?: string; screen_name?: string };
    replies?: number;
    retweets?: number;
    likes?: number;
    views?: number;
    media?: { photos?: Array<{ url?: string }> };
    created_at?: string;
  };
}

/**
 * Fetch and format a Twitter/X post preview via fxtwitter API.
 */
async function fetchTwitterPreview(apiUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      logger.warn({ status: res.status, url: apiUrl }, 'fxtwitter API error');
      return null;
    }

    const data = (await res.json()) as FxTweet;
    const tweet = data.tweet;
    if (!tweet) return null;

    const screenName = tweet.author?.screen_name ?? 'unknown';
    const lines: string[] = [];

    lines.push(`[Link preview \u2014 X post by @${screenName}]`);

    if (tweet.text) {
      lines.push(tweet.text);
    }

    // Engagement stats
    const stats: string[] = [];
    if (tweet.replies != null) stats.push(`\uD83D\uDCAC ${formatCount(tweet.replies)}`);
    if (tweet.retweets != null) stats.push(`\uD83D\uDD01 ${formatCount(tweet.retweets)}`);
    if (tweet.likes != null) stats.push(`\u2764\uFE0F ${formatCount(tweet.likes)}`);
    if (tweet.views != null) stats.push(`\uD83D\uDC41\uFE0F ${formatCount(tweet.views)}`);
    if (stats.length > 0) {
      lines.push(stats.join('  '));
    }

    // Images
    if (tweet.media?.photos) {
      for (const photo of tweet.media.photos) {
        if (photo.url) {
          lines.push(`[Image: ${photo.url}]`);
        }
      }
    }

    return lines.join('\n');
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn({ url: apiUrl }, 'fxtwitter fetch timed out');
    } else {
      logger.warn({ err, url: apiUrl }, 'fxtwitter fetch failed');
    }
    return null;
  }
}

/**
 * Fetch link previews for all supported URLs in a message.
 * Returns formatted text to prepend to Claude stdin, or null if no previews available.
 */
export async function fetchLinkPreviews(text: string, entities?: MessageEntity[]): Promise<string | null> {
  const urls = extractUrls(text, entities);
  if (urls.length === 0) return null;

  const tasks: Array<Promise<string | null>> = [];

  for (const url of urls) {
    const proxy = toProxyUrl(url);
    if (!proxy) continue;

    if (proxy.type === 'twitter') {
      tasks.push(fetchTwitterPreview(proxy.proxyUrl));
    }
  }

  if (tasks.length === 0) return null;

  // Overall timeout for all fetches
  const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, TOTAL_TIMEOUT_MS));
  const results = await Promise.race([
    Promise.allSettled(tasks),
    timeoutPromise.then(() => tasks.map(() => ({ status: 'rejected' as const, reason: 'timeout' }))),
  ]);

  const previews: string[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && 'value' in result && result.value) {
      previews.push(result.value);
    }
  }

  return previews.length > 0 ? previews.join('\n\n') : null;
}
