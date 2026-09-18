import { contentTokens, normalizeText } from './text';
import { lcsLength } from './lcs';
import type { MergeResult } from './merge';

/**
 * 合并稿批注与锚点跟踪。
 *
 * 批注记录（CommentRecord）是用户的编辑意图，只能由用户操作（新增 / 编辑 /
 * 删除 / 重挂）改变，因此可撤销、可持久化；每条批注创建时在"内容词元"坐标上
 * 捕获锚点：
 *
 * - quote：被选中的原文（词元序列拼成的字符串）
 * - prefix / suffix：选区前后的上下文字符串
 *
 * 文稿每次变化后，trackComments 把锚点重新对到最新合并结果上，得到只用于
 * 展示的 TrackedComment（视图态）。位置一律以 contentTokens（去掉空白后的
 * 词元）下标表示，渲染层与选区捕获共用同一套坐标，避免字符偏移在增删片段
 * 与中英文空白上错位。
 *
 * 跟踪遵循"绝不猜测位置"的原则：
 * - 段落移动 / 仅一侧改写：锚点跟随对应文字；
 * - 目标被删除或大幅重写：orphan（待重挂）；
 * - 出现多个无法用上下文区分的相同候选：ambiguous（有歧义）；
 * - 落入未解决冲突：conflict（待重挂），冲突解决后自动重新判断。
 */

export type CommentStatus = 'attached' | 'orphan' | 'ambiguous' | 'conflict';

export interface CommentAnchor {
  quote: string;
  prefix: string;
  suffix: string;
  /** 创建时所在合并块（底稿段落下标或新增段落块 id），用于同相似度候选排序 */
  blockBaseIdx: number | null;
  blockId: string | null;
}

export interface CommentRecord {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  anchor: CommentAnchor;
}

/** 命中位置：块文本 contentTokens 的闭区间下标 [startTok, endTok]。 */
export interface Annotation {
  startTok: number;
  endTok: number;
  /** 命中文本（可能与 quote 有少量措辞差异） */
  text: string;
  /** 锚点词元的留存比例（1 = 精确子串命中） */
  similarity: number;
  exact: boolean;
}

export interface ReanchorCandidate {
  blockId: string;
  blockBaseIdx: number | null;
  annotation: Annotation;
}

export interface TrackedComment {
  record: CommentRecord;
  status: CommentStatus;
  /** 唯一且确定地命中时的位置 */
  blockId: string | null;
  blockBaseIdx: number | null;
  annotation: Annotation | null;
  /** 有歧义 / 待重挂时给出可手动挂载的候选（按与原位置的距离排序） */
  candidates: ReanchorCandidate[];
  reason: string;
}

/** 大幅重写阈值：锚点词元在候选段落中的留存比例低于此值即视为已被重写。 */
const REWRITE_THRESHOLD = 0.6;
/** 模糊跟随还要求锚点至少有两个内容词，避免单字锚点误跟。 */
const MIN_FOLLOW_TOKENS = 2;
/** 命中区间紧致度：区间内与锚点配对的词元占比过低视为跨段稀疏凑数，拒绝跟随。 */
const SPAN_DENSITY_MIN = 0.6;
/** 上下文消歧使用的词元数。 */
const CONTEXT_TOKENS = 10;

/** 在 haystack 词元序列中查找 needle 的全部连续出现（按归一化词元比较）。 */
function findTokenRuns(haystack: string[], needle: string[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (needle.length === 0) return out;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let k = 0; k < needle.length; k++) {
      if (normalizeText(haystack[i + k]) !== normalizeText(needle[k])) continue outer;
    }
    out.push([i, i + needle.length - 1]);
  }
  return out;
}

/**
 * 在合并块中找出锚点的全部命中：
 * - 精确词元子串出现几次就返回几个（同段重复交由上下文消歧）；
 * - 没有精确命中时做一次词级 LCS 模糊对齐，至多返回一个命中。
 */
function annotateBlock(blockTokens: string[], rec: CommentRecord): Annotation[] {
  const quoteTokens = contentTokens(rec.anchor.quote);
  if (quoteTokens.length === 0 || blockTokens.length === 0) return [];

  const exact = findTokenRuns(blockTokens, quoteTokens);
  if (exact.length > 0) {
    return exact.map(([s, e]) => ({
      startTok: s,
      endTok: e,
      text: blockTokens.slice(s, e + 1).join(''),
      similarity: 1,
      exact: true,
    }));
  }

  if (quoteTokens.length < MIN_FOLLOW_TOKENS) return [];
  const matched = lcsLength(quoteTokens, blockTokens, (x, y) => normalizeText(x) === normalizeText(y));
  const retention = matched / quoteTokens.length;
  if (matched < MIN_FOLLOW_TOKENS || retention < REWRITE_THRESHOLD) return [];

  // 用 LCS 匹配对确定命中区间（块很小，直接走一遍 O(nm) DP）
  const n = quoteTokens.length;
  const m = blockTokens.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        normalizeText(quoteTokens[i]) === normalizeText(blockTokens[j])
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let firstJ = -1;
  let lastJ = -1;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (normalizeText(quoteTokens[i]) === normalizeText(blockTokens[j])) {
      if (firstJ < 0) firstJ = j;
      lastJ = j;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  if (firstJ < 0) return [];
  // 命中区间必须紧致：区间内大部分词元都应与锚点配对，防止 LCS 跨整段稀疏凑数
  //（例如锚点 7 个字、新段落只零星保留 5 个常用字时误判为"跟随"）。
  const spanLen = lastJ - firstJ + 1;
  const density = matched / spanLen;
  if (density < SPAN_DENSITY_MIN) return [];
  return [
    {
      startTok: firstJ,
      endTok: lastJ,
      text: blockTokens.slice(firstJ, lastJ + 1).join(''),
      similarity: retention,
      exact: false,
    },
  ];
}

interface RawHit {
  blockId: string;
  blockBaseIdx: number | null;
  status: 'live' | 'pending';
  tokens: string[];
  annotation: Annotation;
}

/** 用锚点前后的上下文词元给候选打分：连续相同词越多越可信。 */
function contextScore(hit: RawHit, rec: CommentRecord): number {
  const before = hit.tokens.slice(Math.max(0, hit.annotation.startTok - CONTEXT_TOKENS), hit.annotation.startTok);
  const anchorBefore = contentTokens(rec.anchor.prefix);
  const wantBefore = anchorBefore.slice(Math.max(0, anchorBefore.length - CONTEXT_TOKENS));
  let score = 0;
  for (let k = 1; k <= Math.min(before.length, wantBefore.length); k++) {
    if (normalizeText(before[before.length - k]) === normalizeText(wantBefore[wantBefore.length - k])) score++;
    else break;
  }
  const after = hit.tokens.slice(hit.annotation.endTok + 1, hit.annotation.endTok + 1 + CONTEXT_TOKENS);
  const anchorAfter = contentTokens(rec.anchor.suffix);
  const wantAfter = anchorAfter.slice(0, CONTEXT_TOKENS);
  for (let k = 0; k < Math.min(after.length, wantAfter.length); k++) {
    if (normalizeText(after[k]) === normalizeText(wantAfter[k])) score++;
    else break;
  }
  return score;
}

function toCandidate(h: RawHit): ReanchorCandidate {
  return { blockId: h.blockId, blockBaseIdx: h.blockBaseIdx, annotation: h.annotation };
}

/**
 * 把批注锚点重新对到最新合并结果。
 * 纯函数：文稿 / 裁决如何变化都能幂等重算，且只依赖锚点本身而非上一次结果。
 */
export function trackComments(records: CommentRecord[], merge: MergeResult): TrackedComment[] {
  return records.map((rec) => {
    const hits: RawHit[] = [];
    for (const block of merge.blocks) {
      if (block.status === 'removed') continue;
      const tokens = contentTokens(block.text);
      for (const ann of annotateBlock(tokens, rec)) {
        hits.push({
          blockId: block.id,
          blockBaseIdx: block.baseIdx,
          status: block.status === 'pending' ? 'pending' : 'live',
          tokens,
          annotation: ann,
        });
      }
    }

    if (hits.length === 0) {
      return {
        record: rec,
        status: 'orphan',
        blockId: null,
        blockBaseIdx: null,
        annotation: null,
        candidates: [],
        reason: '原文已被删除或大幅改写，未找到可跟随的文字',
      };
    }

    const liveHits = hits.filter((h) => h.status === 'live');
    if (liveHits.length === 0) {
      // 所有命中都落在未解决冲突块中：绝不猜测，等冲突解决后重新判断
      return {
        record: rec,
        status: 'conflict',
        blockId: null,
        blockBaseIdx: null,
        annotation: null,
        candidates: hits.map(toCandidate),
        reason: '批注文字落入未解决冲突，冲突解决后将自动重新定位',
      };
    }

    if (liveHits.length === 1) {
      return {
        record: rec,
        status: 'attached',
        blockId: liveHits[0].blockId,
        blockBaseIdx: liveHits[0].blockBaseIdx,
        annotation: liveHits[0].annotation,
        candidates: [],
        reason: '',
      };
    }

    // 多个 live 候选的判定优先级：
    // 1) 上下文（前后词元）明确唯一地偏向某一处 → 跟随；
    // 2) 否则尊重锚点记录的结构块身份（底稿段 id 跨合并稳定，移动也保持不变），
    //    原块中恰好命中一处 → 挂回原块；这不是猜测，而是沿用已确认的段落身份；
    // 3) 原块中也有多处、或原块已不含锚点 → 标记歧义，交由用户手动重挂。
    const scored = liveHits
      .map((h) => ({ h, score: contextScore(h, rec) }))
      .sort(
        (x, y) =>
          y.score - x.score ||
          proximityRank(y.h, rec) - proximityRank(x.h, rec) ||
          x.h.blockId.localeCompare(y.h.blockId),
      );
    const top = scored[0];
    const contextWinners = scored.filter((s) => s.score === top.score && s.score > 0);
    if (top.score > 0 && contextWinners.length === 1) {
      return attachedResult(rec, contextWinners[0].h);
    }

    const inAnchorBlock = liveHits.filter((h) => rec.anchor.blockId !== null && h.blockId === rec.anchor.blockId);
    if (inAnchorBlock.length === 1) {
      return attachedResult(rec, inAnchorBlock[0]);
    }

    return {
      record: rec,
      status: 'ambiguous',
      blockId: null,
      blockBaseIdx: null,
      annotation: null,
      candidates: scored.map((s) => toCandidate(s.h)),
      reason:
        liveHits.length > 1 && liveHits.every((h) => h.annotation.exact)
          ? '合并稿中有多处相同文字，无法确定批注原本指的是哪一处'
          : '多处文字与批注原文相似，无法确定批注原本指的是哪一处',
    };
  });
}

function attachedResult(rec: CommentRecord, h: RawHit): TrackedComment {
  return {
    record: rec,
    status: 'attached',
    blockId: h.blockId,
    blockBaseIdx: h.blockBaseIdx,
    annotation: h.annotation,
    candidates: [],
    reason: '',
  };
}

/** 候选与批注原所在块的邻近度：越近越大（仅用于歧义候选排序）。 */
function proximityRank(hit: RawHit, rec: CommentRecord): number {
  if (rec.anchor.blockBaseIdx === null || hit.blockBaseIdx === null) return 0;
  return -Math.abs(hit.blockBaseIdx - rec.anchor.blockBaseIdx);
}

/* ---------------- 记录的增删改（纯函数，供撤销历史使用） ---------------- */

export function createCommentRecord(input: {
  id: string;
  text: string;
  quote: string;
  prefix: string;
  suffix: string;
  blockId: string;
  blockBaseIdx: number | null;
  now: number;
}): CommentRecord {
  return {
    id: input.id,
    text: input.text,
    createdAt: input.now,
    updatedAt: input.now,
    anchor: {
      quote: input.quote,
      prefix: input.prefix,
      suffix: input.suffix,
      blockBaseIdx: input.blockBaseIdx,
      blockId: input.blockId,
    },
  };
}

export function addComment(records: CommentRecord[], rec: CommentRecord): CommentRecord[] {
  return [...records, rec];
}

export function editComment(records: CommentRecord[], id: string, text: string, now: number): CommentRecord[] {
  return records.map((r) => (r.id === id ? { ...r, text, updatedAt: now } : r));
}

export function deleteComment(records: CommentRecord[], id: string): CommentRecord[] {
  return records.filter((r) => r.id !== id);
}

/**
 * 手动重挂：以新位置的文字重建锚点，批注内容与创建时间不变。
 * 传入的 quote/prefix/suffix 由界面从新选区计算。
 */
export function reanchorComment(
  records: CommentRecord[],
  id: string,
  next: CommentAnchor,
  now: number,
): CommentRecord[] {
  return records.map((r) => (r.id === id ? { ...r, updatedAt: now, anchor: { ...next } } : r));
}

/** 由某个候选命中构造新锚点（quote 取命中区间，prefix/suffix 取同段上下文）。 */
export function candidateAnchor(
  blocks: MergeResult['blocks'],
  candidate: ReanchorCandidate,
): CommentAnchor | null {
  const block = blocks.find((b) => b.id === candidate.blockId);
  if (!block) return null;
  const tokens = contentTokens(block.text);
  const { startTok, endTok } = candidate.annotation;
  return {
    quote: tokens.slice(startTok, endTok + 1).join(''),
    prefix: tokens.slice(Math.max(0, startTok - CONTEXT_TOKENS), startTok).join(''),
    suffix: tokens.slice(endTok + 1, endTok + 1 + CONTEXT_TOKENS).join(''),
    blockBaseIdx: block.baseIdx,
    blockId: block.id,
  };
}

/** 在指定块中按引用文字（词元连续命中）构造锚点，供演示与程序化重挂使用。 */
export function anchorForQuote(
  blocks: MergeResult['blocks'],
  opts: { blockId?: string; baseIdx?: number | null; quote: string },
): CommentAnchor | null {
  const block = blocks.find(
    (b) =>
      (opts.blockId !== undefined && b.id === opts.blockId) ||
      (opts.baseIdx !== undefined && b.baseIdx === opts.baseIdx),
  );
  if (!block) return null;
  const tokens = contentTokens(block.text);
  const quoteTokens = contentTokens(opts.quote);
  const runs = findTokenRuns(tokens, quoteTokens);
  if (runs.length === 0) return null;
  const [startTok, endTok] = runs[0];
  return {
    quote: tokens.slice(startTok, endTok + 1).join(''),
    prefix: tokens.slice(Math.max(0, startTok - CONTEXT_TOKENS), startTok).join(''),
    suffix: tokens.slice(endTok + 1, endTok + 1 + CONTEXT_TOKENS).join(''),
    blockBaseIdx: block.baseIdx,
    blockId: block.id,
  };
}

/** 旧版浏览器数据（无批注字段）直接视为空批注集合；字段缺失的记录尽力修复。 */
export function migrateComments(raw: unknown): CommentRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: CommentRecord[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as CommentRecord).id === 'string' &&
      typeof (item as CommentRecord).text === 'string' &&
      (item as CommentRecord).anchor &&
      typeof (item as CommentRecord).anchor.quote === 'string'
    ) {
      const r = item as CommentRecord;
      out.push({
        id: r.id,
        text: r.text,
        createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
        updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
        anchor: {
          quote: r.anchor.quote,
          prefix: typeof r.anchor.prefix === 'string' ? r.anchor.prefix : '',
          suffix: typeof r.anchor.suffix === 'string' ? r.anchor.suffix : '',
          blockBaseIdx: typeof r.anchor.blockBaseIdx === 'number' ? r.anchor.blockBaseIdx : null,
          blockId: typeof r.anchor.blockId === 'string' ? r.anchor.blockId : null,
        },
      });
    }
  }
  return out;
}
