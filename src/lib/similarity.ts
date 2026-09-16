import { contentTokens } from './text';
import { lcsLength } from './lcs';

/**
 * 段落相似度：基于词序列 LCS 的 Dice 系数，取值 [0, 1]。
 * 1 表示内容完全一致（忽略空白差异）。
 */
export function similarity(a: string, b: string): number {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const matched = lcsLength(ta, tb, (x, y) => x === y);
  return (2 * matched) / (ta.length + tb.length);
}
