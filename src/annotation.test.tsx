import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import App from './App';
import { SAMPLE_BASE, SAMPLE_BRAND, SAMPLE_LEGAL } from './sample';

beforeEach(() => {
  localStorage.clear();
});

/** 在某个正文块内选中文本（用于未拆分过的普通段落），并触发选区监听。 */
function selectInBlock(blockKey: string, substring: string) {
  const target = document.querySelector(`[data-annotation-target="${blockKey}"]`) as HTMLElement;
  expect(target, `块 ${blockKey} 应存在`).toBeTruthy();
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  let node: Text | null = null;
  let offset = -1;
  let cur: Node | null;
  while ((cur = walker.nextNode())) {
    const t = cur as Text;
    const i = t.data.indexOf(substring);
    if (i >= 0) {
      node = t;
      offset = i;
      break;
    }
  }
  expect(node, `应在块 ${blockKey} 中找到「${substring}」`).toBeTruthy();
  const range = document.createRange();
  range.setStart(node!, offset);
  range.setEnd(node!, offset + substring.length);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  fireEvent.mouseUp(document);
}

function sidebarItems() {
  return document.querySelectorAll('.ann-item');
}

function itemWithNote(re: RegExp): HTMLElement {
  const items = [...sidebarItems()] as HTMLElement[];
  return items.find((el) => re.test(el.textContent ?? ''))!;
}

describe('批注功能', () => {
  it('选中文字 → 添加批注：侧栏出现条目，正文出现高亮，撤销/重做有效', () => {
    render(<App />);
    expect(screen.getByText('还没有批注。在合并结果里选中一段文字试试。')).toBeTruthy();

    selectInBlock('b0', '联合宣布');
    fireEvent.click(screen.getByRole('button', { name: '＋ 对所选文字添加批注' }));

    const textarea = screen.getByLabelText('批注留言');
    fireEvent.change(textarea, { target: { value: '标题需补充签约城市' } });
    fireEvent.click(screen.getByRole('button', { name: '提交批注' }));

    expect(sidebarItems()).toHaveLength(1);
    expect(screen.getByText('标题需补充签约城市')).toBeTruthy();
    const mark = document.querySelector('.annotation-mark') as HTMLElement;
    expect(mark.textContent).toBe('联合宣布');

    // 撤销 / 重做
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(sidebarItems()).toHaveLength(0);
    expect(document.querySelector('.annotation-mark')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /重做/ }));
    expect(sidebarItems()).toHaveLength(1);
    expect(document.querySelector('.annotation-mark')?.textContent).toBe('联合宣布');
  });

  it('一键载入演示批注：2 条正常挂接、2 条因未解决冲突脱离', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '① 一键载入演示批注' }));
    expect(sidebarItems()).toHaveLength(4);
    expect(document.querySelectorAll('.ann-item.ann-attached')).toHaveLength(2);
    expect(document.querySelectorAll('.ann-item.ann-conflict')).toHaveLength(2);
    // 冲突卡片顶部出现脱离批注横幅
    expect(screen.getAllByText(/条批注随此冲突暂时脱离正文/).length).toBe(2);
    // 正文上有 2 条批注高亮（diff 段一条批注可能横跨多个片段，按批注 id 去重）
    const markedIds = new Set(
      [...document.querySelectorAll('.annotation-mark')].map((el) =>
        el.getAttribute('data-annotation-anchor'),
      ),
    );
    expect(markedIds.size).toBe(2);
  });

  it('品牌再移动段落后，批注跟随到新位置（仍为已挂接）', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '① 一键载入演示批注' }));
    fireEvent.click(screen.getByRole('button', { name: '② 品牌再移动一段' }));
    // 移动没有引入新冲突
    expect(screen.getByTestId('stat-pending').textContent).toContain('2');
    // 原有的 1 个移动 + 演示新增的 1 个移动
    expect(screen.getByTestId('stat-moved').textContent).toContain('2');
    const moved = itemWithNote(/跟随演示/);
    expect(moved.classList.contains('ann-attached')).toBe(true);
    // 该段落（b9 媒体垂询段）确实被移到了合并结果的最前面
    const firstCard = document.querySelector('.pane-merged .pane-body > div:first-child .merged-card');
    expect(firstCard?.getAttribute('data-base-idx')).toBe('9');
    expect(firstCard?.classList.contains('is-moved')).toBe(true);
    // 高亮也跟到了新位置
    const markedIds = new Set(
      [...firstCard!.querySelectorAll('.annotation-mark')].map((el) =>
        el.getAttribute('data-annotation-anchor'),
      ),
    );
    expect(markedIds.size).toBe(1);
  });

  it('冲突解决为法务版后，脱离的批注自动重新挂回正文', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '① 一键载入演示批注' }));
    const before = itemWithNote(/冲突脱离/);
    expect(before.classList.contains('ann-conflict')).toBe(true);

    // 第一个冲突是行长引言 edit-edit，采用法务版
    fireEvent.click(screen.getAllByRole('button', { name: '采用法务版' })[0]);

    expect(screen.getByTestId('stat-pending').textContent).toContain('1');
    const after = itemWithNote(/冲突脱离/);
    expect(after.classList.contains('ann-attached')).toBe(true);
    // 已解决卡片出现"重新挂回"提示徽章
    expect(screen.getByText(/条批注已随解决结果重新挂回/)).toBeTruthy();
  });

  it('裁决删除整段后批注标为待重挂，手动重挂到新文字后恢复', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '① 一键载入演示批注' }));

    // 免责声明 delete-edit 冲突：采用品牌版（删除此段）
    fireEvent.click(screen.getByRole('button', { name: /采用品牌版（删除此段）/ }));
    const detached = itemWithNote(/删除待重挂/);
    expect(detached.classList.contains('ann-detached')).toBe(true);

    // 手动重挂：进入重挂模式 → 在"关于星澜科技"段选中文字 → 确认
    fireEvent.click(within(detached).getByRole('button', { name: '手动重挂' }));
    expect(detached.querySelector('.ann-reanchoring-hint')).toBeTruthy();
    expect(detached.classList.contains('is-reanchoring')).toBe(true);
    selectInBlock('b7', '智能财税软件服务商');
    fireEvent.click(screen.getByRole('button', { name: '✓ 把批注重挂到所选文字' }));
    fireEvent.click(screen.getByRole('button', { name: '确认重挂' }));

    const fixed = itemWithNote(/删除待重挂/);
    expect(fixed.classList.contains('ann-attached')).toBe(true);
    // 新位置出现该批注高亮
    const b7 = document.querySelector('[data-annotation-target="b7"]')!;
    expect(b7.querySelector('.annotation-mark')?.textContent).toBe('智能财税软件服务商');

    // 重挂同样支持撤销：撤销后回到待重挂，再重做恢复
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(itemWithNote(/删除待重挂/).classList.contains('ann-detached')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /重做/ }));
    expect(itemWithNote(/删除待重挂/).classList.contains('ann-attached')).toBe(true);
  });

  it('编辑与删除批注', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '① 一键载入演示批注' }));
    expect(sidebarItems()).toHaveLength(4);

    // 侧栏按状态排序，第一条是冲突批注
    const first = sidebarItems()[0] as HTMLElement;
    fireEvent.click(within(first).getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('编辑批注内容'), { target: { value: '改后的批注内容' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(within(first).getByText('改后的批注内容')).toBeTruthy();

    fireEvent.click(within(first).getByRole('button', { name: '删除' }));
    expect(sidebarItems()).toHaveLength(3);
    expect(screen.queryByText('改后的批注内容')).toBeNull();
  });

  it('从批注列表跳回原文：高亮被激活', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '① 一键载入演示批注' }));
    const jumpButtons = screen.getAllByRole('button', { name: '跳回原文' });
    expect(jumpButtons.length).toBe(2);
    fireEvent.click(jumpButtons[0]);
    expect(document.querySelectorAll('.annotation-mark.is-active').length).toBeGreaterThan(0);
  });

  it('批注与裁决一起持久化，刷新后恢复', () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '① 一键载入演示批注' }));
    // 顺手解决一个冲突
    fireEvent.click(screen.getAllByRole('button', { name: '采用法务版' })[0]);
    expect(sidebarItems()).toHaveLength(4);
    unmount();

    render(<App />);
    expect(sidebarItems()).toHaveLength(4);
    // 已解决数也恢复
    expect(screen.getByTestId('stat-resolved').textContent).toContain('1');
    // 脱离的那条恢复后自动重判为已挂接
    expect(itemWithNote(/冲突脱离/).classList.contains('ann-attached')).toBe(true);
  });

  it('旧版浏览器数据（无 annotations 字段）仍可直接打开', () => {
    localStorage.setItem(
      'pr-merge-workbench:v1',
      JSON.stringify({
        baseText: SAMPLE_BASE,
        brandText: SAMPLE_BRAND,
        legalText: SAMPLE_LEGAL,
        resolutions: { c4: { choice: 'legal' } },
      }),
    );
    render(<App />);
    expect(screen.getByRole('heading', { name: '合并结果' })).toBeTruthy();
    expect(sidebarItems()).toHaveLength(0);
    // 旧数据中的裁决生效
    expect(screen.getByTestId('stat-resolved').textContent).toContain('1');
    // 旧数据上仍可新增批注
    selectInBlock('b0', '战略合作');
    fireEvent.click(screen.getByRole('button', { name: '＋ 对所选文字添加批注' }));
    fireEvent.change(screen.getByLabelText('批注留言'), { target: { value: '旧数据上的新批注' } });
    fireEvent.click(screen.getByRole('button', { name: '提交批注' }));
    expect(sidebarItems()).toHaveLength(1);
  });

  it('复制出的正文不包含任何批注文字', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '① 一键载入演示批注' }));
    fireEvent.click(screen.getByRole('button', { name: /复制合并稿/ }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const exported = writeText.mock.calls[0][0] as string;
    expect(exported).toContain('星澜科技');
    expect(exported).not.toContain('跟随演示');
    expect(exported).not.toContain('单侧改稿演示');
    expect(exported).not.toContain('审稿人');
    expect(exported).not.toContain('批注');
  });
});
