import { contentTokens, normalizeText } from './text';
import { lcsLength } from './lcs';
import type { MergeResult } from './merge';

/**
 * 批注（锚点注释）系统。
 *
 * 设计原则：批注只存"当时看到的文字 + 位置指纹"，不存会随重新合并失效的
 * 可变块 id。每次合并结果重算后，由 attachAnnotations 纯函数重新判断每条
 * 批注的落点：
 *
 * - attached  精确（或经小幅修改模糊匹配后唯一）挂在当前正文上；
 * - conflict  原块落入未解决冲突，正文尚未定稿，不猜测位置；
 * - ambiguous 出现多个相同候选，或模糊匹配出现多候选；
 * - detached  目标被删除、整段消失或大幅重写，无法自动跟随。
 *
 * conflict 在冲突解决后由下一次 attach 自动重判；其余异常状态都允许用户
 * 手动重挂（reanchor）。
 */

export type AnnotationStatus = 'attached' | 'detached' | 'ambiguous' | 'conflict';

/** 批注创建时的挂接指纹，随批注持久化。 */
export interface AnnotationAnchor {
  /** 合并块稳定身份键（底稿段为 `b<i>`，新增段为 `ins:<锚点>::<归一化文本>`） */
  blockKey: string;
  /** 选中文字原文（含原始空白） */
  exact: string;
  /** 选中起点之前的文字（用于重复文字消歧） */
  prefix: string;
  /** 选中终点之后的文字（用于重复文字消歧） */
  suffix: string;
}

export interface Annotation {
  id: string;
  /** 留言内容 */
  note: string;
  author: string;
  createdAt: number;
  updatedAt: number;
  anchor: AnnotationAnchor;
}

/** 一条可挂接候选：某段文字中出现的一段匹配文本。 */
export interface AttachmentCandidate {
  blockKey: string;
  blockId: string;
  /** 匹配片段在段落文本中的字符下标 */
  start: number;
  end: number;
  /** 匹配片段文字 */
  text: string;
  /** 匹配方式：精确 / 忽略空白 / 模糊跟随 */
  kind: 'exact' | 'normalized' | 'fuzzy';
  /** 模糊匹配的相似度（fuzzy 时有效） */
  score: number;
}

export interface AnnotationAttachment {
  annotationId: string;
  status: AnnotationStatus;
  /** attached 时的唯一定位；ambiguous 时为全部候选（不自动选用） */
  candidates: AttachmentCandidate[];
  /** 状态原因说明，用于界面提示 */
  reason: string;
}

// ---- 定位参数 ----

/** 模糊跟随的相似度下限；低于此值视为"大幅重写"，不自动跟随 */
const FUZZY_FOLLOW_THRESHOLD = 0.55;
/** 模糊片段与原选中长度之比的允许范围，防止匹配到过大/过小片段 */
const FUZZY_LEN_RATIO_MIN = 0.5;
const FUZZY_LEN_RATIO_MAX = 1.8;
/** 前/后缀指纹最多保留的字符数 */
const CONTEXT_MAX = 24;

/** 空白不敏感的子串匹配：返回 haystack 中与 needle 归一化后相等的区间（含原空白）。 */
function normalizedIndexOf(haystack: string, needle: string): { start: number; end: number } | null {
  const nt = normalizeText(needle);
  if (nt.length === 0) return null;
  const isWs = (ch: string) => /\s/.test(ch);
  // 在原文上以每个非空白起点试探，两侧均跳过空白逐字比对
  const run = (from: number) => {
    let hi = from;
    let ni = 0;
    while (ni < nt.length) {
      if (isWs(nt[ni])) {
        ni++;
        continue;
      }
      while (hi < haystack.length && isWs(haystack[hi])) hi++;
      if (hi >= haystack.length || haystack[hi] !== nt[ni]) return -1;
      hi++;
      ni++;
    }
    return hi;
  };
  for (let i = 0; i < haystack.length; i++) {
    if (isWs(haystack[i])) continue;
    const e = run(i);
    if (e >= 0) return { start: i, end: e };
  }
  return null;
}

/** 找出段落中与目标（归一化）相等的全部区间。 */
function findExactOccurrences(text: string, target: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const direct = text.split('').reduce((acc: number[], _ch, idx) => {
    if (text.startsWith(target, idx)) acc.push(idx);
    return acc;
  }, []);
  for (const s of direct) out.push({ start: s, end: s + target.length });
  if (out.length === 0) {
    // 原文直搜不到（通常因空白差异），做一次空白不敏感匹配
    const m = normalizedIndexOf(text, target);
    if (m) out.push(m);
  }
  return out;
}

/** 词级相似度（与 similarity.ts 同口径的 Dice/LCS 系数）。 */
function tokenArraySimilarity(ta: string[], tb: string[]): number {
  if (ta.length === 0 || tb.length === 0) return 0;
  return (2 * lcsLength(ta, tb, (x, y) => x === y)) / (ta.length + tb.length);
}

/**
 * 在单段文字中定位一段引文：
 * 1. 精确（忽略空白）匹配；多个时用 prefix/suffix 指纹消歧；
 * 2. 唯一匹配直接采用；多个无法消歧 → 多候选（由调用方判 ambiguous）；
 * 3. 找不到时在长度合理的窗口里做词级模糊搜索，超过阈值的最高分窗口跟随。
 */
export function locateQuote(
  text: string,
  quote: string,
  prefix: string,
  suffix: string,
): AttachmentCandidate[] {
  const target = normalizeText(quote);
  const cands: AttachmentCandidate[] = [];

  const occurrences = findExactOccurrences(text, target);
  for (const occ of occurrences) {
    const kind = text.slice(occ.start, occ.end) === quote ? 'exact' : 'normalized';
    cands.push({
      blockKey: '',
      blockId: '',
      start: occ.start,
      end: occ.end,
      text: text.slice(occ.start, occ.end),
      kind,
      score: 1,
    });
  }

  if (cands.length > 1) {
    // 用上下文指纹消歧：前/后缀必须紧贴候选（而不是出现在附近窗口里），
    // 前缀权重高于后缀
    const endsWithNorm = (s: string, tail: string) => normalizeText(s).endsWith(normalizeText(tail));
    const startsWithNorm = (s: string, head: string) => normalizeText(s).startsWith(normalizeText(head));
    const scored = cands
      .map((c) => {
        const preText = text.slice(Math.max(0, c.start - prefix.length), c.start);
        const sufText = text.slice(c.end, c.end + suffix.length);
        const preOk = prefix.length > 0 && preText.length >= prefix.length && endsWithNorm(preText, prefix);
        const sufOk = suffix.length > 0 && sufText.length >= suffix.length && startsWithNorm(sufText, suffix);
        return { c, ctx: (preOk ? 2 : 0) + (sufOk ? 1 : 0) };
      })
      .sort((a, b) => b.ctx - a.ctx);
    if (scored[0].ctx > 0 && scored[0].ctx !== scored[1]?.ctx) {
      return [scored[0].c];
    }
    return cands;
  }

  if (cands.length === 1) return cands;

  // 模糊跟随：在段落中滑窗寻找与原引文字词最相近的区间
  const fuzzy = bestFuzzyWindow(text, target);
  if (fuzzy) cands.push(fuzzy);
  return cands;
}

/** 滑窗模糊搜索：以原引文长度为中心，在段落中枚举窗口取最高相似度。 */
function bestFuzzyWindow(text: string, target: string): AttachmentCandidate | null {
  const tokens = contentTokens(text);
  if (tokens.length === 0 || target.length === 0) return null;
  const targetTok = contentTokens(target);
  const targetLen = targetTok.length;
  if (targetLen === 0) return null;

  // 把段落还原成 token -> 原文偏移的映射，便于窗口换算回字符下标
  const spans: Array<{ tok: string; start: number; end: number }> = [];
  const re = /[A-Za-z0-9]+(?:[.,:/%@-][A-Za-z0-9]+)*|[㐀-䶿一-鿿]|[　-〿＀-｟]|[^\sA-Za-z0-9㐀-䶿一-鿿　-〿＀-｟]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].trim().length > 0) spans.push({ tok: m[0], start: m.index, end: m.index + m[0].length });
  }

  let best: { startTok: number; endTok: number; score: number } | null = null;
  const minLen = Math.max(1, Math.round(targetLen * FUZZY_LEN_RATIO_MIN));
  const maxLen = Math.min(spans.length, Math.max(minLen, Math.round(targetLen * FUZZY_LEN_RATIO_MAX)));
  for (let len = minLen; len <= maxLen; len++) {
    for (let s = 0; s + len <= spans.length; s++) {
      const windowToks = spans.slice(s, s + len).map((x) => x.tok);
      const score = tokenArraySimilarity(targetTok, windowToks);
      if (!best || score > best.score) best = { startTok: s, endTok: s + len, score };
    }
  }
  if (!best || best.score < FUZZY_FOLLOW_THRESHOLD) return null;
  const start = spans[best.startTok].start;
  const end = spans[best.endTok - 1].end;
  return {
    blockKey: '',
    blockId: '',
    start,
    end,
    text: text.slice(start, end),
    kind: 'fuzzy',
    score: best.score,
  };
}

/**
 * 把全部批注重新挂到一次合并结果上（纯函数）。
 *
 * 块身份由 merge 引擎保证跨"段落移动 / 重新合并"稳定（底稿段用底稿下标，
 * 新增段用"锚点+内容"），因此跟随只需在原块内做引文定位：
 * - 原块是未解决冲突       → conflict（不猜位置，解决后下一轮自动重判）；
 * - 原块被删除            → detached（不跨块猜测，可手动重挂）；
 * - 块内唯一命中          → attached（精确/忽略空白/模糊跟随）；
 * - 块内多个相同候选      → ambiguous；
 * - 块内找不到（大幅重写）→ detached。
 */
export function attachAnnotations(merge: MergeResult, annotations: Annotation[]): AnnotationAttachment[] {
  const liveBlocks = merge.blocks.filter((b) => b.status !== 'removed' && b.status !== 'pending');
  const byKey = new Map(liveBlocks.map((b) => [b.identityKey, b]));
  const pendingKeys = new Set(merge.blocks.filter((b) => b.status === 'pending').map((b) => b.identityKey));
  const removedKeys = new Set(merge.blocks.filter((b) => b.status === 'removed').map((b) => b.identityKey));

  return annotations.map((a) => {
    if (pendingKeys.has(a.anchor.blockKey)) {
      return {
        annotationId: a.id,
        status: 'conflict' as const,
        candidates: [],
        reason: '批注所在段落存在未解决冲突，正文尚未定稿，冲突解决后自动重新判断',
      };
    }

    const block = byKey.get(a.anchor.blockKey);
    if (!block) {
      const removed = removedKeys.has(a.anchor.blockKey);
      // 新增段落的身份键含锚点，锚点可能因周边段落移动而改变。
      // 此时只做确定性兜底：在现存新增段中精确（忽略空白）寻找引文，
      // 唯一命中才跟随，多个命中标歧义，绝不做模糊猜测。
      if (!removed && a.anchor.blockKey.startsWith('ins:')) {
        const relocated: AttachmentCandidate[] = [];
        for (const b of liveBlocks) {
          if (b.baseIdx !== null) continue;
          for (const c of locateQuote(b.text, a.anchor.exact, a.anchor.prefix, a.anchor.suffix)) {
            if (c.kind !== 'fuzzy') relocated.push({ ...c, blockKey: b.identityKey, blockId: b.id });
          }
        }
        if (relocated.length === 1) {
          return { annotationId: a.id, status: 'attached' as const, candidates: relocated, reason: '' };
        }
        if (relocated.length > 1) {
          return {
            annotationId: a.id,
            status: 'ambiguous' as const,
            candidates: relocated,
            reason: '新增段落位置发生变化且存在多个相同内容的段落',
          };
        }
      }
      return {
        annotationId: a.id,
        status: 'detached' as const,
        candidates: [],
        reason: removed ? '批注所在段落已被裁决删除' : '批注所在段落已在改稿中消失',
      };
    }

    const candidates = locateQuote(
      block.text,
      a.anchor.exact,
      a.anchor.prefix,
      a.anchor.suffix,
    ).map((c) => ({ ...c, blockKey: block.identityKey, blockId: block.id }));

    if (candidates.length === 0) {
      return {
        annotationId: a.id,
        status: 'detached' as const,
        candidates: [],
        reason: '批注对应文字已被删除或大幅重写，可手动挂到新文字上',
      };
    }
    if (candidates.length > 1) {
      return {
        annotationId: a.id,
        status: 'ambiguous' as const,
        candidates,
        reason: '批注原文在该段出现多次，无法确定原位置',
      };
    }
    return {
      annotationId: a.id,
      status: 'attached' as const,
      candidates,
      reason: '',
    };
  });
}

/** 由一次正文选区构造挂接指纹。选区必须完全落在同一块的文字内。 */
export function makeAnchorAt(
  blockKey: string,
  blockText: string,
  start: number,
  end: number,
): AnnotationAnchor {
  const s = Math.max(0, Math.min(start, end));
  const e = Math.min(blockText.length, Math.max(start, end));
  return {
    blockKey,
    exact: blockText.slice(s, e),
    prefix: blockText.slice(Math.max(0, s - CONTEXT_MAX), s),
    suffix: blockText.slice(e, Math.min(blockText.length, e + CONTEXT_MAX)),
  };
}

/** 手动重挂：保留原批注内容，把挂接指纹替换为新选区。 */
export function reanchorAnnotation(
  a: Annotation,
  blockKey: string,
  blockText: string,
  start: number,
  end: number,
  now: number,
): Annotation {
  return { ...a, anchor: makeAnchorAt(blockKey, blockText, start, end), updatedAt: now };
}

export function attachmentStatusLabel(status: AnnotationStatus): string {
  switch (status) {
    case 'attached':
      return '已挂接';
    case 'detached':
      return '待重挂';
    case 'ambiguous':
      return '位置有歧义';
    case 'conflict':
      return '待冲突解决';
  }
}
