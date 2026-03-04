const MAX_LENGTH = 4000; // Telegram limit is 4096, leave margin

/**
 * Split a long message at natural boundaries (paragraphs, code block ends).
 * Returns an array of message chunks, each under MAX_LENGTH.
 */
export function splitMessage(text: string, maxLen = MAX_LENGTH): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let splitIdx = findSplitPoint(remaining, maxLen);
    chunks.push(remaining.slice(0, splitIdx).trimEnd());
    remaining = remaining.slice(splitIdx).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function findSplitPoint(text: string, maxLen: number): number {
  const searchRange = text.slice(0, maxLen);

  // Priority 1: End of code block (```)
  const codeBlockEnd = searchRange.lastIndexOf('\n```\n');
  if (codeBlockEnd > maxLen * 0.5) {
    return codeBlockEnd + 5; // after ```\n
  }

  // Priority 2: Double newline (paragraph break)
  const paragraphBreak = searchRange.lastIndexOf('\n\n');
  if (paragraphBreak > maxLen * 0.3) {
    return paragraphBreak + 2;
  }

  // Priority 3: Single newline
  const lineBreak = searchRange.lastIndexOf('\n');
  if (lineBreak > maxLen * 0.3) {
    return lineBreak + 1;
  }

  // Fallback: hard break at maxLen
  return maxLen;
}
