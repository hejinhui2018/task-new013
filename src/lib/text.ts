/**
 * 文本工具：归一化、分词、段落切分。
 * 分词对中文按字切分，对英文/数字按词切分，便于做词级 diff。
 */

/** 归一化文本：去首尾空白、压缩连续空白，用于段落相等性比较。 */
export function normalizeText(t: string): string {
  return t.trim().replace(/\s+/g, ' ');
}

/**
 * 分词规则：
 * - 连续英文字母/数字（允许内部夹 . , : / % @ -）作为一个词，如 "pr@xinglan.example"、"2026"
 * - 每个 CJK 汉字单独成词
 * - 每个中文标点单独成词
 * - 连续空白作为一个词
 * - 其余连续符号作为一个词
 */
const TOKEN_RE =
  /[A-Za-z0-9]+(?:[.,:/%@-][A-Za-z0-9]+)*|[㐀-䶿一-鿿]|[　-〿＀-｟]|\s+|[^\sA-Za-z0-9㐀-䶿一-鿿　-〿＀-｟]+/g;

export function tokenize(t: string): string[] {
  return t.match(TOKEN_RE) ?? [];
}

/** 非空白词（用于相似度计算，忽略纯空白差异）。 */
export function contentTokens(t: string): string[] {
  return tokenize(t).filter((tok) => tok.trim().length > 0);
}

/** 按空行切分段落。 */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function joinParagraphs(paragraphs: string[]): string {
  return paragraphs.join('\n\n');
}
