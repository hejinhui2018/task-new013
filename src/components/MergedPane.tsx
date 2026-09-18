import { useEffect, useMemo, useState } from 'react';
import type { Choice, MergeResult, Resolutions } from '../lib/merge';
import { diffTokens } from '../lib/diff';
import type { Annotation, AnnotationAttachment } from '../lib/annotation';
import { ConflictCard } from './ConflictCard';
import { ProvenanceBadge, sideLabels, SIDE_LABEL } from './Badges';
import { AnnotatedText, type TextMark } from './AnnotatedText';
import { AnnotatedDiffText } from './AnnotatedDiffText';
import { useTextSelection } from '../state/useTextSelection';

interface MergedPaneProps {
  merge: MergeResult;
  baseParagraphs: string[];
  resolutions: Resolutions;
  highlightBaseIdx: number | null;
  activeConflictId: string | null;
  annotations: Annotation[];
  attachments: AnnotationAttachment[];
  activeAnnotationId: string | null;
  /** 非空时选区浮条处于"为该批注手动重挂"模式 */
  reanchoringId: string | null;
  onResolve: (id: string, choice: Choice, manualText?: string) => void;
  onUnresolve: (id: string) => void;
  onHighlight: (baseIdx: number | null) => void;
  onAddAnnotation: (blockKey: string, start: number, end: number, note: string) => void;
  onConfirmReanchor: (annotationId: string, blockKey: string, start: number, end: number) => void;
  onCancelReanchor: () => void;
  onAnnotationClick: (annotationId: string) => void;
}

type ComposeTarget = { blockKey: string; start: number; end: number };

/** 合并结果栏：自动合并的段落 + 待处理冲突卡片，叠加批注挂接与选区留言。 */
export function MergedPane({
  merge,
  baseParagraphs,
  resolutions,
  highlightBaseIdx,
  activeConflictId,
  annotations,
  attachments,
  activeAnnotationId,
  reanchoringId,
  onResolve,
  onUnresolve,
  onHighlight,
  onAddAnnotation,
  onConfirmReanchor,
  onCancelReanchor,
  onAnnotationClick,
}: MergedPaneProps) {
  const conflictById = useMemo(() => new Map(merge.conflicts.map((c) => [c.id, c])), [merge.conflicts]);
  const [compose, setCompose] = useState<ComposeTarget | null>(null);
  const [draft, setDraft] = useState('');

  const { selection, clear } = useTextSelection(true);

  // 切换重挂目标或退出重挂时，收起残留的撰写框与选区
  useEffect(() => {
    setCompose(null);
    setDraft('');
  }, [reanchoringId]);

  const attachByAnn = useMemo(() => new Map(attachments.map((t) => [t.annotationId, t])), [attachments]);

  // 每块正文上的已挂接批注区间
  const marksByBlock = useMemo(() => {
    const map = new Map<string, TextMark[]>();
    for (const t of attachments) {
      if (t.status !== 'attached') continue;
      const c = t.candidates[0];
      const list = map.get(c.blockKey) ?? [];
      list.push({
        annotationId: t.annotationId,
        start: c.start,
        end: c.end,
        active: t.annotationId === activeAnnotationId,
      });
      map.set(c.blockKey, list);
    }
    return map;
  }, [attachments, activeAnnotationId]);

  // 锚点在某块上、但当前未能挂接（冲突/删除/歧义/重写）的批注
  const problemsByBlock = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const a of annotations) {
      const t = attachByAnn.get(a.id);
      if (!t || t.status === 'attached') continue;
      const list = map.get(a.anchor.blockKey) ?? [];
      list.push(a);
      map.set(a.anchor.blockKey, list);
    }
    return map;
  }, [annotations, attachByAnn]);

  const reanchoring = reanchoringId !== null;

  const closeCompose = () => {
    setCompose(null);
    setDraft('');
  };

  const submit = () => {
    if (!compose || (!reanchoring && !draft.trim())) return;
    if (reanchoringId) {
      onConfirmReanchor(reanchoringId, compose.blockKey, compose.start, compose.end);
    } else {
      onAddAnnotation(compose.blockKey, compose.start, compose.end, draft.trim());
    }
    clear();
    closeCompose();
  };

  const renderProblemChips = (blockKey: string) => {
    const list = problemsByBlock.get(blockKey);
    if (!list || list.length === 0) return null;
    return (
      <div className="ann-problem-strip">
        {list.map((a) => {
          const t = attachByAnn.get(a.id)!;
          return (
            <button
              key={a.id}
              className={`ann-chip ann-chip-${t.status}`}
              onClick={() => onAnnotationClick(a.id)}
              title={t.reason}
            >
              {t.status === 'conflict' ? '⚠' : t.status === 'ambiguous' ? '?' : '✸'} {t.status === 'conflict'
                ? '批注待冲突解决'
                : t.status === 'ambiguous'
                  ? '批注位置有歧义'
                  : '批注待重挂'}
              ：{a.note.length > 12 ? `${a.note.slice(0, 12)}…` : a.note}
            </button>
          );
        })}
      </div>
    );
  };

  const popover =
    !compose && selection ? (
      <div
        className="ann-popover"
        // 点击浮条时不改变/清空正文选区，避免 selectionchange 让浮条在 click 前消失
        onMouseDown={(e) => e.preventDefault()}
        style={
          selection.rect
            ? { position: 'fixed', top: Math.max(8, selection.rect.top - 44), left: selection.rect.left }
            : undefined
        }
      >
        {reanchoring ? (
          <button
            className="btn btn-small btn-primary"
            onClick={() => setCompose({ blockKey: selection.blockKey, start: selection.start, end: selection.end })}
          >
            ✓ 把批注重挂到所选文字
          </button>
        ) : (
          <button
            className="btn btn-small btn-primary"
            onClick={() => {
              setCompose({ blockKey: selection.blockKey, start: selection.start, end: selection.end });
              clear();
            }}
          >
            ＋ 对所选文字添加批注
          </button>
        )}
      </div>
    ) : null;

  const composeCard = compose ? (
    <div className="ann-compose ann-compose-floating" data-testid="ann-compose">
      <div className="ann-compose-title">
        {reanchoring ? '重挂批注' : '添加批注'}
        <span className="ann-compose-target">
          →{' '}
          {(() => {
            const tb = merge.blocks.find((b) => b.identityKey === compose.blockKey);
            return tb
              ? tb.baseIdx !== null
                ? `底稿第 ${tb.baseIdx + 1} 段`
                : '新增段落'
              : '所选文字';
          })()}
        </span>
        {reanchoringId && (
          <span className="ann-compose-cancel">
            <button
              className="btn btn-small"
              onClick={() => {
                closeCompose();
                onCancelReanchor();
              }}
            >
              退出重挂
            </button>
          </span>
        )}
      </div>
      <textarea
        aria-label={reanchoring ? '重挂批注留言' : '批注留言'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        placeholder={reanchoring ? '可补充说明（原批注留言保留在侧栏）…' : '写下对这段文字的意见…'}
        autoFocus
      />
      <div className="ann-compose-actions">
        <button className="btn btn-small btn-primary" disabled={!reanchoring && !draft.trim()} onClick={submit}>
          {reanchoring ? '确认重挂' : '提交批注'}
        </button>
        <button className="btn btn-small" onClick={closeCompose}>
          取消
        </button>
      </div>
    </div>
  ) : null;

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
        {reanchoring && <span className="badge badge-moved">批注重挂中：请选中新文字</span>}
      </div>
      {composeCard}
      <div className="pane-body">
        {merge.blocks.map((block) => {
          if (block.conflictId) {
            const conflict = conflictById.get(block.conflictId);
            if (!conflict) return null;
            return (
              <div key={block.id}>
                <ConflictCard
                  conflict={conflict}
                  block={block}
                  resolution={resolutions[block.conflictId]}
                  active={activeConflictId === block.conflictId}
                  highlighted={highlightBaseIdx === block.baseIdx}
                  marks={marksByBlock.get(block.identityKey) ?? []}
                  conflictAnnotations={problemsByBlock.get(block.identityKey) ?? []}
                  conflictReasonOf={(id) => attachByAnn.get(id)?.reason ?? ''}
                  activeAnnotationId={activeAnnotationId}
                  onResolve={onResolve}
                  onUnresolve={onUnresolve}
                  onAnnotationClick={onAnnotationClick}
                />
              </div>
            );
          }
          if (block.status === 'removed') {
            return (
              <div key={block.id}>
                <div className="para-card is-removed" data-base-idx={block.baseIdx ?? undefined}>
                  <div className="card-meta">
                    <span className="chip">底稿 第{(block.baseIdx ?? 0) + 1}段</span>
                    <span className="badge badge-deleted">
                      <i>✕</i>已按{block.removedBy ? SIDE_LABEL[block.removedBy] : ''}方意见删除
                    </span>
                  </div>
                  <p className="card-text struck">{block.text}</p>
                </div>
                {renderProblemChips(block.identityKey)}
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
          const marks = marksByBlock.get(block.identityKey) ?? [];
          return (
            <div key={block.id}>
              <div
                className={classes.join(' ')}
                data-base-idx={block.baseIdx ?? undefined}
                onClick={() => block.baseIdx !== null && onHighlight(block.baseIdx)}
                title={block.baseIdx !== null ? '点击在两侧原稿中定位此段；选中文字可添加批注' : '选中文字可添加批注'}
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
                    <span className="badge badge-annotation">
                      <i>▣</i>
                      {marks.length} 条批注
                    </span>
                  )}
                </div>
                <p
                  className="card-text annotation-target"
                  data-annotation-target={block.identityKey}
                  onClick={(e) => {
                    // 点击批注高亮时只触发批注跳转，不触发段落定位
                    if ((e.target as HTMLElement).closest('[data-annotation-anchor]')) e.stopPropagation();
                  }}
                >
                  {showDiff ? (
                    <AnnotatedDiffText
                      parts={diffTokens(baseParagraphs[block.baseIdx!], block.text)}
                      finalText={block.text}
                      marks={marks}
                      onMarkClick={onAnnotationClick}
                    />
                  ) : (
                    <AnnotatedText text={block.text} marks={marks} onMarkClick={onAnnotationClick} />
                  )}
                </p>
              </div>
              {renderProblemChips(block.identityKey)}
            </div>
          );
        })}
      </div>
      {popover}
    </section>
  );
}
