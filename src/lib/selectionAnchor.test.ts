// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { anchorFromRange } from './selectionAnchor';
import { contentTokenSpans } from './text';

beforeEach(() => {
  document.body.innerHTML = '';
});

function selectText(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Range {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

describe('选区 → 批注锚点', () => {
  it('纯文本块中按字符选区换算成词元区间', () => {
    const text = '星澜科技服务超过十二万家中小企业。';
    const scope = document.createElement('p');
    scope.setAttribute('data-comment-scope', 'b5');
    scope.textContent = text;
    document.body.appendChild(scope);

    const from = text.indexOf('十二万家');
    const to = text.indexOf('中小企业') + '中小企业'.length;
    const range = selectText(scope.firstChild!, from, scope.firstChild!, to);
    const anchor = anchorFromRange(range, () => text);
    expect(anchor).not.toBeNull();
    expect(anchor!.blockId).toBe('b5');
    expect(anchor!.quote).toBe('十二万家中小企业');
    expect(anchor!.prefix).toContain('超过');
    expect(anchor!.suffix).toContain('。');
  });

  it('差异视图中跳过 del 文本，命中最终文本里的词', () => {
    // DOM 模拟 diff：<del>旧词</del><span>新句子内容</span><ins>追加</ins>
    const scope = document.createElement('p');
    scope.setAttribute('data-comment-scope', 'b1');
    const del = document.createElement('del');
    del.textContent = '旧词';
    const same = document.createElement('span');
    same.textContent = '新句子内容';
    const ins = document.createElement('ins');
    ins.textContent = '追加';
    scope.append(del, same, ins);
    document.body.appendChild(scope);

    // 逻辑最终文本 = '新句子内容追加'，节点 '新句子内容' 内选中 '句子'（偏移 1–3）
    const finalText = '新句子内容追加';
    const range = selectText(same.firstChild!, 1, same.firstChild!, 3);
    const anchor = anchorFromRange(range, () => finalText);
    expect(anchor).not.toBeNull();
    expect(anchor!.quote).toBe('句子');
  });

  it('词元渲染模式直接读取 data-ctok 下标', () => {
    const text = '甲方乙方丙方';
    const scope = document.createElement('p');
    scope.setAttribute('data-comment-scope', 'b2');
    const spans = contentTokenSpans(text);
    spans.forEach((s, i) => {
      const el = document.createElement('span');
      el.setAttribute('data-ctok', String(i));
      el.textContent = text.slice(s.start, s.end);
      scope.appendChild(el);
    });
    document.body.appendChild(scope);

    const range = selectText(
      scope.children[1].firstChild!,
      0,
      scope.children[2].firstChild!,
      scope.children[2].textContent!.length,
    );
    const anchor = anchorFromRange(range, () => text);
    expect(anchor).not.toBeNull();
    expect(anchor!.startTok).toBe(1);
    expect(anchor!.endTok).toBe(2);
    expect(anchor!.quote).toBe('方乙'); // 内容词元：甲/方/乙/方/丙/方 → 下标1-2 = 方乙
  });

  it('选区完全落在 del 内时返回 null', () => {
    const scope = document.createElement('p');
    scope.setAttribute('data-comment-scope', 'b3');
    const del = document.createElement('del');
    del.textContent = '被删的字';
    scope.appendChild(del);
    document.body.appendChild(scope);
    const range = selectText(del.firstChild!, 0, del.firstChild!, 3);
    expect(anchorFromRange(range, () => '最终文本') ).toBeNull();
  });

  it('选区不在任何批注作用域内时返回 null', () => {
    const p = document.createElement('p');
    p.textContent = '随便一段话';
    document.body.appendChild(p);
    const range = selectText(p.firstChild!, 0, p.firstChild!, 2);
    expect(anchorFromRange(range, () => 'x')).toBeNull();
  });
});
