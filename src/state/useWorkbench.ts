import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildMergedDocument, type Choice, type Resolutions } from '../lib/merge';
import { splitParagraphs } from '../lib/text';
import { SAMPLE_BASE, SAMPLE_BRAND, SAMPLE_LEGAL } from '../sample';
import {
  canRedo as histCanRedo,
  canUndo as histCanUndo,
  createHistory,
  pushHistory,
  redo as histRedo,
  undo as histUndo,
  type History,
} from './history';

const LS_KEY = 'pr-merge-workbench:v1';

interface Persisted {
  baseText: string;
  brandText: string;
  legalText: string;
  resolutions: Resolutions;
}

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (
      typeof parsed.baseText === 'string' &&
      typeof parsed.brandText === 'string' &&
      typeof parsed.legalText === 'string' &&
      parsed.resolutions !== null &&
      typeof parsed.resolutions === 'object'
    ) {
      return parsed as Persisted;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 工作台状态：三份文稿 + 冲突裁决（带撤销/重做），全部持久化到 localStorage。
 * 合并结果由纯函数 buildMergedDocument 派生，任何状态变化都会自动重算。
 */
export function useWorkbench() {
  const [persisted] = useState(loadPersisted);
  const [baseText, setBaseText] = useState(persisted?.baseText ?? SAMPLE_BASE);
  const [brandText, setBrandText] = useState(persisted?.brandText ?? SAMPLE_BRAND);
  const [legalText, setLegalText] = useState(persisted?.legalText ?? SAMPLE_LEGAL);
  const [history, setHistory] = useState<History<Resolutions>>(() =>
    createHistory(persisted?.resolutions ?? {}),
  );

  useEffect(() => {
    try {
      const payload: Persisted = { baseText, brandText, legalText, resolutions: history.present };
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {
      // 存储不可用（如隐私模式）时静默降级为内存态
    }
  }, [baseText, brandText, legalText, history.present]);

  const base = useMemo(() => splitParagraphs(baseText), [baseText]);
  const brand = useMemo(() => splitParagraphs(brandText), [brandText]);
  const legal = useMemo(() => splitParagraphs(legalText), [legalText]);
  const merge = useMemo(
    () => buildMergedDocument(base, brand, legal, history.present),
    [base, brand, legal, history.present],
  );

  const resolve = useCallback((id: string, choice: Choice, manualText?: string) => {
    setHistory((h) =>
      pushHistory(h, {
        ...h.present,
        [id]: choice === 'manual' ? { choice, manualText: manualText ?? '' } : { choice },
      }),
    );
  }, []);

  const unresolve = useCallback((id: string) => {
    setHistory((h) => {
      if (!(id in h.present)) return h;
      const next = { ...h.present };
      delete next[id];
      return pushHistory(h, next);
    });
  }, []);

  const undo = useCallback(() => setHistory((h) => histUndo(h) ?? h), []);
  const redo = useCallback(() => setHistory((h) => histRedo(h) ?? h), []);

  const resetSample = useCallback(() => {
    setBaseText(SAMPLE_BASE);
    setBrandText(SAMPLE_BRAND);
    setLegalText(SAMPLE_LEGAL);
    setHistory((h) => (Object.keys(h.present).length === 0 ? h : pushHistory(h, {})));
  }, []);

  return {
    baseText,
    brandText,
    legalText,
    setBaseText,
    setBrandText,
    setLegalText,
    base,
    brand,
    legal,
    merge,
    resolutions: history.present,
    resolve,
    unresolve,
    undo,
    redo,
    canUndo: histCanUndo(history),
    canRedo: histCanRedo(history),
    resetSample,
  };
}
