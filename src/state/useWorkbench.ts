import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  attachAnnotations,
  reanchorAnnotation,
  type Annotation,
  type AnnotationAnchor,
  type AnnotationAttachment,
} from '../lib/annotation';
import { buildMergedDocument, type Choice, type Resolutions } from '../lib/merge';
import { splitParagraphs } from '../lib/text';
import { SAMPLE_BASE, SAMPLE_BRAND, SAMPLE_LEGAL, buildDemoAnchors } from '../sample';
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
const ANNOTATION_AUTHOR = '审稿人';

/** 进入撤销历史的可编辑文档状态：冲突裁决 + 批注。 */
export interface DocState {
  resolutions: Resolutions;
  annotations: Annotation[];
}

interface Persisted {
  baseText: string;
  brandText: string;
  legalText: string;
  resolutions: Resolutions;
  annotations: Annotation[];
}

function isValidAnnotation(x: unknown): x is Annotation {
  if (x === null || typeof x !== 'object') return false;
  const a = x as Record<string, unknown>;
  const anchor = a.anchor as Record<string, unknown> | null | undefined;
  return (
    typeof a.id === 'string' &&
    typeof a.note === 'string' &&
    typeof a.createdAt === 'number' &&
    typeof a.updatedAt === 'number' &&
    !!anchor &&
    typeof anchor.blockKey === 'string' &&
    typeof anchor.exact === 'string' &&
    typeof anchor.prefix === 'string' &&
    typeof anchor.suffix === 'string'
  );
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
      // 旧版数据没有 annotations 字段：按空列表处理，旧数据可直接打开
      const annotations = Array.isArray(parsed.annotations)
        ? parsed.annotations.filter(isValidAnnotation)
        : [];
      return {
        baseText: parsed.baseText,
        brandText: parsed.brandText,
        legalText: parsed.legalText,
        resolutions: parsed.resolutions as Resolutions,
        annotations,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 工作台状态：三份文稿 + 文档状态（冲突裁决与批注，共用一条撤销/重做历史），
 * 全部持久化到 localStorage。合并结果由纯函数 buildMergedDocument 派生，
 * 批注落点再由 attachAnnotations 从合并结果派生——任何状态变化都会自动重算，
 * 因此段落移动、单侧改稿、重新合并或冲突解决后，批注都会重新判断位置。
 */
export function useWorkbench() {
  const [persisted] = useState(loadPersisted);
  const [baseText, setBaseText] = useState(persisted?.baseText ?? SAMPLE_BASE);
  const [brandText, setBrandText] = useState(persisted?.brandText ?? SAMPLE_BRAND);
  const [legalText, setLegalText] = useState(persisted?.legalText ?? SAMPLE_LEGAL);
  const initial: DocState = {
    resolutions: persisted?.resolutions ?? {},
    annotations: persisted?.annotations ?? [],
  };
  const [history, setHistory] = useState<History<DocState>>(() => createHistory(initial));
  const idCounter = useRef(0);

  const newId = useCallback(() => {
    idCounter.current += 1;
    return `a${Date.now().toString(36)}-${idCounter.current}`;
  }, []);

  useEffect(() => {
    try {
      const payload: Persisted = {
        baseText,
        brandText,
        legalText,
        resolutions: history.present.resolutions,
        annotations: history.present.annotations,
      };
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {
      // 存储不可用（如隐私模式）时静默降级为内存态
    }
  }, [baseText, brandText, legalText, history.present]);

  const base = useMemo(() => splitParagraphs(baseText), [baseText]);
  const brand = useMemo(() => splitParagraphs(brandText), [brandText]);
  const legal = useMemo(() => splitParagraphs(legalText), [legalText]);
  const merge = useMemo(
    () => buildMergedDocument(base, brand, legal, history.present.resolutions),
    [base, brand, legal, history.present.resolutions],
  );
  const attachments = useMemo(
    () => attachAnnotations(merge, history.present.annotations),
    [merge, history.present.annotations],
  );

  const mutateDoc = useCallback((fn: (d: DocState) => DocState) => {
    setHistory((h) => {
      const next = fn(h.present);
      return next === h.present ? h : pushHistory(h, next);
    });
  }, []);

  const resolve = useCallback(
    (id: string, choice: Choice, manualText?: string) => {
      mutateDoc((d) => ({
        ...d,
        resolutions: {
          ...d.resolutions,
          [id]: choice === 'manual' ? { choice, manualText: manualText ?? '' } : { choice },
        },
      }));
    },
    [mutateDoc],
  );

  const unresolve = useCallback(
    (id: string) => {
      mutateDoc((d) => {
        if (!(id in d.resolutions)) return d;
        const resolutions = { ...d.resolutions };
        delete resolutions[id];
        return { ...d, resolutions };
      });
    },
    [mutateDoc],
  );

  const addAnnotation = useCallback(
    (anchor: AnnotationAnchor, note: string) => {
      const trimmed = note.trim();
      if (!trimmed) return;
      const now = Date.now();
      mutateDoc((d) => {
        const annotation: Annotation = {
          id: newId(),
          note: trimmed,
          author: ANNOTATION_AUTHOR,
          createdAt: now,
          updatedAt: now,
          anchor,
        };
        return { ...d, annotations: [...d.annotations, annotation] };
      });
    },
    [mutateDoc, newId],
  );

  const editAnnotation = useCallback(
    (id: string, note: string) => {
      const trimmed = note.trim();
      if (!trimmed) return;
      mutateDoc((d) => ({
        ...d,
        annotations: d.annotations.map((a) =>
          a.id === id ? { ...a, note: trimmed, updatedAt: Date.now() } : a,
        ),
      }));
    },
    [mutateDoc],
  );

  const deleteAnnotation = useCallback(
    (id: string) => {
      mutateDoc((d) => ({ ...d, annotations: d.annotations.filter((a) => a.id !== id) }));
    },
    [mutateDoc],
  );

  const reanchorAnnotationAt = useCallback(
    (id: string, blockKey: string, blockText: string, start: number, end: number) => {
      mutateDoc((d) => ({
        ...d,
        annotations: d.annotations.map((a) =>
          a.id === id ? reanchorAnnotation(a, blockKey, blockText, start, end, Date.now()) : a,
        ),
      }));
    },
    [mutateDoc],
  );

  /** 一键载入演示批注：覆盖移动跟随、冲突脱离、删除待重挂等场景。 */
  const seedDemoAnnotations = useCallback(() => {
    const anchors = buildDemoAnchors(merge);
    if (anchors.length === 0) return;
    const now = Date.now();
    mutateDoc((d) => {
      const seeded: Annotation[] = anchors.map((spec, i) => ({
        id: newId(),
        note: spec.note,
        author: ANNOTATION_AUTHOR,
        createdAt: now + i,
        updatedAt: now + i,
        anchor: spec.anchor,
      }));
      // 去重：同一指纹已有批注时不重复播种
      const seen = new Set(d.annotations.map((a) => `${a.anchor.blockKey}::${a.anchor.exact}`));
      const fresh = seeded.filter((s) => !seen.has(`${s.anchor.blockKey}::${s.anchor.exact}`));
      return { ...d, annotations: [...d.annotations, ...fresh] };
    });
  }, [merge, mutateDoc, newId]);

  const undo = useCallback(() => setHistory((h) => histUndo(h) ?? h), []);
  const redo = useCallback(() => setHistory((h) => histRedo(h) ?? h), []);

  const resetSample = useCallback(() => {
    setBaseText(SAMPLE_BASE);
    setBrandText(SAMPLE_BRAND);
    setLegalText(SAMPLE_LEGAL);
    setHistory((h) => {
      const empty: DocState = { resolutions: {}, annotations: [] };
      const same =
        Object.keys(h.present.resolutions).length === 0 && h.present.annotations.length === 0;
      return same ? h : pushHistory(h, empty);
    });
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
    resolutions: history.present.resolutions,
    annotations: history.present.annotations,
    attachments,
    addAnnotation,
    editAnnotation,
    deleteAnnotation,
    reanchorAnnotationAt,
    seedDemoAnnotations,
    resolve,
    unresolve,
    undo,
    redo,
    canUndo: histCanUndo(history),
    canRedo: histCanRedo(history),
    resetSample,
  };
}

export type { AnnotationAttachment };
