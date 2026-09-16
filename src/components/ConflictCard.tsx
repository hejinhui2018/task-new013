import { useState } from 'react';
import type { Conflict, MergedBlock, Resolution, Side } from '../lib/merge';
import { diffTokens } from '../lib/diff';
import { DiffText } from './DiffText';
import { CHOICE_LABEL, CONFLICT_TYPE_LABEL } from './ConflictSidebar';
import { SIDE_FULL_LABEL } from './Badges';

interface ConflictCardProps {
  conflict: Conflict;
  block: MergedBlock;
  resolution: Resolution | undefined;
  active: boolean;
  highlighted: boolean;
  onResolve: (id: string, choice: 'brand' | 'legal' | 'base' | 'manual', manualText?: string) => void;
  onUnresolve: (id: string) => void;
}

function anchorLabel(anchor: number): string {
  return anchor === -1 ? '移至文首' : `移至第${anchor + 1}段后`;
}

function SideOption({
  side,
  conflict,
  onChoose,
}: {
  side: Side;
  conflict: Conflict;
  onChoose: () => void;
}) {
  const text = side === 'brand' ? conflict.brandText : conflict.legalText;
  const anchor = side === 'brand' ? conflict.brandAnchor : conflict.legalAnchor;
  const label = SIDE_FULL_LABEL[side];
  return (
    <div className={`option option-${side}`}>
      <div className="option-head">
        <span className="option-label">{label}</span>
        {anchor !== null && (
          <span className="badge badge-moved">
            <i>⇄</i>
            {anchorLabel(anchor)}
          </span>
        )}
        {text === null && (
          <span className="badge badge-deleted">
            <i>✕</i>此侧删除了该段
          </span>
        )}
      </div>
      {text === null ? (
        <p className="option-text option-deleted">
          <del>{conflict.baseText}</del>
        </p>
      ) : (
        <p className="option-text">
          <DiffText parts={diffTokens(conflict.baseText, text)} />
        </p>
      )}
      <button className={`btn btn-${side}`} onClick={onChoose}>
        采用{label}
        {text === null ? '（删除此段）' : ''}
      </button>
    </div>
  );
}

/** 冲突卡片：并列展示各方版本与底稿的词级差异，支持四种裁决方式。 */
export function ConflictCard({
  conflict: c,
  block,
  resolution,
  active,
  highlighted,
  onResolve,
  onUnresolve,
}: ConflictCardProps) {
  const [manual, setManual] = useState('');
  const resolved = resolution !== undefined;

  const chosenText = resolved
    ? resolution.choice === 'brand'
      ? c.brandText
      : resolution.choice === 'legal'
        ? c.legalText
        : resolution.choice === 'base'
          ? c.baseText
          : (resolution.manualText ?? '')
    : null;

  return (
    <div
      id={`conflict-${c.id}`}
      className={`conflict-card ${resolved ? 'is-resolved' : 'is-pending'} ${active ? 'is-active' : ''} ${
        highlighted ? 'highlighted' : ''
      }`}
      data-base-idx={c.baseIdx}
    >
      <div className="conflict-header">
        <span className="conflict-status-icon" aria-hidden>
          {resolved ? '✓' : '⚠'}
        </span>
        <span className="conflict-title">
          底稿 第{c.baseIdx + 1}段 · {CONFLICT_TYPE_LABEL[c.type]}
        </span>
        <span className={`badge ${resolved ? 'badge-resolved' : 'badge-pending'}`}>
          {resolved ? `已解决 · ${CHOICE_LABEL[resolution.choice]}` : '待解决'}
        </span>
      </div>

      {!resolved ? (
        <div className="conflict-body">
          <div className="option-grid">
            <SideOption side="brand" conflict={c} onChoose={() => onResolve(c.id, 'brand')} />
            <SideOption side="legal" conflict={c} onChoose={() => onResolve(c.id, 'legal')} />
            <div className="option option-base">
              <div className="option-head">
                <span className="option-label">底稿原文</span>
              </div>
              <p className="option-text">{c.baseText}</p>
              <button className="btn" onClick={() => onResolve(c.id, 'base')}>
                保留底稿
              </button>
            </div>
          </div>
          <div className="manual-row">
            <textarea
              placeholder="都不满意？在此手动填写该段的最终文本…"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              rows={3}
              aria-label="手动填写合并结果"
            />
            <button
              className="btn"
              disabled={manual.trim() === ''}
              onClick={() => {
                onResolve(c.id, 'manual', manual.trim());
                setManual('');
              }}
            >
              使用手动文本
            </button>
          </div>
        </div>
      ) : (
        <div className="conflict-body">
          {chosenText === null ? (
            <p className="resolved-note">
              <span className="badge badge-deleted">
                <i>✕</i>该段已按{SIDE_FULL_LABEL[resolution.choice as Side] ?? ''}意见删除
              </span>
            </p>
          ) : (
            <p className="card-text">
              {resolution.choice === 'base' ? (
                c.baseText
              ) : (
                <DiffText parts={diffTokens(c.baseText, chosenText ?? '')} />
              )}
            </p>
          )}
          {block.moved && (
            <div className="card-meta">
              <span className="badge badge-moved">
                <i>⇄</i>第{block.moved.fromBaseIdx + 1}段 → {anchorLabel(block.moved.anchorBaseIdx)}
              </span>
            </div>
          )}
          <div className="resolved-actions">
            <button className="btn" onClick={() => onUnresolve(c.id)}>
              重新打开
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
