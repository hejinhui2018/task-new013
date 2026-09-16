import { tokenize } from './text';
import { lcsPairs } from './lcs';

export interface DiffPart {
  type: 'same' | 'add' | 'del';
  text: string;
}

/**
 * 词级 diff：对新旧文本分词后求 LCS，输出连续的 same/add/del 片段。
 * 中文按字、英文按词比较，长段落也能精确展示改了哪几个字。
 */
export function diffTokens(oldText: string, newText: string): DiffPart[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const pairs = lcsPairs(a, b, (x, y) => x === y);
  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  for (const [pi, pj] of pairs) {
    while (i < pi) push('del', a[i++]);
    while (j < pj) push('add', b[j++]);
    push('same', a[i++]);
    j++;
  }
  while (i < a.length) push('del', a[i++]);
  while (j < b.length) push('add', b[j++]);
  return parts;
}
