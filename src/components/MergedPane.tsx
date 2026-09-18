import { useMemo } from 'react';
import type { Choice, MergeResult, Resolutions } from '../lib/merge';
import { diffTokens } from '../lib/diff';
import { AnnotatedText, type TextAnnotation } from './AnnotatedText';
import { ConflictCard } from './ConflictCard';
import { ProvenanceBadge, sideLabels, SIDE_LABEL } from './Badges';
import type { TrackedComment } from '../lib/comment';

interface MergedPaneProps {
  merge: MergeResult;
  baseParagraphs: string[];
  resolutions: Resolutions;
  highlightBaseIdx: number | null;
  activeConflictId: string | null;
  tracked: TrackedComment[];
  activeCommentId: string | null;
  reattachingId: string | null;
  onResolve: (id: string, choice: Choice, manualText?: string) => void;
  onUnresolve: (id: string) => void;
  onHighlight: (baseIdx: number | null) => void;
  onCommentMarkClick: (id: string) => void;
}

/** 合并结果栏：自动合并的段落 + 待处理冲突卡片，正文带批注标记且可划选留言。 */
export function MergedPane({
  merge,
  baseParagraphs,
  resolutions,
  highlightBaseIdx,
  activeConflictId,
  tracked,
  activeCommentId,
  reattachingId,
  onResolve,
  onUnresolve,
  onHighlight,
  onCommentMarkClick,
}: MergedPaneProps) {
  const conflictById = useMemo(() => new Map(merge.conflicts.map((c) => [c.id, c])), [merge.conflicts]);

  // blockId -> 该块上已挂接的批注区间
  const marksByBlock = useMemo(() => {
    const map = new Map<string, TextAnnotation[]>();
    for (const tc of tracked) {
      if (tc.status === 'attached' && tc.blockId && tc.annotation) {
        const arr = map.get(tc.blockId) ?? [];
        arr.push({
          id: tc.record.id,
          startTok: tc.annotation.startTok,
          endTok: tc.annotation.endTok,
          active: tc.record.id === activeCommentId,
        });
        map.set(tc.blockId, arr);
      }
    }
    return map;
  }, [tracked, activeCommentId]);

  return (
    <section className="pane pane-merged">
      <div className="pane-header">
        <h2>合并结果</h2>
        <span className="pane-count">{merge.stats.total} 段</span>
        {merge.stats.pending > 0 && (
          <span className="badge badge-pending">
            <i>⚠</i>
            {merge.stats.pending} 个待解决
          </span>
        )}
        {reattachingId && <span className="badge badge-moved cm-header-hint">批注重挂中：划选新文字</span>}
        <span className="cm-select-hint">划选正文即可添加批注</span>
      </div>
      <div className="pane-body" id="merged-pane-body">
        {merge.blocks.map((block) => {
          if (block.conflictId) {
            const conflict = conflictById.get(block.conflictId);
            if (!conflict) return null;
            const conflictMarks = block.status === 'removed' ? [] : marksByBlock.get(block.id) ?? [];
            return (
              <ConflictCard
                key={block.id}
                conflict={conflict}
                block={block}
                resolution={resolutions[block.conflictId]}
                active={activeConflictId === block.conflictId}
                highlighted={highlightBaseIdx === block.baseIdx}
                annotations={conflictMarks}
                onCommentMarkClick={onCommentMarkClick}
                onResolve={onResolve}
                onUnresolve={onUnresolve}
              />
            );
          }
          if (block.status === 'removed') {
            return (
              <div key={block.id} className="para-card is-removed" data-base-idx={block.baseIdx ?? undefined}>
                <div className="card-meta">
                  <span className="chip">底稿 第{(block.baseIdx ?? 0) + 1}段</span>
                  <span className="badge badge-deleted">
                    <i>✕</i>已按{block.removedBy ? SIDE_LABEL[block.removedBy] : ''}方意见删除
                  </span>
                </div>
                <p className="card-text struck">{block.text}</p>
              </div>
            );
          }
          const showDiff =
            block.baseIdx !== null && block.changedBy.length > 0 && block.insertedBy.length === 0;
          const classes = ['para-card', 'merged-card'];
          if (block.moved) classes.push('is-moved');
          if (block.insertedBy.length > 0) classes.push('is-inserted');
          else if (block.changedBy.length > 0) classes.push('is-modified');
          if (highlightBaseIdx !== null && highlightBaseIdx === block.baseIdx) classes.push('highlighted');
          if (marksByBlock.has(block.id)) classes.push('has-comment');
          if (activeCommentId && marksByBlock.get(block.id)?.some((m) => m.id === activeCommentId)) {
            classes.push('cm-block-active');
          }
          const marks = marksByBlock.get(block.id) ?? [];
          return (
            <div
              key={block.id}
              id={`merged-block-${block.id}`}
              className={classes.join(' ')}
              data-base-idx={block.baseIdx ?? undefined}
              data-comment-scope={block.id}
              onClick={() => block.baseIdx !== null && onHighlight(block.baseIdx)}
              title={block.baseIdx !== null ? '点击在两侧原稿中定位此段；划选文字可添加批注' : '划选文字可添加批注'}
            >
              <div className="card-meta">
                {block.baseIdx !== null ? (
                  <span className="chip">底稿 第{block.baseIdx + 1}段</span>
                ) : (
                  <span className="chip chip-new">新段落</span>
                )}
                <ProvenanceBadge provenance={block.provenance} />
                {block.changedBy.length > 0 && block.baseIdx !== null && (
                  <span className="badge badge-modified">
                    <i>✎</i>
                    {sideLabels(block.changedBy)}修改
                  </span>
                )}
                {block.moved && (
                  <span className="badge badge-moved">
                    <i>⇄</i>
                    {sideLabels(block.moved.by)}移动：第{block.moved.fromBaseIdx + 1}段 → 此处
                  </span>
                )}
                {block.insertedBy.length > 0 && (
                  <span className="badge badge-inserted">
                    <i>＋</i>
                    {sideLabels(block.insertedBy)}新增
                  </span>
                )}
                {marks.length > 0 && (
                  <span className="badge cm-badge-count">
                    <i>◆</i>
                    {marks.length} 条批注
                  </span>
                )}
              </div>
              <p className="card-text cm-selectable">
                {showDiff ? (
                  <AnnotatedText
                    parts={diffTokens(baseParagraphs[block.baseIdx!], block.text)}
                    annotations={marks}
                    onAnnotationClick={onCommentMarkClick}
                  />
                ) : (
                  <AnnotatedText text={block.text} annotations={marks} onAnnotationClick={onCommentMarkClick} />
                )}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
