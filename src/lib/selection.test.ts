import { describe, it, expect, beforeEach } from 'vitest';
import { parseTextSelection } from './selection';

/** 在指定文本节点上构造选区并解析。 */
function select(startNode: Text, startOffset: number, endNode?: Text, endOffset?: number) {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode ?? startNode, endOffset ?? startOffset);
  const sel = window.getSelection();
  sel!.removeAllRanges();
  sel!.addRange(range);
  return parseTextSelection(sel);
}

function textNodes(el: HTMLElement): Text[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) out.push(n as Text);
  return out;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('parseTextSelection', () => {
  it('把普通段落内的选区换算成字符区间', () => {
    document.body.innerHTML = '<p data-annotation-target="b2">甲方同意在验收后三十日内付款。</p>';
    const p = document.querySelector('[data-annotation-target="b2"]') as HTMLElement;
    const [node] = textNodes(p);
    const parsed = select(node, 5, node, 9);
    expect(parsed).toEqual({ blockKey: 'b2', start: 5, end: 9 });
  });

  it('选区跨越 <del>/<ins> 时跳过删除文字，坐标对应最终文本', () => {
    // 最终文本 = "保留前半句" + "新增文字" + "保留后半句"（14 字）
    document.body.innerHTML =
      '<p data-annotation-target="b1"><span>保留前半句</span><del>删掉的字</del><ins>新增文字</ins><span>保留后半句</span></p>';
    const p = document.querySelector('[data-annotation-target="b1"]') as HTMLElement;
    const nodes = textNodes(p);
    // 从 <ins> 第 2 字选到末尾段落结尾
    const parsed = select(nodes[2], 2, nodes[3], nodes[3].data.length);
    // 5（前半句）+ 2（ins 内偏移）= 7；全长 14
    expect(parsed).toEqual({ blockKey: 'b1', start: 7, end: 14 });
  });

  it('选区完全落在 <del> 删除内容上时返回 null（不能给已删文字挂批注）', () => {
    document.body.innerHTML =
      '<p data-annotation-target="b1">前文<del>删除部分</del>后文</p>';
    const p = document.querySelector('[data-annotation-target="b1"]') as HTMLElement;
    const nodes = textNodes(p);
    const delNode = nodes[1];
    expect(select(delNode, 0, delNode, delNode.data.length)).toBeNull();
  });

  it('跨两个块的选区返回 null', () => {
    document.body.innerHTML =
      '<p data-annotation-target="b0">第一段文字</p><p data-annotation-target="b1">第二段文字</p>';
    const targets = document.querySelectorAll('[data-annotation-target]');
    const n0 = textNodes(targets[0] as HTMLElement)[0];
    const n1 = textNodes(targets[1] as HTMLElement)[0];
    expect(select(n0, 0, n1, 2)).toBeNull();
  });

  it('折叠选区或无选区返回 null', () => {
    document.body.innerHTML = '<p data-annotation-target="b0">文字内容</p>';
    expect(parseTextSelection(window.getSelection())).toBeNull();
  });
});
