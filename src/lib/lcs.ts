/**
 * 通用序列算法：最长公共子序列（LCS）与最长递增子序列（LIS）。
 * 文档与段落规模都很小，使用经典 DP 实现即可。
 */

/** 返回 a、b 的 LCS 匹配下标对（按 a 的下标升序）。 */
export function lcsPairs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = a[i:] 与 b[j:] 的 LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/** LCS 长度（空间友好的独立实现，供相似度使用）。 */
export function lcsLength<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): number {
  const n = a.length;
  const m = b.length;
  let prev = new Array<number>(m + 1).fill(0);
  let curr = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      curr[j] = eq(a[i - 1], b[j - 1]) ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev.fill(0)];
  }
  return prev[m];
}

/**
 * 最长严格递增子序列：返回属于 LIS 的元素下标集合。
 * 用于在一组对齐段落对中找出"保持相对顺序"的最大子集，
 * 不在子集中的配对即为被移动的段落。
 */
export function lisIndices(seq: number[]): Set<number> {
  const n = seq.length;
  const result = new Set<number>();
  if (n === 0) return result;
  // tails[k] = 长度为 k+1 的递增子序列的最小末尾元素在 seq 中的下标
  const tails: number[] = [];
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    if (lo === tails.length) tails.push(i);
    else tails[lo] = i;
  }
  let k: number = tails[tails.length - 1];
  while (k !== -1) {
    result.add(k);
    k = prev[k];
  }
  return result;
}
