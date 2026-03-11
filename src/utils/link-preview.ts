import { logger } from './logger.js';
import type { MessageEntity } from 'grammy/types';

const FETCH_TIMEOUT_MS = 3000;
const TOTAL_TIMEOUT_MS = 5000;

// Match x.com or twitter.com status URLs
const TWITTER_RE = /^https?:\/\/(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)\/([\w]+)\/status\/(\d+)/i;

// Match YouTube URLs (standard, short, embed)
const YOUTUBE_RE = /^https?:\/\/(?:(?:www|m)\.youtube\.com\/watch\?.*v=|youtu\.be\/|(?:www\.)?youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/i;

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

type UrlType = 'twitter' | 'youtube' | 'og';

interface ProxyMatch {
  proxyUrl: string;
  type: UrlType;
  originalUrl: string;
}

/**
 * Convert a URL to its proxy API equivalent, or mark for OG fallback.
 */
function toProxyUrl(url: string): ProxyMatch | null {
  // Twitter/X
  if (TWITTER_RE.test(url)) {
    const urlObj = new URL(url);
    return {
      proxyUrl: `https://api.fxtwitter.com${urlObj.pathname}`,
      type: 'twitter',
      originalUrl: url,
    };
  }

  // YouTube
  const ytMatch = url.match(YOUTUBE_RE);
  if (ytMatch) {
    const videoId = ytMatch[1];
    return {
      proxyUrl: `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`,
      type: 'youtube',
      originalUrl: url,
    };
  }

  // Generic OG fallback — skip obvious non-HTML resources
  if (/\.(png|jpe?g|gif|webp|svg|mp4|mp3|pdf|zip|exe|dmg)(\?.*)?$/i.test(url)) {
    return null;
  }

  return {
    proxyUrl: url,
    type: 'og',
    originalUrl: url,
  };
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
    article?: {
      title?: string;
      preview_text?: string;
      content?: {
        blocks?: Array<{ text?: string; type?: string }>;
      };
    };
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

    if (tweet.article?.title) {
      lines.push(`[Link preview \u2014 X article by @${screenName}]`);
      lines.push(tweet.article.title);

      // Full article content from Draft.js blocks
      if (tweet.article.content?.blocks?.length) {
        lines.push('');
        for (const block of tweet.article.content.blocks) {
          if (!block.text?.trim()) continue;
          const t = block.type;
          if (t === 'header-two' || t === 'header-three') {
            lines.push(`## ${block.text}`);
          } else if (t === 'unordered-list-item') {
            lines.push(`- ${block.text}`);
          } else if (t === 'ordered-list-item') {
            lines.push(`• ${block.text}`);
          } else if (t === 'blockquote') {
            lines.push(`> ${block.text}`);
          } else if (t !== 'atomic') {
            lines.push(block.text);
          }
        }
      } else if (tweet.article.preview_text) {
        lines.push(tweet.article.preview_text);
      }
    } else {
      lines.push(`[Link preview \u2014 X post by @${screenName}]`);
      if (tweet.text) {
        lines.push(tweet.text);
      }
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

interface NoembedResponse {
  title?: string;
  author_name?: string;
  provider_name?: string;
  thumbnail_url?: string;
  description?: string;
  error?: string;
}

/**
 * Fetch and format a YouTube video preview via noembed.com.
 */
async function fetchYoutubePreview(noembedUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(noembedUrl, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return null;

    const data = (await res.json()) as NoembedResponse;
    if (data.error || !data.title) return null;

    const lines: string[] = [];
    lines.push(`[Link preview — YouTube]`);
    lines.push(data.title);
    if (data.author_name) lines.push(`Channel: ${data.author_name}`);

    return lines.join('\n');
  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') {
      logger.warn({ err, url: noembedUrl }, 'noembed fetch failed');
    }
    return null;
  }
}

/**
 * Fetch and format a generic URL preview via OG meta tags.
 */
async function fetchOgPreview(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TelaudeBot/1.0)' },
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) return null;

    // Read up to 50KB to find OG tags without loading the full page
    const reader = res.body?.getReader();
    if (!reader) return null;

    let html = '';
    let bytesRead = 0;
    const MAX_BYTES = 50_000;

    while (bytesRead < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
      bytesRead += value.byteLength;
      // Stop once we're past <head> — OG tags are always in head
      if (html.includes('</head>')) break;
    }
    reader.cancel();

    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1]
      ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];

    if (!ogTitle?.trim()) return null;

    const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)?.[1]
      ?? html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1];

    const siteName = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i)?.[1];

    const lines: string[] = [];
    const label = siteName ? `Link preview — ${siteName}` : 'Link preview';
    lines.push(`[${label}]`);
    lines.push(ogTitle.trim());
    if (ogDesc?.trim()) {
      // Truncate long descriptions
      const desc = ogDesc.trim().replace(/\s+/g, ' ');
      lines.push(desc.length > 400 ? desc.slice(0, 397) + '...' : desc);
    }

    return lines.join('\n');
  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') {
      logger.warn({ err, url }, 'OG fetch failed');
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
    } else if (proxy.type === 'youtube') {
      tasks.push(fetchYoutubePreview(proxy.proxyUrl));
    } else if (proxy.type === 'og') {
      tasks.push(fetchOgPreview(proxy.originalUrl));
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
