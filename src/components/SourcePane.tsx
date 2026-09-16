import { useEffect, useMemo, useRef, useState } from 'react';
import type { Alignment, AlignPair } from '../lib/align';
import { diffTokens } from '../lib/diff';
import { DiffText } from './DiffText';

type Item =
  | { kind: 'pair'; pair: AlignPair }
  | { kind: 'insert'; verIdx: number }
  | { kind: 'ghost'; baseIdx: number };

interface SourcePaneProps {
  title: string;
  side: 'base' | 'brand' | 'legal';
  paragraphs: string[];
  baseParagraphs: string[];
  /** 底稿栏传 null（无需对齐信息） */
  alignment: Alignment | null;
  highlightBaseIdx: number | null;
  onSaveText: (text: string) => void;
}

/**
 * 原稿栏（底稿 / 品牌版 / 法务版）。
 * 修订版中：修改段显示词级差异，移动段、新增段、删除段（幽灵卡片）都有文字徽章标记。
 */
export function SourcePane({
  title,
  side,
  paragraphs,
  baseParagraphs,
  alignment,
  highlightBaseIdx,
  onSaveText,
}: SourcePaneProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // 把对齐结果整理成渲染序列：版本段落按序排列，被删除的底稿段以幽灵卡片插回原位附近
  const items = useMemo<Item[]>(() => {
    if (!alignment) return [];
    const pairByVer = new Map(alignment.pairs.map((p) => [p.verIdx, p]));
    const inPlaceBaseIdxs = alignment.pairs
      .filter((p) => !p.moved)
      .map((p) => p.baseIdx)
      .sort((a, b) => a - b);
    const ghostAfter = new Map<number, number[]>();
    const leadingGhosts: number[] = [];
    for (const d of alignment.deleted) {
      let after = -1;
      for (const idx of inPlaceBaseIdxs) {
        if (idx < d) after = idx;
        else break;
      }
      if (after === -1) leadingGhosts.push(d);
      else {
        const arr = ghostAfter.get(after) ?? [];
        arr.push(d);
        ghostAfter.set(after, arr);
      }
    }
    const out: Item[] = leadingGhosts.map((baseIdx) => ({ kind: 'ghost', baseIdx }));
    for (let j = 0; j < paragraphs.length; j++) {
      const pair = pairByVer.get(j);
      if (pair) {
        out.push({ kind: 'pair', pair });
        if (!pair.moved) {
          const ghosts = ghostAfter.get(pair.baseIdx);
          if (ghosts) for (const g of ghosts) out.push({ kind: 'ghost', baseIdx: g });
        }
      } else {
        out.push({ kind: 'insert', verIdx: j });
      }
    }
    // 兜底：锚点段落本身被移走导致未放置的幽灵卡片，追加到末尾
    const placed = new Set(out.filter((it) => it.kind === 'ghost').map((it) => it.baseIdx));
    for (const d of alignment.deleted) {
      if (!placed.has(d)) out.push({ kind: 'ghost', baseIdx: d });
    }
    return out;
  }, [alignment, paragraphs.length]);

  // 高亮联动：滚动到对应底稿段
  useEffect(() => {
    if (highlightBaseIdx === null) return;
    const el = containerRef.current?.querySelector(`[data-base-idx="${highlightBaseIdx}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightBaseIdx]);

  const startEdit = () => {
    setDraft(paragraphs.join('\n\n'));
    setEditing(true);
  };

  return (
    <section className={`pane pane-${side}`}>
      <div className="pane-header">
        <h2>{title}</h2>
        <span className="pane-count">{paragraphs.length} 段</span>
        {!editing && (
          <button className="btn btn-small" onClick={startEdit}>
            编辑
          </button>
        )}
      </div>
      <div className="pane-body" ref={containerRef}>
        {editing ? (
          <div className="pane-editor">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={18}
              aria-label={`编辑${title}`}
            />
            <div className="editor-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  onSaveText(draft);
                  setEditing(false);
                }}
              >
                保存并重算
              </button>
              <button className="btn" onClick={() => setEditing(false)}>
                取消
              </button>
            </div>
            <p className="editor-hint">段落之间用空行分隔。保存后立即重新合并；编辑原稿不进入撤销历史。</p>
          </div>
        ) : side === 'base' ? (
          paragraphs.map((t, i) => (
            <div
              key={i}
              className={`para-card ${highlightBaseIdx === i ? 'highlighted' : ''}`}
              data-base-idx={i}
            >
              <div className="card-meta">
                <span className="chip">第 {i + 1} 段</span>
              </div>
              <p className="card-text">{t}</p>
            </div>
          ))
        ) : (
          items.map((item, k) => {
            if (item.kind === 'ghost') {
              return (
                <div
                  key={`g${item.baseIdx}`}
                  className={`para-card is-ghost ${highlightBaseIdx === item.baseIdx ? 'highlighted' : ''}`}
                  data-base-idx={item.baseIdx}
                >
                  <div className="card-meta">
                    <span className="chip">底稿 第{item.baseIdx + 1}段</span>
                    <span className="badge badge-deleted">
                      <i>✕</i>已删除
                    </span>
                  </div>
                  <p className="card-text struck">{baseParagraphs[item.baseIdx]}</p>
                </div>
              );
            }
            if (item.kind === 'insert') {
              return (
                <div key={`i${item.verIdx}`} className="para-card is-inserted">
                  <div className="card-meta">
                    <span className="chip chip-new">新段落</span>
                    <span className="badge badge-inserted">
                      <i>＋</i>新增段落
                    </span>
                  </div>
                  <p className="card-text">{paragraphs[item.verIdx]}</p>
                </div>
              );
            }
            const { pair } = item;
            const text = paragraphs[pair.verIdx];
            const classes = ['para-card'];
            if (pair.modified) classes.push('is-modified');
            if (pair.moved) classes.push('is-moved');
            if (highlightBaseIdx === pair.baseIdx) classes.push('highlighted');
            return (
              <div
                key={`p${pair.baseIdx}-${k}`}
                className={classes.join(' ')}
                data-base-idx={pair.baseIdx}
              >
                <div className="card-meta">
                  <span className="chip">底稿 第{pair.baseIdx + 1}段</span>
                  {pair.modified && (
                    <span className="badge badge-modified">
                      <i>✎</i>已修改
                    </span>
                  )}
                  {pair.moved && (
                    <span className="badge badge-moved">
                      <i>⇄</i>移动至此
                    </span>
                  )}
                </div>
                <p className="card-text">
                  {pair.modified ? (
                    <DiffText parts={diffTokens(baseParagraphs[pair.baseIdx], text)} />
                  ) : (
                    text
                  )}
                </p>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
