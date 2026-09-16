import { describe, it, expect } from 'vitest';
import { canRedo, canUndo, createHistory, pushHistory, redo, undo } from './history';

describe('撤销 / 重做', () => {
  it('初始状态不可撤销、不可重做', () => {
    const h = createHistory<Record<string, number>>({});
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undo(h)).toBeNull();
    expect(redo(h)).toBeNull();
  });

  it('推入新状态后可撤销，撤销后可重做', () => {
    const h0 = createHistory<Record<string, number>>({});
    const h1 = pushHistory(h0, { a: 1 });
    expect(canUndo(h1)).toBe(true);
    expect(h1.present).toEqual({ a: 1 });

    const h2 = undo(h1)!;
    expect(h2.present).toEqual({});
    expect(canRedo(h2)).toBe(true);

    const h3 = redo(h2)!;
    expect(h3.present).toEqual({ a: 1 });
  });

  it('连续撤销按后进先出顺序回退', () => {
    let h = createHistory<number>(0);
    h = pushHistory(h, 1);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);
    expect(undo(h)!.present).toBe(2);
    expect(undo(undo(h)!)!.present).toBe(1);
    expect(undo(undo(undo(h)!)!)!.present).toBe(0);
    expect(undo(undo(undo(undo(h)!)!)!)).toBeNull();
  });

  it('撤销后推入新状态会清空重做栈', () => {
    let h = createHistory<number>(0);
    h = pushHistory(h, 1);
    h = pushHistory(h, 2);
    h = undo(h)!; // 回到 1
    expect(canRedo(h)).toBe(true);
    h = pushHistory(h, 9);
    expect(canRedo(h)).toBe(false);
    expect(h.present).toBe(9);
  });

  it('推入与当前相同的状态不产生历史记录', () => {
    const h0 = createHistory<Record<string, number>>({ a: 1 });
    const h1 = pushHistory(h0, h0.present);
    expect(h1).toBe(h0);
    expect(canUndo(h1)).toBe(false);
  });
});
