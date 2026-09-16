/**
 * 通用撤销/重做历史栈（纯函数，便于测试）。
 * present 为当前状态，past/future 为可回退/可重做的状态序列。
 */

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const MAX_HISTORY = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** 推入新状态；与当前状态相同（Object.is）时原样返回，并清空 future。 */
export function pushHistory<T>(h: History<T>, next: T): History<T> {
  if (Object.is(h.present, next)) return h;
  return { past: [...h.past, h.present].slice(-MAX_HISTORY), present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> | null {
  if (h.past.length === 0) return null;
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1],
    future: [h.present, ...h.future],
  };
}

export function redo<T>(h: History<T>): History<T> | null {
  if (h.future.length === 0) return null;
  const [next, ...future] = h.future;
  return { past: [...h.past, h.present].slice(-MAX_HISTORY), present: next, future };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}
