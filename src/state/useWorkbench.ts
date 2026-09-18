import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  addComment,
  createCommentRecord,
  deleteComment,
  editComment,
  migrateComments,
  reanchorComment,
  trackComments,
  type CommentAnchor,
  type CommentRecord,
} from '../lib/comment';

const LS_KEY = 'pr-merge-workbench:v1';

/** 裁决与批注共享同一条撤销/重做时间线，任何一类操作都能逐步回退。 */
interface WorkbenchState {
  resolutions: Resolutions;
  comments: CommentRecord[];
}

interface Persisted {
  baseText: string;
  brandText: string;
  legalText: string;
  resolutions: Resolutions;
  /** 旧版浏览器数据没有该字段，按空批注集合处理，原稿照常打开 */
  comments?: CommentRecord[];
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

export interface NewCommentInput {
  text: string;
  quote: string;
  prefix: string;
  suffix: string;
  blockId: string;
  blockBaseIdx: number | null;
}

/**
 * 工作台状态：三份文稿 + 冲突裁决 + 批注（后两者带统一撤销/重做），
 * 全部持久化到 localStorage。合并结果与批注跟踪位置均为纯函数派生，
 * 任何状态变化都会自动重算。
 */
export function useWorkbench() {
  const [persisted] = useState(loadPersisted);
  const [baseText, setBaseText] = useState(persisted?.baseText ?? SAMPLE_BASE);
  const [brandText, setBrandText] = useState(persisted?.brandText ?? SAMPLE_BRAND);
  const [legalText, setLegalText] = useState(persisted?.legalText ?? SAMPLE_LEGAL);
  const [history, setHistory] = useState<History<WorkbenchState>>(() =>
    createHistory({
      resolutions: persisted?.resolutions ?? {},
      comments: migrateComments(persisted?.comments),
    }),
  );
  const commentSeq = useRef(0);

  useEffect(() => {
    try {
      const payload: Persisted = {
        baseText,
        brandText,
        legalText,
        resolutions: history.present.resolutions,
        comments: history.present.comments,
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
  const tracked = useMemo(
    () => trackComments(history.present.comments, merge),
    [history.present.comments, merge],
  );

  const nextCommentId = useCallback(() => {
    commentSeq.current += 1;
    return `cm${Date.now().toString(36)}-${commentSeq.current}`;
  }, []);

  const resolve = useCallback((id: string, choice: Choice, manualText?: string) => {
    setHistory((h) =>
      pushHistory(h, {
        ...h.present,
        resolutions: {
          ...h.present.resolutions,
          [id]: choice === 'manual' ? { choice, manualText: manualText ?? '' } : { choice },
        },
      }),
    );
  }, []);

  const unresolve = useCallback((id: string) => {
    setHistory((h) => {
      if (!(id in h.present.resolutions)) return h;
      const resolutions = { ...h.present.resolutions };
      delete resolutions[id];
      return pushHistory(h, { ...h.present, resolutions });
    });
  }, []);

  const addNewComment = useCallback(
    (input: NewCommentInput) => {
      const rec = createCommentRecord({ ...input, id: nextCommentId(), now: Date.now() });
      setHistory((h) => pushHistory(h, { ...h.present, comments: addComment(h.present.comments, rec) }));
      return rec.id;
    },
    [nextCommentId],
  );

  /** 供演示 / 测试以固定 id 写入批注。 */
  const addCommentRecord = useCallback((rec: CommentRecord) => {
    setHistory((h) => pushHistory(h, { ...h.present, comments: addComment(h.present.comments, rec) }));
  }, []);

  const editCommentText = useCallback((id: string, text: string) => {
    setHistory((h) =>
      pushHistory(h, { ...h.present, comments: editComment(h.present.comments, id, text, Date.now()) }),
    );
  }, []);

  const removeComment = useCallback((id: string) => {
    setHistory((h) =>
      pushHistory(h, { ...h.present, comments: deleteComment(h.present.comments, id) }),
    );
  }, []);

  const reanchor = useCallback((id: string, anchor: CommentAnchor) => {
    setHistory((h) =>
      pushHistory(h, {
        ...h.present,
        comments: reanchorComment(h.present.comments, id, anchor, Date.now()),
      }),
    );
  }, []);

  const undo = useCallback(() => setHistory((h) => histUndo(h) ?? h), []);
  const redo = useCallback(() => setHistory((h) => histRedo(h) ?? h), []);

  const resetSample = useCallback(() => {
    setBaseText(SAMPLE_BASE);
    setBrandText(SAMPLE_BRAND);
    setLegalText(SAMPLE_LEGAL);
    setHistory((h) => {
      const pristine: WorkbenchState = { resolutions: {}, comments: [] };
      const cur = h.present;
      if (Object.keys(cur.resolutions).length === 0 && cur.comments.length === 0) return h;
      return pushHistory(h, pristine);
    });
  }, []);

  /** 演示用：一次性替换三份文稿（不进入撤销历史，与编辑原稿一致）。 */
  const setTexts = useCallback((texts: { baseText?: string; brandText?: string; legalText?: string }) => {
    if (texts.baseText !== undefined) setBaseText(texts.baseText);
    if (texts.brandText !== undefined) setBrandText(texts.brandText);
    if (texts.legalText !== undefined) setLegalText(texts.legalText);
  }, []);

  return {
    baseText,
    brandText,
    legalText,
    setBaseText,
    setBrandText,
    setLegalText,
    setTexts,
    base,
    brand,
    legal,
    merge,
    tracked,
    comments: history.present.comments,
    resolutions: history.present.resolutions,
    resolve,
    unresolve,
    addNewComment,
    addCommentRecord,
    editCommentText,
    removeComment,
    reanchor,
    undo,
    redo,
    canUndo: histCanUndo(history),
    canRedo: histCanRedo(history),
    resetSample,
  };
}

export type Workbench = ReturnType<typeof useWorkbench>;
