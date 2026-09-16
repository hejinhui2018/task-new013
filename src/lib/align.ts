import { normalizeText } from './text';
import { lcsPairs, lisIndices } from './lcs';
import { similarity } from './similarity';

/**
 * 底稿与某一修订版之间的段落对齐。
 *
 * 算法分三步：
 * 1. 用 LCS 找出内容完全一致的段落锚点；
 * 2. 对未匹配的段落按词级相似度做贪心配对（同一"空隙"内阈值低，跨空隙阈值高，
 *    以区分"原地改写"与"移动到别处的段落"）。空隙锚点先取自 LCS，配对一轮后再
 *    用已确认的原地配对重算锚点重试——避免 LCS 平票选择干扰空隙判定；
 * 3. 在所有配对上求最长递增子序列（LIS），落在 LIS 之外的配对即为"被移动的段落"。
 *    这样即使某段被移动后内容未变，也不会被误判成"删除 + 新增"。
 */

export interface AlignPair {
  baseIdx: number;
  verIdx: number;
  /** 相对位置发生了变化（被移动） */
  moved: boolean;
  /** 内容相对底稿有修改（按归一化文本比较） */
  modified: boolean;
}

export interface Alignment {
  pairs: AlignPair[];
  /** 在该版本中已删除的底稿段落下标 */
  deleted: number[];
  /** 该版本新增的段落及其锚点（anchor = 位于底稿第 anchor 段之后，-1 表示文首） */
  inserted: Array<{ verIdx: number; anchor: number }>;
  /** 移动段落 / 新增段落在版本中的下标 -> 锚点底稿下标 */
  anchorOf: Map<number, number>;
}

/** 同一空隙内（位置未变）的改写配对阈值：允许较大幅度的重写 */
const SAME_GAP_THRESHOLD = 0.25;
/** 跨空隙（位置变化）的配对阈值：要求较高相似度才认定为同一段落的移动 */
const CROSS_GAP_THRESHOLD = 0.55;

interface GapAnchors {
  prevB: number[];
  nextB: number[];
  prevV: number[];
  nextV: number[];
}

/** 给定一组锚点配对，计算每个下标前后最近的锚点（版本侧换算成底稿下标）。 */
function computeGapAnchors(anchorPairs: Array<[number, number]>, n: number, m: number): GapAnchors {
  const isAnchorB = new Set(anchorPairs.map(([b]) => b));
  const baseOfVer = new Map(anchorPairs.map(([b, v]) => [v, b]));
  const prevB = new Array<number>(n).fill(-1);
  const nextB = new Array<number>(n).fill(n);
  for (let i = 0, last = -1; i < n; i++) {
    prevB[i] = last;
    if (isAnchorB.has(i)) last = i;
  }
  for (let i = n - 1, last = n; i >= 0; i--) {
    nextB[i] = last;
    if (isAnchorB.has(i)) last = i;
  }
  const prevV = new Array<number>(m).fill(-1);
  const nextV = new Array<number>(m).fill(n);
  for (let j = 0, last = -1; j < m; j++) {
    prevV[j] = last;
    const b = baseOfVer.get(j);
    if (b !== undefined) last = b;
  }
  for (let j = m - 1, last = n; j >= 0; j--) {
    nextV[j] = last;
    const b = baseOfVer.get(j);
    if (b !== undefined) last = b;
  }
  return { prevB, nextB, prevV, nextV };
}

export function alignVersion(base: string[], ver: string[]): Alignment {
  const nb = base.map(normalizeText);
  const nv = ver.map(normalizeText);

  // 1. 完全一致段落的 LCS 锚点
  const lcs = lcsPairs(nb, nv, (x, y) => x === y);
  const usedB = new Set(lcs.map(([b]) => b));
  const usedV = new Set(lcs.map(([, v]) => v));

  // 2. 相似度贪心配对，最多两轮：第二轮用第一轮确认的原地配对作为空隙锚点
  const matched: Array<[number, number]> = [];
  let anchorPairs: Array<[number, number]> = lcs;
  for (let pass = 0; pass < 2; pass++) {
    const unmatchedBase: number[] = [];
    for (let i = 0; i < base.length; i++) if (!usedB.has(i)) unmatchedBase.push(i);
    const unmatchedVer: number[] = [];
    for (let j = 0; j < ver.length; j++) if (!usedV.has(j)) unmatchedVer.push(j);
    if (unmatchedBase.length === 0 || unmatchedVer.length === 0) break;

    const anchors = computeGapAnchors(anchorPairs, base.length, ver.length);
    interface Candidate {
      s: number;
      bi: number;
      vi: number;
    }
    const candidates: Candidate[] = [];
    for (const bi of unmatchedBase) {
      for (const vi of unmatchedVer) {
        const sameGap =
          anchors.prevB[bi] === anchors.prevV[vi] && anchors.nextB[bi] === anchors.nextV[vi];
        const s = similarity(base[bi], ver[vi]);
        if (s >= (sameGap ? SAME_GAP_THRESHOLD : CROSS_GAP_THRESHOLD)) {
          candidates.push({ s, bi, vi });
        }
      }
    }
    if (candidates.length === 0) break;
    candidates.sort((x, y) => y.s - x.s || x.bi - y.bi || x.vi - y.vi);
    let anyNew = false;
    for (const c of candidates) {
      if (usedB.has(c.bi) || usedV.has(c.vi)) continue;
      usedB.add(c.bi);
      usedV.add(c.vi);
      matched.push([c.bi, c.vi]);
      anyNew = true;
    }
    if (!anyNew) break;
    // 下一轮的空隙锚点：当前所有配对中保持相对顺序（原地）的部分
    const soFar = [...lcs, ...matched].sort((x, y) => x[0] - y[0]);
    const inOrder = lisIndices(soFar.map(([, v]) => v));
    anchorPairs = soFar.filter((_, k) => inOrder.has(k));
  }

  // 3. LIS 判定移动：保持相对顺序的配对为原地段落，其余为移动段落
  const allPairs: Array<[number, number]> = [...lcs, ...matched];
  allPairs.sort((x, y) => x[0] - y[0]);
  const inOrder = lisIndices(allPairs.map(([, v]) => v));
  const pairs: AlignPair[] = allPairs.map(([bi, vi], k) => ({
    baseIdx: bi,
    verIdx: vi,
    moved: !inOrder.has(k),
    modified: nb[bi] !== nv[vi],
  }));

  const deleted: number[] = [];
  for (let i = 0; i < base.length; i++) if (!usedB.has(i)) deleted.push(i);
  const insertedVer: number[] = [];
  for (let j = 0; j < ver.length; j++) if (!usedV.has(j)) insertedVer.push(j);

  // 锚点：按版本顺序扫描，移动/新增段落挂在它前面最近的"原地段落"之后。
  // 连续移动的多段会共享同一锚点并保持相对顺序，块移动不会被拆散。
  const pairByVer = new Map(pairs.map((p) => [p.verIdx, p]));
  const anchorOf = new Map<number, number>();
  let lastInPlace = -1;
  for (let j = 0; j < ver.length; j++) {
    const p = pairByVer.get(j);
    if (p && !p.moved) {
      lastInPlace = p.baseIdx;
    } else {
      anchorOf.set(j, lastInPlace);
    }
  }

  return {
    pairs,
    deleted,
    inserted: insertedVer.map((vi) => ({ verIdx: vi, anchor: anchorOf.get(vi) ?? -1 })),
    anchorOf,
  };
}
