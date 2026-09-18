import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkbench } from './state/useWorkbench';
import { exportMergedText } from './lib/merge';
import { Toolbar } from './components/Toolbar';
import { SummaryBar } from './components/SummaryBar';
import { ConflictSidebar } from './components/ConflictSidebar';
import { SourcePane } from './components/SourcePane';
import { MergedPane } from './components/MergedPane';
import { CommentPanel } from './components/CommentPanel';
import { CommentPopover } from './components/CommentPopover';
import { extractCommentSelection, type SelectionAnchor } from './lib/selectionAnchor';
import {
  anchorForQuote,
  candidateAnchor,
  createCommentRecord,
  type ReanchorCandidate,
  type TrackedComment,
} from './lib/comment';
import {
  DEMO_BASE_IDX,
  DEMO_COMMENT_ID,
  DEMO_COMMENT_TEXT,
  DEMO_CONFLICT_ID,
  DEMO_NEW_QUOTE,
  DEMO_SCENARIOS,
  DEMO_STEPS,
} from './demo';

interface PopoverState {
  selection: SelectionAnchor;
  x: number;
  y: number;
  mode: 'new' | 'reattach';
}

export default function App() {
  const wb = useWorkbench();
  const { merge } = wb;
  const [activeConflict, setActiveConflict] = useState(0);
  const [highlightBaseIdx, setHighlightBaseIdx] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [reattachingId, setReattachingId] = useState<string | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [demoStep, setDemoStep] = useState<number | null>(null);

  const conflicts = merge.conflicts;

  // 冲突数量变化（如编辑原稿后）时校正当前下标
  useEffect(() => {
    if (activeConflict >= conflicts.length) setActiveConflict(0);
  }, [conflicts.length, activeConflict]);

  const scrollToConflict = useCallback(
    (idx: number) => {
      if (conflicts.length === 0) return;
      const i = ((idx % conflicts.length) + conflicts.length) % conflicts.length;
      setActiveConflict(i);
      setHighlightBaseIdx(conflicts[i].baseIdx);
      requestAnimationFrame(() => {
        document
          .getElementById(`conflict-${conflicts[i].id}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    },
    [conflicts],
  );

  const scrollToBlock = useCallback((blockId: string) => {
    requestAnimationFrame(() => {
      (
        document.querySelector(`[data-comment-scope="${CSS.escape(blockId)}"]`) ??
        document.getElementById(`merged-block-${blockId}`)
      )?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  // Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 或 Ctrl+Y 重做（输入框内不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) wb.redo();
        else wb.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        wb.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wb.undo, wb.redo]);

  const blockById = useMemo(() => new Map(merge.blocks.map((b) => [b.id, b])), [merge.blocks]);

  const blockTextOf = useCallback(
    (blockId: string) => {
      const block = blockById.get(blockId);
      // 未解决冲突块不允许新建批注
      if (!block || block.status === 'pending' || block.status === 'removed') return null;
      return block.text;
    },
    [blockById],
  );

  // 在合并结果中划选文字 → 弹出留言浮层（重挂模式下弹重挂确认）
  useEffect(() => {
    const onMouseUp = () => {
      const sel = extractCommentSelection(window.getSelection(), blockTextOf);
      if (!sel) return;
      const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
      setPopover({
        selection: sel,
        x: rect.left || 80,
        y: (rect.top || 120) - 10,
        mode: reattachingId ? 'reattach' : 'new',
      });
    };
    const body = document.getElementById('merged-pane-body');
    body?.addEventListener('mouseup', onMouseUp);
    return () => body?.removeEventListener('mouseup', onMouseUp);
  }, [reattachingId, blockTextOf]);

  const clearBrowserSelection = () => window.getSelection()?.removeAllRanges();

  // 浮层打开后，点击浮层以外区域（浮层自身会阻止冒泡）即关闭并清除选区
  useEffect(() => {
    if (!popover) return;
    const onMouseDown = () => {
      setPopover(null);
      window.getSelection()?.removeAllRanges();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [popover]);

  // 批注被删除 / 重挂记录消失后，清理残留的活动态
  useEffect(() => {
    if (activeCommentId && !wb.comments.some((c) => c.id === activeCommentId)) {
      setActiveCommentId(null);
    }
    if (reattachingId && !wb.comments.some((c) => c.id === reattachingId)) {
      setReattachingId(null);
    }
  }, [wb.comments, activeCommentId, reattachingId]);

  const submitPopover = (text: string) => {
    if (!popover) return;
    const { selection } = popover;
    const blockBaseIdx = blockById.get(selection.blockId)?.baseIdx ?? null;
    if (popover.mode === 'reattach' && reattachingId) {
      wb.reanchor(reattachingId, {
        quote: selection.quote,
        prefix: selection.prefix,
        suffix: selection.suffix,
        blockId: selection.blockId,
        blockBaseIdx,
      });
      setActiveCommentId(reattachingId);
      setReattachingId(null);
    } else {
      const id = wb.addNewComment({
        text,
        quote: selection.quote,
        prefix: selection.prefix,
        suffix: selection.suffix,
        blockId: selection.blockId,
        blockBaseIdx,
      });
      setActiveCommentId(id);
    }
    setPopover(null);
    clearBrowserSelection();
  };

  const cancelPopover = () => {
    setPopover(null);
    clearBrowserSelection();
  };

  const jumpToComment = useCallback(
    (tc: TrackedComment) => {
      if (tc.status !== 'attached' || !tc.blockId) return;
      setActiveCommentId(tc.record.id);
      if (tc.blockBaseIdx !== null) setHighlightBaseIdx(tc.blockBaseIdx);
      scrollToBlock(tc.blockId);
    },
    [scrollToBlock],
  );

  const handleCommentMarkClick = useCallback(
    (id: string) => {
      const tc = wb.tracked.find((t) => t.record.id === id);
      if (tc) jumpToComment(tc);
    },
    [wb.tracked, jumpToComment],
  );

  const pickCandidate = useCallback(
    (id: string, cand: ReanchorCandidate) => {
      const anchor = candidateAnchor(merge.blocks, cand);
      if (!anchor) return;
      wb.reanchor(id, anchor);
      setActiveCommentId(id);
      setReattachingId(null);
    },
    [merge.blocks, wb],
  );

  /* ---------------- 90 秒演示 ---------------- */

  const startDemo = useCallback(() => {
    wb.resetSample();
    setActiveCommentId(null);
    setReattachingId(null);
    setDemoStep(0);
  }, [wb]);

  const exitDemo = useCallback(() => {
    setDemoStep(null);
    wb.resetSample();
    setActiveCommentId(null);
  }, [wb]);

  const runDemoAction = useCallback(() => {
    if (demoStep === null) return;
    switch (demoStep) {
      case 0: {
        // 添加批注（程序化构造与界面划选完全相同的锚点）
        const anchor = anchorForQuote(merge.blocks, { baseIdx: DEMO_BASE_IDX, quote: '十二万家中小企业' });
        if (anchor?.blockId) {
          wb.addCommentRecord(
            createCommentRecord({
              id: DEMO_COMMENT_ID,
              text: DEMO_COMMENT_TEXT,
              now: Date.now(),
              ...anchor,
              blockId: anchor.blockId,
            }),
          );
          setActiveCommentId(DEMO_COMMENT_ID);
        }
        break;
      }
      case 1:
        wb.setTexts(DEMO_SCENARIOS[2]);
        break;
      case 2:
        wb.setTexts(DEMO_SCENARIOS[3]);
        break;
      case 3:
        wb.resolve(DEMO_CONFLICT_ID, 'brand');
        break;
      case 4:
        // 回到未裁决状态，法务新文本经自动合并生效，原批注句消失
        wb.unresolve(DEMO_CONFLICT_ID);
        wb.setTexts(DEMO_SCENARIOS[5]);
        break;
      case 5: {
        // 模拟审稿人在新文字上划选并重挂
        const target = merge.blocks.find((b) => b.baseIdx === DEMO_BASE_IDX && b.status !== 'removed');
        const anchor = target ? anchorForQuote(merge.blocks, { blockId: target.id, quote: DEMO_NEW_QUOTE }) : null;
        if (anchor) {
          wb.reanchor(DEMO_COMMENT_ID, anchor);
          setActiveCommentId(DEMO_COMMENT_ID);
        }
        break;
      }
    }
    setDemoStep((s) => (s === null ? null : s + 1));
  }, [demoStep, merge, wb]);

  // 演示每一步后尽量把批注 / 冲突滚到可视区
  useEffect(() => {
    if (demoStep === null || demoStep === 0) return;
    const t = setTimeout(() => {
      const tc = wb.tracked.find((c) => c.record.id === DEMO_COMMENT_ID);
      if (tc?.status === 'attached' && tc.blockId) {
        scrollToBlock(tc.blockId);
      } else {
        document
          .getElementById(`conflict-${DEMO_CONFLICT_ID}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);
    return () => clearTimeout(t);
  }, [demoStep, wb.tracked, scrollToBlock]);

  const handleCopy = useCallback(async () => {
    const text = exportMergedText(merge);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [merge]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([exportMergedText(merge)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '合并稿.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [merge]);

  return (
    <div className="app">
      <Toolbar
        conflictCount={conflicts.length}
        pendingCount={merge.stats.pending}
        activeConflict={activeConflict}
        onPrevConflict={() => scrollToConflict(activeConflict - 1)}
        onNextConflict={() => scrollToConflict(activeConflict + 1)}
        canUndo={wb.canUndo}
        canRedo={wb.canRedo}
        onUndo={wb.undo}
        onRedo={wb.redo}
        onReset={wb.resetSample}
        onCopy={handleCopy}
        onDownload={handleDownload}
        copied={copied}
      />
      <SummaryBar stats={merge.stats} />
      <div className="legend-bar">
        <span>图例：</span>
        <span className="badge badge-modified">
          <i>✎</i>已修改
        </span>
        <span className="badge badge-inserted">
          <i>＋</i>新增
        </span>
        <span className="badge badge-deleted">
          <i>✕</i>已删除
        </span>
        <span className="badge badge-moved">
          <i>⇄</i>移动
        </span>
        <span className="badge cm-legend-badge">
          <i>◆</i>批注
        </span>
        <span>
          <del>删除线</del>＝删去的文字
        </span>
        <span>
          <ins>下划线</ins>＝新增的文字
        </span>
        <button className="btn btn-small cm-demo-entry" onClick={startDemo}>
          ▶ 90 秒批注演示
        </button>
        <span className="legend-tip">在合并结果中划选文字即可添加批注；点击段落可在原稿定位</span>
      </div>
      {demoStep !== null && demoStep < DEMO_STEPS.length && (
        <div className="cm-demo-banner" role="status">
          <div className="cm-demo-text">
            <strong>{DEMO_STEPS[demoStep].title}</strong>
            <span>{DEMO_STEPS[demoStep].narration}</span>
          </div>
          <div className="cm-demo-controls">
            <span className="cm-demo-progress">
              {demoStep + 1}/{DEMO_STEPS.length}
            </span>
            <button className="btn btn-small btn-primary" onClick={runDemoAction} data-testid="demo-next">
              {DEMO_STEPS[demoStep].action}
            </button>
            <button className="btn btn-small" onClick={exitDemo}>
              退出演示
            </button>
          </div>
        </div>
      )}
      {demoStep === DEMO_STEPS.length && (
        <div className="cm-demo-banner cm-demo-done" role="status">
          <div className="cm-demo-text">
            <strong>✅ 演示完成</strong>
            <span>批注已重新挂好。可试试撤销（Ctrl+Z）回看每一步，或刷新页面验证恢复。</span>
          </div>
          <div className="cm-demo-controls">
            <button className="btn btn-small btn-primary" onClick={startDemo}>
              再演一次
            </button>
            <button className="btn btn-small" onClick={exitDemo}>
              退出演示
            </button>
          </div>
        </div>
      )}
      <div className="main">
        <ConflictSidebar
          conflicts={conflicts}
          resolutions={wb.resolutions}
          activeConflict={activeConflict}
          onJump={scrollToConflict}
        />
        <CommentPanel
          tracked={wb.tracked}
          merge={merge}
          activeCommentId={activeCommentId}
          reattachingId={reattachingId}
          onJump={jumpToComment}
          onEdit={wb.editCommentText}
          onDelete={wb.removeComment}
          onPickCandidate={pickCandidate}
          onStartManualReattach={(id) => {
            setReattachingId(id);
            setActiveCommentId(id);
          }}
          onCancelReattach={() => setReattachingId(null)}
        />
        <div className="panes">
          <SourcePane
            title="共同底稿"
            side="base"
            paragraphs={wb.base}
            baseParagraphs={wb.base}
            alignment={null}
            highlightBaseIdx={highlightBaseIdx}
            onSaveText={wb.setBaseText}
          />
          <SourcePane
            title="品牌版"
            side="brand"
            paragraphs={wb.brand}
            baseParagraphs={wb.base}
            alignment={merge.alignments.brand}
            highlightBaseIdx={highlightBaseIdx}
            onSaveText={wb.setBrandText}
          />
          <SourcePane
            title="法务版"
            side="legal"
            paragraphs={wb.legal}
            baseParagraphs={wb.base}
            alignment={merge.alignments.legal}
            highlightBaseIdx={highlightBaseIdx}
            onSaveText={wb.setLegalText}
          />
          <MergedPane
            merge={merge}
            baseParagraphs={wb.base}
            resolutions={wb.resolutions}
            highlightBaseIdx={highlightBaseIdx}
            activeConflictId={conflicts[activeConflict]?.id ?? null}
            tracked={wb.tracked}
            activeCommentId={activeCommentId}
            reattachingId={reattachingId}
            onResolve={wb.resolve}
            onUnresolve={wb.unresolve}
            onHighlight={setHighlightBaseIdx}
            onCommentMarkClick={handleCommentMarkClick}
          />
        </div>
      </div>
      {popover && (
        <CommentPopover
          x={popover.x}
          y={popover.y}
          quote={popover.selection.quote}
          mode={popover.mode}
          onSubmit={submitPopover}
          onCancel={cancelPopover}
        />
      )}
    </div>
  );
}
