import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  localStorage.clear();
});

describe('工作台界面', () => {
  it('加载内置示例并显示两个待解决冲突', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: '联合改稿工作台' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '共同底稿' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '品牌版' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '法务版' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '合并结果' })).toBeTruthy();
    expect(screen.getByTestId('stat-pending').textContent).toContain('2');
    expect(screen.getByTestId('stat-moved').textContent).toContain('1');
    expect(screen.getByTestId('stat-inserted').textContent).toContain('2');
  });

  it('选择一侧解决冲突后，状态变为已解决', () => {
    render(<App />);
    const buttons = screen.getAllByRole('button', { name: '采用法务版' });
    fireEvent.click(buttons[0]);
    expect(screen.getByTestId('stat-resolved').textContent).toContain('1');
    expect(screen.getByTestId('stat-pending').textContent).toContain('1');
    expect(screen.getAllByText(/已解决 · 采用法务版/).length).toBeGreaterThan(0);
  });

  it('撤销可以回退裁决，重做可以恢复', () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: '采用品牌版' })[0]);
    expect(screen.getByTestId('stat-resolved').textContent).toContain('1');

    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(screen.getByTestId('stat-resolved').textContent).toContain('0');
    expect(screen.getByTestId('stat-pending').textContent).toContain('2');

    fireEvent.click(screen.getByRole('button', { name: /重做/ }));
    expect(screen.getByTestId('stat-resolved').textContent).toContain('1');
  });

  it('手动填写可以解决冲突', () => {
    render(<App />);
    const textarea = screen.getAllByLabelText('手动填写合并结果')[0];
    fireEvent.change(textarea, { target: { value: '人工定稿的最终表述。' } });
    fireEvent.click(screen.getAllByRole('button', { name: '使用手动文本' })[0]);
    expect(screen.getByTestId('stat-resolved').textContent).toContain('1');
    // 手动文本以差异高亮形式出现在已解决卡片中
    expect(screen.getByText('人工定稿')).toBeTruthy();
  });

  it('重新打开让冲突回到待解决', () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: '保留底稿' })[0]);
    expect(screen.getByTestId('stat-resolved').textContent).toContain('1');
    fireEvent.click(screen.getByRole('button', { name: '重新打开' }));
    expect(screen.getByTestId('stat-pending').textContent).toContain('2');
  });

  it('一键恢复示例会清空全部裁决', () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: '采用品牌版' })[0]);
    // 第一个冲突解决后其按钮消失，重新查询剩余的"采用法务版"按钮
    fireEvent.click(screen.getAllByRole('button', { name: '采用法务版' })[0]);
    expect(screen.getByTestId('stat-resolved').textContent).toContain('2');

    fireEvent.click(screen.getByRole('button', { name: /恢复示例/ }));
    expect(screen.getByTestId('stat-pending').textContent).toContain('2');
    expect(screen.getByTestId('stat-resolved').textContent).toContain('0');
  });

  it('状态持久化到 localStorage', () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: '采用品牌版' })[0]);
    unmount();

    render(<App />);
    expect(screen.getByTestId('stat-resolved').textContent).toContain('1');
  });
});
