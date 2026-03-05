# Telegram Bot API - HTML Formatting Reference

Source: https://core.telegram.org/bots/api#html-style
Source: https://core.telegram.org/api/entities

## parse_mode: "HTML"

### Supported Tags

```
<b>bold</b>
<strong>bold</strong>
<i>italic</i>
<em>italic</em>
<u>underline</u>
<ins>underline</ins>
<s>strikethrough</s>
<strike>strikethrough</strike>
<del>strikethrough</del>
<span class="tg-spoiler">spoiler</span>
<tg-spoiler>spoiler</tg-spoiler>
<b>bold <i>italic bold <s>italic bold strikethrough <span class="tg-spoiler">italic bold strikethrough spoiler</span></s> <u>underline italic bold</u></i> bold</b>
<a href="http://www.example.com/">inline URL</a>
<a href="tg://user?id=123456789">inline mention of a user</a>
<tg-emoji emoji-id="5368324170671202286">fallback emoji</tg-emoji>
<code>inline fixed-width code</code>
<pre>pre-formatted fixed-width code block</pre>
<pre><code class="language-python">pre-formatted fixed-width code block written in the Python programming language</code></pre>
<blockquote>Block quotation started\nBlock quotation continued\nThe last line of the block quotation</blockquote>
<blockquote expandable>Expandable block quotation (click to expand)</blockquote>
```

### NOT supported in HTML mode

These entity types have NO HTML tag equivalent:
- underline → use `<u>` or `<ins>`
- strikethrough → use `<s>`, `<strike>`, or `<del>`
- spoiler → use `<tg-spoiler>` or `<span class="tg-spoiler">`
- blockquote → use `<blockquote>`
- expandable_blockquote → use `<blockquote expandable>`
- custom_emoji → use `<tg-emoji emoji-id="ID">fallback</tg-emoji>`

### Entity Nesting Rules

- bold, italic, underline, strikethrough, spoiler → can contain and be part of any other entities, EXCEPT pre and code
- blockquote, expandable_blockquote → cannot be nested inside each other
- All other entities → cannot contain each other
- pre and code → cannot contain other entities

### Special Characters

Must be escaped in HTML:
- `<` → `&lt;`
- `>` → `&gt;`
- `&` → `&amp;`

### tg-emoji (Premium Custom Emoji)

```html
<tg-emoji emoji-id="5368324170671202286">👍</tg-emoji>
```
- Only works for premium users
- Non-premium users see the fallback text (the emoji between tags)
- emoji-id is a numeric string (custom_emoji_id from Telegram)

### Limitations

- No table support
- No heading support (h1-h6)
- No list support (ul/ol/li)
- No image/media embedding in text
- No horizontal rules
- No font size/color
- Max message length: 4096 characters
- Max caption length: 1024 characters

### parse_mode: "MarkdownV2" (alternative)

```
*bold*
_italic_
__underline__
~strikethrough~
||spoiler||
*bold _italic bold ~italic bold strikethrough ||italic bold strikethrough spoiler||~ __underline italic bold___ bold*
[inline URL](http://www.example.com/)
[inline mention of a user](tg://user?id=123456789)
![👍](tg://emoji?id=5368324170671202286)
`inline fixed-width code`
```pre-formatted fixed-width code block```
```python
pre-formatted fixed-width code block written in the Python programming language
```
>Block quotation started
>Block quotation continued
>The last line of the block quotation
**>Expandable block quotation started
>Expandable block quotation continued
>The last line of the block quotation||
```

Special chars to escape in MarkdownV2:
`_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!`
