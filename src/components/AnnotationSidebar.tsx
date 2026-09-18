import { useEffect, useRef, useState } from 'react';
import type { Annotation, AnnotationAttachment, AnnotationStatus } from '../lib/annotation';
import { attachmentStatusLabel } from '../lib/annotation';
import type { MergeResult } from '../lib/merge';

export interface ResolvedAnnotation {
  annotation: Annotation;
  attachment: AnnotationAttachment;
}

interface AnnotationSidebarProps {
  entries: ResolvedAnnotation[];
  merge: MergeResult;
  activeId: string | null;
  reanchoringId: string | null;
  onJump: (entry: ResolvedAnnotation) => void;
  onEdit: (id: string, note: string) => void;
  onDelete: (id: string) => void;
  onStartReanchor: (id: string) => void;
  onCancelReanchor: () => void;
  onPickCandidate: (id: string, blockKey: string, start: number, end: number) => void;
  onSeedDemo: () => void;
  onDemoMove: () => void;
}

const STATUS_ORDER: Record<AnnotationStatus, number> = {
  conflict: 0,
  detached: 1,
  ambiguous: 2,
  attached: 3,
};

function blockLabel(merge: MergeResult, blockKey: string): string {
  const b = merge.blocks.find((x) => x.identityKey === blockKey);
  if (!b) return '已不存在的段落';
  return b.baseIdx !== null ? `底稿第 ${b.baseIdx + 1} 段` : '新增段落';
}

function AnnotationItem({
  entry,
  merge,
  active,
  reanchoring,
  onJump,
  onEdit,
  onDelete,
  onStartReanchor,
  onCancelReanchor,
  onPickCandidate,
}: {
  entry: ResolvedAnnotation;
  merge: MergeResult;
  active: boolean;
  reanchoring: boolean;
} & Pick<
  AnnotationSidebarProps,
  'onJump' | 'onEdit' | 'onDelete' | 'onStartReanchor' | 'onCancelReanchor' | 'onPickCandidate'
>) {
  const { annotation: a, attachment: t } = entry;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.note);
  const wasActive = useRef(false);
  const itemRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (active && !wasActive.current) {
      itemRef.current?.scrollIntoView({ block: 'nearest' });
    }
    wasActive.current = active;
  }, [active]);

  const save = () => {
    if (draft.trim()) {
      onEdit(a.id, draft);
      setEditing(false);
    }
  };

  return (
    <li
      ref={itemRef}
      className={`ann-item ann-${t.status}${active ? ' is-active' : ''}${reanchoring ? ' is-reanchoring' : ''}`}
    >
      <div className="ann-item-head">
        <span className={`ann-status ann-status-${t.status}`}>
          {t.status === 'attached' ? '●' : t.status === 'conflict' ? '⚠' : t.status === 'ambiguous' ? '?' : '✸'}
          {attachmentStatusLabel(t.status)}
        </span>
        <span className="ann-block">{blockLabel(merge, a.anchor.blockKey)}</span>
      </div>

      {editing ? (
        <div className="ann-edit">
          <textarea
            aria-label="编辑批注内容"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            autoFocus
          />
          <div className="ann-edit-actions">
            <button className="btn btn-small btn-primary" onClick={save}>
              保存
            </button>
            <button className="btn btn-small" onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <p className="ann-note">{a.note}</p>
      )}

      <blockquote className="ann-quote" title="批注原文">
        {a.anchor.exact}
      </blockquote>

      {t.status !== 'attached' && t.reason && <p className="ann-reason">{t.reason}</p>}

      {t.status === 'ambiguous' && (
        <ul className="ann-candidates">
          {t.candidates.map((c, i) => {
            const block = merge.blocks.find((b) => b.identityKey === c.blockKey);
            return (
              <li key={`${c.blockKey}-${c.start}-${i}`}>
                <button
                  className="ann-candidate"
                  title={`挂到「${c.text}」`}
                  onClick={() => onPickCandidate(a.id, c.blockKey, c.start, c.end)}
                >
                  <span className="ann-candidate-loc">{block ? blockLabel(merge, c.blockKey) : '候选'}</span>
                  <span className="ann-candidate-text">
                    {c.kind === 'fuzzy' ? '≈ ' : ''}
                    {c.text.length > 24 ? `${c.text.slice(0, 24)}…` : c.text}
                  </span>
                  <span className="ann-candidate-go">挂到此处</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {reanchoring && (
        <p className="ann-reanchoring-hint">
          请在右侧合并结果中<b>选中要挂接的新文字</b>，在弹出的工具条上确认。
          <button className="btn btn-small" onClick={onCancelReanchor}>
            取消重挂
          </button>
        </p>
      )}

      {!editing && !reanchoring && (
        <div className="ann-actions">
          <button className="btn btn-small" onClick={() => onJump(entry)}>
            {t.status === 'attached' ? '跳回原文' : '查看位置'}
          </button>
          <button className="btn btn-small" onClick={() => { setDraft(a.note); setEditing(true); }}>
            编辑
          </button>
          {t.status !== 'attached' && (
            <button className="btn btn-small" onClick={() => onStartReanchor(a.id)}>
              手动重挂
            </button>
          )}
          <button className="btn btn-small btn-danger" onClick={() => onDelete(a.id)}>
            删除
          </button>
        </div>
      )}
    </li>
  );
}

/** 批注侧栏：集中展示每条批注的挂接状态，支持跳回原文、编辑、删除、消歧与手动重挂。 */
export function AnnotationSidebar(props: AnnotationSidebarProps) {
  const {
    entries,
    merge,
    activeId,
    reanchoringId,
    onJump,
    onEdit,
    onDelete,
    onStartReanchor,
    onCancelReanchor,
    onPickCandidate,
    onSeedDemo,
    onDemoMove,
  } = props;

  const sorted = [...entries].sort(
    (x, y) =>
      STATUS_ORDER[x.attachment.status] - STATUS_ORDER[y.attachment.status] ||
      x.annotation.createdAt - y.annotation.createdAt,
  );
  const problemCount = entries.filter((e) => e.attachment.status !== 'attached').length;

  return (
    <aside className="annotation-sidebar">
      <div className="sidebar-title">
        批注（{entries.length}）
        {problemCount > 0 && <span className="ann-problem-count">{problemCount} 条待处理</span>}
      </div>
      <div className="ann-demo-box">
        <button className="btn btn-small btn-primary" onClick={onSeedDemo}>
          ① 一键载入演示批注
        </button>
        <button className="btn btn-small" onClick={onDemoMove}>
          ② 品牌再移动一段
        </button>
        <p className="ann-demo-hint">
          选中合并结果中的文字即可留言；批注随段落移动与单侧改稿自动跟随，冲突时脱离、解决后恢复。
        </p>
      </div>
      {entries.length === 0 && <div className="sidebar-note">还没有批注。在合并结果里选中一段文字试试。</div>}
      <ul className="ann-list">
        {sorted.map((entry) => (
          <AnnotationItem
            key={entry.annotation.id}
            entry={entry}
            merge={merge}
            active={entry.annotation.id === activeId}
            reanchoring={entry.annotation.id === reanchoringId}
            onJump={onJump}
            onEdit={onEdit}
            onDelete={onDelete}
            onStartReanchor={onStartReanchor}
            onCancelReanchor={onCancelReanchor}
            onPickCandidate={onPickCandidate}
          />
        ))}
      </ul>
    </aside>
  );
}
