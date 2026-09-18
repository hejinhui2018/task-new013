import { Fragment, type ReactNode } from 'react';
import type { DiffPart } from '../lib/diff';
import { contentTokenSpans } from '../lib/text';

/**
 * 批注正文渲染。
 *
 * 没有批注时保持与原来完全一致的 DOM（纯文本或 DiffText 的 ins/del 片段），
 * 不拆词元；段落上存在批注时，最终文本（差异视图中的 same/add 片段）才按
 * "内容词元"逐个包成 [data-ctok] 元素，供批注高亮与选区反查。del 片段不
 * 计入词元下标（它们不属于最终文本）。
 */

export interface TextAnnotation {
  id: string;
  startTok: number;
  endTok: number;
  active?: boolean;
}

interface AnnotatedTextProps {
  text?: string;
  parts?: DiffPart[];
  annotations: TextAnnotation[];
  onAnnotationClick?: (id: string) => void;
}

function coverMaps(annotations: TextAnnotation[]) {
  const cover = new Map<number, string[]>();
  let activeId: string | null = null;
  for (const a of annotations) {
    for (let i = a.startTok; i <= a.endTok; i++) {
      const arr = cover.get(i) ?? [];
      arr.push(a.id);
      cover.set(i, arr);
    }
    if (a.active) activeId = a.id;
  }
  return { cover, activeId };
}

function tokenClass(ids: string[], activeId: string | null): string {
  const classes = ['cm-token'];
  classes.push('cm-mark');
  classes.push(ids.includes(activeId ?? '') ? 'cm-mark-active' : ids.length > 1 ? 'cm-mark-overlap' : 'cm-mark-single');
  return classes.join(' ');
}

/** 把一段最终文本按词元下标切开，仅给被批注覆盖的词元加包装。 */
function renderTokenized(
  piece: string,
  keyBase: string,
  counter: { n: number },
  cover: Map<number, string[]>,
  activeId: string | null,
  onAnnotationClick?: (id: string) => void,
): ReactNode[] {
  const spans = contentTokenSpans(piece);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((s, k) => {
    if (s.start > cursor) nodes.push(piece.slice(cursor, s.start));
    const idx = counter.n++;
    const ids = cover.get(idx) ?? [];
    if (ids.length === 0) {
      nodes.push(<Fragment key={`${keyBase}-${k}`}>{piece.slice(s.start, s.end)}</Fragment>);
    } else {
      nodes.push(
        <span
          key={`${keyBase}-${k}`}
          className={tokenClass(ids, activeId)}
          data-ctok={idx}
          data-cids={ids.join(' ')}
          onClick={(e) => {
            e.stopPropagation();
            onAnnotationClick?.(ids[0]);
          }}
        >
          {piece.slice(s.start, s.end)}
        </span>,
      );
    }
    cursor = s.end;
  });
  if (cursor < piece.length) nodes.push(piece.slice(cursor));
  return nodes;
}

export function AnnotatedText({ text, parts, annotations, onAnnotationClick }: AnnotatedTextProps) {
  // 无批注：保持原有 DOM，避免把正文拆成大量元素
  if (annotations.length === 0) {
    if (!parts) return <>{text}</>;
    return (
      <span className="diff-text">
        {parts.map((p, i) =>
          p.type === 'same' ? (
            <span key={i}>{p.text}</span>
          ) : p.type === 'add' ? (
            <ins key={i} title="新增内容">
              {p.text}
            </ins>
          ) : (
            <del key={i} title="删除内容">
              {p.text}
            </del>
          ),
        )}
      </span>
    );
  }

  const { cover, activeId } = coverMaps(annotations);

  if (parts) {
    const counter = { n: 0 };
    return (
      <span className="diff-text annotated-text">
        {parts.map((p, i) => {
          if (p.type === 'del') {
            return (
              <del key={i} title="删除内容">
                {p.text}
              </del>
            );
          }
          const nodes = renderTokenized(p.text, `p${i}`, counter, cover, activeId, onAnnotationClick);
          return p.type === 'add' ? (
            <ins key={i} title="新增内容">
              {nodes}
            </ins>
          ) : (
            <span key={i}>{nodes}</span>
          );
        })}
      </span>
    );
  }

  return (
    <span className="annotated-text">
      {renderTokenized(text ?? '', 't', { n: 0 }, cover, activeId, onAnnotationClick)}
    </span>
  );
}
