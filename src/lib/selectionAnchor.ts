/**
 * 从 window.Selection 提取批注锚点。
 *
 * 正文按两种方式渲染：没有批注时是普通文本节点（或 diff 的 ins/del 片段），
 * 有批注时被批注的词元才包成 [data-ctok] 元素。选区捕获因此不依赖固定 DOM：
 *
 * - 词元渲染模式：直接从 data-ctok 读取词元下标；
 * - 纯文本 / diff 模式：用 Range 字符端点沿文本节点累加逻辑偏移（落在
 *   <del> 内的文本跳过——删除片段不属于最终文本；same/add 片段拼接恰好
 *   等于块最终文本），再换算成词元区间。
 * - 再由 contentTokenSpans 生成 quote / prefix / suffix，与批注引擎的
 *   词元坐标完全对齐。
 */

import { contentTokenSpans } from './text';

export interface SelectionAnchor {
  blockId: string;
  startTok: number;
  endTok: number;
  quote: string;
  prefix: string;
  suffix: string;
}

const CONTEXT_CHARS = 40;

function isInDel(node: Node): boolean {
  const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
  return !!el?.closest('del');
}

/** 计算 Range 起止点在 scope 逻辑文本（排除 del 文本）中的字符偏移。 */
function rangeCharOffsets(scope: HTMLElement, range: Range): [number, number] | null {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const nodeStart = new Map<Text, number>();
  let offset = 0;
  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    if (!isInDel(textNode)) {
      nodeStart.set(textNode, offset);
      offset += textNode.data.length;
    }
  }

  const point = (container: Node, containerOffset: number): number | null => {
    if (container.nodeType !== Node.TEXT_NODE || isInDel(container)) return null;
    const start = nodeStart.get(container as Text);
    return start === undefined ? null : start + containerOffset;
  };

  const s = point(range.startContainer, range.startOffset);
  const e = point(range.endContainer, range.endOffset);
  if (s === null || e === null) return null;
  return s <= e ? [s, e] : [e, s];
}

function fromTokenRange(
  blockText: string,
  blockId: string,
  lo: number,
  hi: number,
): SelectionAnchor | null {
  const spans = contentTokenSpans(blockText);
  if (lo < 0 || hi >= spans.length || lo > hi) return null;
  const prefixStart = Math.max(
    0,
    (lo > 0 ? spans[lo - 1].start : spans[lo].start) - CONTEXT_CHARS,
  );
  return {
    blockId,
    startTok: lo,
    endTok: hi,
    quote: blockText.slice(spans[lo].start, spans[hi].end),
    prefix: blockText.slice(prefixStart, spans[lo].start),
    suffix: blockText.slice(spans[hi].end, Math.min(blockText.length, spans[hi].end + CONTEXT_CHARS)),
  };
}

function fromCharRange(blockText: string, blockId: string, c0: number, c1: number): SelectionAnchor | null {
  const spans = contentTokenSpans(blockText);
  // lo = 第一个结束位置严格大于选区起点的词元；hi = 最后一个开始位置严格小于选区终点的词元
  let lo = -1;
  let hi = -1;
  for (let i = 0; i < spans.length; i++) {
    if (lo === -1 && spans[i].end > c0) lo = i;
    if (spans[i].start < c1) hi = i;
    else break;
  }
  if (lo === -1 || hi === -1 || lo > hi) return null;
  return fromTokenRange(blockText, blockId, lo, hi);
}

export function extractCommentSelection(
  selection: Selection | null | undefined,
  blockTextOf: (blockId: string) => string | null,
): SelectionAnchor | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  return anchorFromRange(selection.getRangeAt(0), blockTextOf);
}

/** 从任意 Range 提取锚点（便于无 Selection 环境下测试与程序化复用）。 */
export function anchorFromRange(
  range: Range,
  blockTextOf: (blockId: string) => string | null,
): SelectionAnchor | null {
  // 词元渲染模式：直接读 data-ctok 下标
  const tokEl = (node: Node) =>
    (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement)?.closest<HTMLElement>('[data-ctok]') ??
    null;
  const startTokEl = tokEl(range.startContainer);
  const endTokEl = tokEl(range.endContainer);

  if (startTokEl && endTokEl) {
    const scope = startTokEl.closest('[data-comment-scope]');
    if (scope && endTokEl.closest('[data-comment-scope]') === scope) {
      const blockId = scope.getAttribute('data-comment-scope');
      if (blockId) {
        const lo = Number(startTokEl.dataset.ctok);
        const hi = Number(endTokEl.dataset.ctok);
        const blockText = blockTextOf(blockId);
        if (blockText !== null && Number.isFinite(lo) && Number.isFinite(hi)) {
          const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
          return fromTokenRange(blockText, blockId, a, b);
        }
      }
    }
  }

  // 纯文本 / diff 片段模式：字符偏移反查词元
  const scope =
    (range.commonAncestorContainer.nodeType === 1
      ? (range.commonAncestorContainer as HTMLElement)
      : range.commonAncestorContainer.parentElement
    )?.closest<HTMLElement>('[data-comment-scope]') ?? null;
  if (!scope) return null;
  const blockId = scope.getAttribute('data-comment-scope');
  if (!blockId) return null;
  const blockText = blockTextOf(blockId);
  if (blockText === null) return null;

  const chars = rangeCharOffsets(scope, range);
  if (!chars) return null;
  const [c0, c1] = chars;
  if (c0 >= c1) return null;
  return fromCharRange(blockText, blockId, c0, c1);
}
