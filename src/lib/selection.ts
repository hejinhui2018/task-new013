/**
 * 把浏览器选区换算成"合并稿新文本坐标"。
 *
 * 正文中修改段落以词级 diff（<del> 旧词 / <ins> 新词）渲染，其 textContent
 * 比最终文本多出被删除的字。因此映射时跳过 <del> 子树：选区看到的坐标始终
 * 对应 block.text（最终文本），批注指纹也建立在最终文本之上。
 *
 * 用 TreeWalker 手工计数而不是 Range.cloneContents()——后者在部分环境
 * （如 jsdom）中无法正确截取终点位于内联元素内的片段。
 */

export interface ParsedSelection {
  blockKey: string;
  start: number;
  end: number;
}

const TARGET_ATTR = 'data-annotation-target';

function closestTarget(node: Node | null): HTMLElement | null {
  let el: HTMLElement | null =
    node && node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node?.parentElement ?? null;
  while (el && !el.hasAttribute(TARGET_ATTR)) {
    el = el.parentElement;
  }
  return el;
}

function firstTextNode(el: Node): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  return (walker.nextNode() as Text | null) ?? null;
}

function lastTextNode(el: Node): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  let cur: Node | null;
  while ((cur = walker.nextNode())) last = cur as Text;
  return last;
}

/** 把元素边界（node 为元素、offset 为子节点下标）归一化成文本节点边界。 */
function normalizePoint(node: Node, offset: number): { node: Text; offset: number } | null {
  if (node.nodeType === Node.TEXT_NODE) return { node: node as Text, offset };
  const kids = node.childNodes;
  if (kids.length === 0) return { node: node as unknown as Text, offset: 0 };
  if (offset >= kids.length) {
    const t = lastTextNode(node);
    return t ? { node: t, offset: t.data.length } : null;
  }
  const child = kids[offset];
  if (child.nodeType === Node.TEXT_NODE) return { node: child as Text, offset: 0 };
  const t = firstTextNode(child);
  return t ? { node: t, offset: 0 } : null;
}

function isInsideDel(node: Node, root: HTMLElement): boolean {
  let el: Node | null = node.parentElement;
  while (el && el !== root) {
    if (el.nodeName === 'DEL') return true;
    el = el.parentNode;
  }
  return false;
}

/** 计算 root 起点到（node, offset）之间属于"新文本"（不含 <del>）的字符数。 */
function pointToNewTextOffset(root: HTMLElement, rawNode: Node, rawOffset: number): number | null {
  const boundary = normalizePoint(rawNode, rawOffset);
  if (!boundary) return null;
  const { node: endNode, offset: endOffset } = boundary;
  if (!root.contains(endNode)) return null;

  let count = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cur: Node | null;
  // TreeWalker 按文档顺序产出文本节点，endNode 之前的节点必然在它前面
  while ((cur = walker.nextNode())) {
    const textNode = cur as Text;
    if (textNode === endNode) {
      if (!isInsideDel(endNode, root)) count += endOffset;
      break;
    }
    if (!isInsideDel(textNode, root)) count += textNode.data.length;
  }
  return count;
}

/**
 * 解析当前选区。要求起止点都在同一个 [data-annotation-target] 块内，
 * 且在新文本坐标下为非空区间；跨块或仅选中删除内容时返回 null。
 */
export function parseTextSelection(selection: Selection | null): ParsedSelection | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const startTarget = closestTarget(range.startContainer);
  const endTarget = closestTarget(range.endContainer);
  if (!startTarget || !endTarget || startTarget !== endTarget) return null;
  const blockKey = startTarget.getAttribute(TARGET_ATTR);
  if (!blockKey) return null;

  const start = pointToNewTextOffset(startTarget, range.startContainer, range.startOffset);
  const end = pointToNewTextOffset(startTarget, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;
  return { blockKey, start, end };
}

/** 选区相对视口的包围矩形（用于浮动工具条定位；老环境不支持时返回 null）。 */
export function selectionRect(selection: Selection | null): DOMRect | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (typeof range.getClientRects !== 'function') return null;
  const rects = range.getClientRects();
  if (!rects || rects.length === 0) return null;
  return range.getBoundingClientRect();
}
