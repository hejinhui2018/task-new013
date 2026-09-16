import { useMemo } from 'react';
import type { Choice, MergeResult, Resolutions } from '../lib/merge';
import { diffTokens } from '../lib/diff';
import { DiffText } from './DiffText';
import { ConflictCard } from './ConflictCard';
import { ProvenanceBadge, sideLabels, SIDE_LABEL } from './Badges';

interface MergedPaneProps {
  merge: MergeResult;
  baseParagraphs: string[];
  resolutions: Resolutions;
  highlightBaseIdx: number | null;
  activeConflictId: string | null;
  onResolve: (id: string, choice: Choice, manualText?: string) => void;
  onUnresolve: (id: string) => void;
  onHighlight: (baseIdx: number | null) => void;
}

/** 合并结果栏：自动合并的段落 + 待处理冲突卡片。 */
export function MergedPane({
  merge,
  baseParagraphs,
  resolutions,
  highlightBaseIdx,
  activeConflictId,
  onResolve,
  onUnresolve,
  onHighlight,
}: MergedPaneProps) {
  const conflictById = useMemo(() => new Map(merge.conflicts.map((c) => [c.id, c])), [merge.conflicts]);

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
      </div>
      <div className="pane-body">
        {merge.blocks.map((block) => {
          if (block.conflictId) {
            const conflict = conflictById.get(block.conflictId);
            if (!conflict) return null;
            return (
              <ConflictCard
                key={block.id}
                conflict={conflict}
                block={block}
                resolution={resolutions[block.conflictId]}
                active={activeConflictId === block.conflictId}
                highlighted={highlightBaseIdx === block.baseIdx}
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
          return (
            <div
              key={block.id}
              className={classes.join(' ')}
              data-base-idx={block.baseIdx ?? undefined}
              onClick={() => block.baseIdx !== null && onHighlight(block.baseIdx)}
              title={block.baseIdx !== null ? '点击在两侧原稿中定位此段' : undefined}
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
              </div>
              <p className="card-text">
                {showDiff ? (
                  <DiffText parts={diffTokens(baseParagraphs[block.baseIdx!], block.text)} />
                ) : (
                  block.text
                )}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
