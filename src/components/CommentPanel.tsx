import { useEffect, useState } from 'react';
import type { ReanchorCandidate, TrackedComment } from '../lib/comment';
import type { MergeResult } from '../lib/merge';

interface CommentPanelProps {
  tracked: TrackedComment[];
  merge: MergeResult;
  activeCommentId: string | null;
  reattachingId: string | null;
  onJump: (comment: TrackedComment) => void;
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onPickCandidate: (id: string, candidate: ReanchorCandidate) => void;
  onStartManualReattach: (id: string) => void;
  onCancelReattach: () => void;
}

const STATUS_META: Record<TrackedComment['status'], { icon: string; label: string; cls: string }> = {
  attached: { icon: '📌', label: '已挂接', cls: 'cm-status-attached' },
  orphan: { icon: '✂', label: '待重挂', cls: 'cm-status-orphan' },
  ambiguous: { icon: '?', label: '有歧义', cls: 'cm-status-ambiguous' },
  conflict: { icon: '⚠', label: '冲突待重挂', cls: 'cm-status-conflict' },
};

function candidateText(merge: MergeResult, cand: ReanchorCandidate): string {
  const block = merge.blocks.find((b) => b.id === cand.blockId);
  if (!block) return cand.annotation.text;
  const { startTok, text } = cand.annotation;
  return `${startTok > 0 ? '…' : ''}${text}…`;
}

function blockLabel(cand: ReanchorCandidate): string {
  return cand.blockBaseIdx === null ? '新段落' : `底稿第${cand.blockBaseIdx + 1}段`;
}

function CommentItem({
  tc,
  merge,
  active,
  reattaching,
  onJump,
  onEdit,
  onDelete,
  onPickCandidate,
  onStartManualReattach,
  onCancelReattach,
}: {
  tc: TrackedComment;
  merge: MergeResult;
  active: boolean;
  reattaching: boolean;
  onJump: (comment: TrackedComment) => void;
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onPickCandidate: (id: string, candidate: ReanchorCandidate) => void;
  onStartManualReattach: (id: string) => void;
  onCancelReattach: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tc.record.text);

  useEffect(() => {
    if (!editing) setDraft(tc.record.text);
  }, [editing, tc.record.text]);

  const meta = STATUS_META[tc.status];

  return (
    <li className={`cm-item ${meta.cls} ${active ? 'is-active' : ''}`} data-comment-item={tc.record.id}>
      <div className="cm-item-head">
        <span className={`cm-item-status ${meta.cls}`} title={meta.label}>
          {meta.icon}
        </span>
        <span className="cm-item-badge">{meta.label}</span>
        {tc.status === 'attached' && (
          <button className="cm-link" onClick={() => onJump(tc)} title="跳回合并稿中的原文">
            ⤳ 原文
          </button>
        )}
        <span className="cm-item-spacer" />
        <button className="cm-icon-btn" onClick={() => setEditing((v) => !v)} title="编辑批注" aria-label="编辑批注">
          ✎
        </button>
        <button className="cm-icon-btn" onClick={() => onDelete(tc.record.id)} title="删除批注" aria-label="删除批注">
          ✕
        </button>
      </div>

      {editing ? (
        <div className="cm-edit">
          <textarea
            className="cm-edit-input"
            rows={3}
            value={draft}
            aria-label="批注内容"
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="cm-edit-actions">
            <button className="btn btn-small" onClick={() => setEditing(false)}>
              取消
            </button>
            <button
              className="btn btn-small btn-primary"
              disabled={!draft.trim()}
              onClick={() => {
                onEdit(tc.record.id, draft.trim());
                setEditing(false);
              }}
            >
              保存
            </button>
          </div>
        </div>
      ) : (
        <p className="cm-item-text">{tc.record.text}</p>
      )}

      <blockquote className="cm-item-quote" title={tc.record.anchor.quote}>
        {tc.record.anchor.quote}
      </blockquote>

      {tc.status !== 'attached' && <div className="cm-item-reason">{tc.reason}</div>}

      {tc.status === 'ambiguous' && tc.candidates.length > 0 && (
        <ul className="cm-candidate-list">
          {tc.candidates.slice(0, 6).map((cand, k) => (
            <li key={`${cand.blockId}-${cand.annotation.startTok}-${k}`}>
              <button
                className="cm-candidate"
                title="把批注挂到这处文字"
                onClick={() => onPickCandidate(tc.record.id, cand)}
              >
                <span className="cm-candidate-loc">{blockLabel(cand)}</span>
                <span className="cm-candidate-text">{candidateText(merge, cand)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {tc.status !== 'attached' &&
        (reattaching ? (
          <div className="cm-reattach-hint">
            请在合并结果中选中新的文字，在浮层中确认。
            <button className="btn btn-small" onClick={onCancelReattach}>
              取消选择
            </button>
          </div>
        ) : (
          <button className="btn btn-small cm-reattach-btn" onClick={() => onStartManualReattach(tc.record.id)}>
            ✋ 手动选择新文字
          </button>
        ))}
    </li>
  );
}

/** 批注列表：查看 / 跳回原文 / 编辑 / 删除，以及待重挂批注的候选与手动重挂。 */
export function CommentPanel({
  tracked,
  merge,
  activeCommentId,
  reattachingId,
  onJump,
  onEdit,
  onDelete,
  onPickCandidate,
  onStartManualReattach,
  onCancelReattach,
}: CommentPanelProps) {
  const problems = tracked.filter((t) => t.status !== 'attached');
  const attached = tracked.filter((t) => t.status === 'attached');

  return (
    <aside className="comment-panel">
      <div className="sidebar-title">
        批注（{tracked.length}）
        {problems.length > 0 && <span className="cm-problem-count">{problems.length} 条待处理</span>}
      </div>
      {tracked.length === 0 && (
        <div className="sidebar-note">在合并结果中选中一段文字即可添加批注。</div>
      )}
      {reattachingId && (
        <div className="cm-reattach-banner">
          手动重挂模式：请在右侧合并结果中选中目标文字
          <button className="btn btn-small" onClick={onCancelReattach}>
            退出
          </button>
        </div>
      )}
      <ul className="cm-list">
        {problems.map((tc) => (
          <CommentItem
            key={tc.record.id}
            tc={tc}
            merge={merge}
            active={activeCommentId === tc.record.id}
            reattaching={reattachingId === tc.record.id}
            onJump={onJump}
            onEdit={onEdit}
            onDelete={onDelete}
            onPickCandidate={onPickCandidate}
            onStartManualReattach={onStartManualReattach}
            onCancelReattach={onCancelReattach}
          />
        ))}
        {attached.map((tc) => (
          <CommentItem
            key={tc.record.id}
            tc={tc}
            merge={merge}
            active={activeCommentId === tc.record.id}
            reattaching={false}
            onJump={onJump}
            onEdit={onEdit}
            onDelete={onDelete}
            onPickCandidate={onPickCandidate}
            onStartManualReattach={onStartManualReattach}
            onCancelReattach={onCancelReattach}
          />
        ))}
      </ul>
    </aside>
  );
}
