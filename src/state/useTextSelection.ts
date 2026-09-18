import { useCallback, useEffect, useState } from 'react';
import { parseTextSelection, selectionRect, type ParsedSelection } from '../lib/selection';

export interface SelectionState extends ParsedSelection {
  rect: { top: number; left: number } | null;
}

/**
 * 监听合并结果栏内的选区变化（mouseup / keyup / selectionchange）。
 * 选区必须落在带 data-annotation-target 的块内才返回坐标。
 */
export function useTextSelection(enabled: boolean) {
  const [selection, setSelection] = useState<SelectionState | null>(null);

  const refresh = useCallback(() => {
    if (!enabled) {
      setSelection(null);
      return;
    }
    const parsed = parseTextSelection(window.getSelection());
    if (!parsed) {
      setSelection(null);
      return;
    }
    const rect = selectionRect(window.getSelection());
    setSelection({
      ...parsed,
      rect: rect ? { top: rect.top, left: rect.left } : null,
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setSelection(null);
      return;
    }
    document.addEventListener('mouseup', refresh);
    document.addEventListener('keyup', refresh);
    document.addEventListener('selectionchange', refresh);
    return () => {
      document.removeEventListener('mouseup', refresh);
      document.removeEventListener('keyup', refresh);
      document.removeEventListener('selectionchange', refresh);
    };
  }, [enabled, refresh]);

  const clear = useCallback(() => {
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      // 部分环境不支持选区操作时忽略
    }
    setSelection(null);
  }, []);

  return { selection, clear };
}
