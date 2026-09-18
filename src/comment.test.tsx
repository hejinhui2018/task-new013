import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import App from './App';

const LS_KEY = 'pr-merge-workbench:v1';

beforeEach(() => {
  localStorage.clear();
});

function startDemo() {
  fireEvent.click(screen.getByRole('button', { name: /90 秒批注演示/ }));
}

function nextDemo() {
  fireEvent.click(screen.getByTestId('demo-next'));
}

function demoCommentItem() {
  return document.querySelector('[data-comment-item="cm-demo"]') as HTMLElement;
}

function commentMarks() {
  return document.querySelectorAll('[data-cids~="cm-demo"]');
}

describe('批注功能集成', () => {
  it('90 秒演示：添加 → 移动跟随 → 冲突脱离 → 解决恢复 → 重写待重挂 → 手动重挂', () => {
    render(<App />);
    startDemo();
    expect(screen.getByText(/① 添加批注/)).toBeTruthy();

    // ① 添加批注
    nextDemo();
    let item = demoCommentItem();
    expect(item).toBeTruthy();
    expect(item.className).toContain('cm-status-attached');
    expect(commentMarks().length).toBeGreaterThan(0);

    // ② 段落移动到文末，批注跟随（仍挂接，标记出现在靠后的移动卡片上，而非旧位置）
    nextDemo();
    item = demoCommentItem();
    expect(item.className).toContain('cm-status-attached');
    const markedCard = (commentMarks()[0] as HTMLElement).closest('.merged-card') as HTMLElement;
    expect(markedCard.className).toContain('is-moved');
    const cards = Array.from(document.querySelectorAll('#merged-pane-body .merged-card'));
    const movedIndex = cards.indexOf(markedCard);
    expect(movedIndex).toBeGreaterThanOrEqual(cards.length - 3);
    expect(cards.indexOf(markedCard)).not.toBe(2);

    // ③ 双方改写产生冲突，批注脱离
    nextDemo();
    item = demoCommentItem();
    expect(item.className).toContain('cm-status-conflict');
    expect(commentMarks().length).toBe(0);
    expect(within(item).getByText(/落入未解决冲突/)).toBeTruthy();

    // ④ 采用品牌版解决 → 批注恢复
    nextDemo();
    item = demoCommentItem();
    expect(item.className).toContain('cm-status-attached');
    expect(commentMarks().length).toBeGreaterThan(0);

    // ⑤ 大幅重写 → 待重挂（orphan）
    nextDemo();
    item = demoCommentItem();
    expect(item.className).toContain('cm-status-orphan');
    expect(commentMarks().length).toBe(0);
    expect(within(item).getByText(/删除或大幅改写/)).toBeTruthy();
    expect(within(item).getByRole('button', { name: /手动选择新文字/ })).toBeTruthy();

    // ⑥ 模拟在新文字上重挂 → 恢复
    nextDemo();
    item = demoCommentItem();
    expect(item.className).toContain('cm-status-attached');
    expect(commentMarks().length).toBeGreaterThan(0);
    expect(screen.getByText(/演示完成/)).toBeTruthy();

    // 手动重挂同样可撤销：回退到待重挂状态
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect((demoCommentItem() as HTMLElement).className).toContain('cm-status-orphan');
    fireEvent.click(screen.getByRole('button', { name: /重做/ }));
    expect((demoCommentItem() as HTMLElement).className).toContain('cm-status-attached');
  });

  it('批注的新增与删除支持撤销 / 重做', () => {
    render(<App />);
    startDemo();
    nextDemo();
    expect(demoCommentItem()).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(demoCommentItem()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /重做/ }));
    expect(demoCommentItem()).toBeTruthy();

    // 删除批注同样进入历史
    fireEvent.click(within(demoCommentItem() as HTMLElement).getByLabelText('删除批注'));
    expect(demoCommentItem()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(demoCommentItem()).toBeTruthy();
  });

  it('编辑批注内容后列表与持久化都更新', () => {
    const { unmount } = render(<App />);
    startDemo();
    nextDemo();
    const item = demoCommentItem() as HTMLElement;
    fireEvent.click(within(item).getByLabelText('编辑批注'));
    fireEvent.change(within(item).getByLabelText('批注内容'), { target: { value: '改后意见' } });
    fireEvent.click(within(item).getByRole('button', { name: '保存' }));
    expect(within(item).getByText('改后意见')).toBeTruthy();

    unmount();
    render(<App />);
    expect(screen.getByText('改后意见')).toBeTruthy();
  });

  it('批注面板提供跳回原文，列表数量正确', () => {
    render(<App />);
    startDemo();
    nextDemo();
    const item = demoCommentItem() as HTMLElement;
    expect(screen.getByText(/批注（1）/)).toBeTruthy();
    expect(within(item).getByRole('button', { name: /原文/ })).toBeTruthy();
  });
});

describe('批注持久化与旧数据兼容', () => {
  it('刷新后批注仍在并按最新文稿重新跟踪', () => {
    const { unmount } = render(<App />);
    startDemo();
    nextDemo();
    unmount();
    render(<App />);
    expect(demoCommentItem()).toBeTruthy();
    expect((demoCommentItem() as HTMLElement).className).toContain('cm-status-attached');
  });

  it('旧版浏览器数据（没有 comments 字段）可以直接打开', () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        baseText: '甲\n\n乙',
        brandText: '甲\n\n乙',
        legalText: '甲\n\n乙',
        resolutions: {},
      }),
    );
    render(<App />);
    expect(screen.getByRole('heading', { name: '合并结果' })).toBeTruthy();
    expect(screen.getByText(/批注（0）/)).toBeTruthy();
    expect(screen.getByText(/在合并结果中选中一段文字即可添加批注/)).toBeTruthy();
  });

  it('字段残缺的批注记录不会导致页面崩溃，可正常打开', () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        baseText: '甲\n\n乙',
        brandText: '甲\n\n乙',
        legalText: '甲\n\n乙',
        resolutions: {},
        comments: [{ id: 'old1', text: '旧批注', anchor: { quote: '乙' } }],
      }),
    );
    render(<App />);
    expect(screen.getByText('旧批注')).toBeTruthy();
  });
});
