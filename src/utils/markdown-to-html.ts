/**
 * Convert Claude's markdown output to Telegram-compatible HTML.
 * Telegram supports a limited subset of HTML:
 * <b>, <i>, <u>, <s>, <code>, <pre>, <a>, <tg-spoiler>
 */

export function markdownToTelegramHtml(md: string): string {
  let html = md;

  // Escape HTML entities first (except in code blocks which we handle separately)
  // We'll process code blocks first, then escape the rest

  // Extract code blocks to protect them
  const codeBlocks: string[] = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const idx = codeBlocks.length;
    const escaped = escapeHtml(code.trimEnd());
    const langAttr = lang ? ` class="language-${lang}"` : '';
    codeBlocks.push(`<pre><code${langAttr}>${escaped}</code></pre>`);
    return `\x00CODEBLOCK${idx}\x00`;
  });

  // Extract inline code
  const inlineCodes: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_match, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00INLINE${idx}\x00`;
  });

  // Now escape remaining HTML
  html = escapeHtml(html);

  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  html = html.replace(/__(.+?)__/g, '<b>$1</b>');

  // Italic: *text* or _text_ (but not within words for underscore)
  html = html.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<i>$1</i>');
  html = html.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<i>$1</i>');

  // Strikethrough: ~~text~~
  html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Restore inline code
  html = html.replace(/\x00INLINE(\d+)\x00/g, (_match, idx) => inlineCodes[Number(idx)]);

  // Restore code blocks
  html = html.replace(/\x00CODEBLOCK(\d+)\x00/g, (_match, idx) => codeBlocks[Number(idx)]);

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
