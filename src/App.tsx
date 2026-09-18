import { useCallback, useEffect, useState } from 'react';
import { useWorkbench } from './state/useWorkbench';
import { exportMergedText } from './lib/merge';
import { makeAnchorAt } from './lib/annotation';
import { Toolbar } from './components/Toolbar';
import { SummaryBar } from './components/SummaryBar';
import { ConflictSidebar } from './components/ConflictSidebar';
import { AnnotationSidebar, type ResolvedAnnotation } from './components/AnnotationSidebar';
import { SourcePane } from './components/SourcePane';
import { MergedPane } from './components/MergedPane';
import { DEMO_BRAND_MOVED } from './sample';

export default function App() {
  const wb = useWorkbench();
  const { merge } = wb;
  const [activeConflict, setActiveConflict] = useState(0);
  const [highlightBaseIdx, setHighlightBaseIdx] = useState<number | null>(null);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [reanchoringId, setReanchoringId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const conflicts = merge.conflicts;

  // 冲突数量变化（如编辑原稿后）时校正当前下标
  useEffect(() => {
    if (activeConflict >= conflicts.length) setActiveConflict(0);
  }, [conflicts.length, activeConflict]);

  const jumpToConflict = useCallback(
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

  const blockByKey = useCallback(
    (key: string) => merge.blocks.find((b) => b.identityKey === key) ?? null,
    [merge.blocks],
  );

  const attachmentById = new Map(wb.attachments.map((t) => [t.annotationId, t]));
  const annotationById = new Map(wb.annotations.map((a) => [a.id, a]));
  const annotationEntries: ResolvedAnnotation[] = wb.annotations.map((a) => ({
    annotation: a,
    attachment: attachmentById.get(a.id)!,
  }));

  const scrollMarkIntoView = useCallback((id: string) => {
    requestAnimationFrame(() => {
      // 批注 id 为 [a-z0-9-]，本身可直接用作属性选择器；CSS.escape 仅作兼容兜底
      const safeId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
      document
        .querySelector(`[data-annotation-anchor="${safeId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  // 从批注列表跳回原文：已挂接滚到高亮；冲突态滚到冲突卡；其余滚到所在块
  const jumpToAnnotation = useCallback(
    (entry: ResolvedAnnotation) => {
      const { annotation: a, attachment: t } = entry;
      setActiveAnnotationId(a.id);
      const block = blockByKey(a.anchor.blockKey);
      if (t.status === 'attached') {
        scrollMarkIntoView(a.id);
        if (block?.baseIdx !== null && block?.baseIdx !== undefined) setHighlightBaseIdx(block.baseIdx);
      } else if (block?.conflictId) {
        document
          .getElementById(`conflict-${block.conflictId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (block) {
        requestAnimationFrame(() => {
          const el = document.querySelector(
            `.pane-merged [data-base-idx="${block.baseIdx ?? ''}"]`,
          );
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      } else {
        scrollMarkIntoView(a.id);
      }
    },
    [blockByKey, scrollMarkIntoView],
  );

  const handleAddAnnotation = useCallback(
    (blockKey: string, start: number, end: number, note: string) => {
      const block = blockByKey(blockKey);
      if (!block) return;
      wb.addAnnotation(makeAnchorAt(blockKey, block.text, start, end), note);
    },
    [blockByKey, wb],
  );

  const handleConfirmReanchor = useCallback(
    (annotationId: string, blockKey: string, start: number, end: number) => {
      const block = blockByKey(blockKey);
      if (!block) return;
      wb.reanchorAnnotationAt(annotationId, blockKey, block.text, start, end);
      setReanchoringId(null);
      setActiveAnnotationId(annotationId);
      setTimeout(() => scrollMarkIntoView(annotationId), 0);
    },
    [blockByKey, wb, scrollMarkIntoView],
  );

  const handlePickCandidate = useCallback(
    (id: string, blockKey: string, start: number, end: number) => {
      handleConfirmReanchor(id, blockKey, start, end);
    },
    [handleConfirmReanchor],
  );

  const handleAnnotationClick = useCallback(
    (id: string) => {
      setActiveAnnotationId(id);
      const entry = annotationById.has(id)
        ? { annotation: annotationById.get(id)!, attachment: attachmentById.get(id)! }
        : null;
      if (entry) jumpToAnnotation(entry);
    },
    [annotationById, attachmentById, jumpToAnnotation],
  );

  const handleDemoMove = useCallback(() => {
    wb.setBrandText(DEMO_BRAND_MOVED);
  }, [wb]);

  return (
    <div className="app">
      <Toolbar
        conflictCount={conflicts.length}
        pendingCount={merge.stats.pending}
        activeConflict={activeConflict}
        onPrevConflict={() => jumpToConflict(activeConflict - 1)}
        onNextConflict={() => jumpToConflict(activeConflict + 1)}
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
        <span className="badge badge-annotation">
          <i>▣</i>批注
        </span>
        <span>
          <del>删除线</del>＝删去的文字
        </span>
        <span>
          <ins>下划线</ins>＝新增的文字
        </span>
        <span className="legend-tip">选中合并结果中的文字可添加批注；批注不会进入复制/下载的正文</span>
      </div>
      <div className="main">
        <ConflictSidebar
          conflicts={conflicts}
          resolutions={wb.resolutions}
          activeConflict={activeConflict}
          onJump={jumpToConflict}
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
            annotations={wb.annotations}
            attachments={wb.attachments}
            activeAnnotationId={activeAnnotationId}
            reanchoringId={reanchoringId}
            onResolve={wb.resolve}
            onUnresolve={wb.unresolve}
            onHighlight={setHighlightBaseIdx}
            onAddAnnotation={handleAddAnnotation}
            onConfirmReanchor={handleConfirmReanchor}
            onCancelReanchor={() => setReanchoringId(null)}
            onAnnotationClick={handleAnnotationClick}
          />
        </div>
        <AnnotationSidebar
          entries={annotationEntries}
          merge={merge}
          activeId={activeAnnotationId}
          reanchoringId={reanchoringId}
          onJump={jumpToAnnotation}
          onEdit={wb.editAnnotation}
          onDelete={wb.deleteAnnotation}
          onStartReanchor={(id) => {
            setReanchoringId(id);
            setActiveAnnotationId(id);
          }}
          onCancelReanchor={() => setReanchoringId(null)}
          onPickCandidate={handlePickCandidate}
          onSeedDemo={wb.seedDemoAnnotations}
          onDemoMove={handleDemoMove}
        />
      </div>
    </div>
  );
}
