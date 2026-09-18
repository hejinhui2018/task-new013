import type { DiffPart } from '../lib/diff';
import type { TextMark } from './AnnotatedText';

interface AnnotatedDiffTextProps {
  parts: DiffPart[];
  /** 最终文本（parts 中 same/add 拼接后必须与之一致） */
  finalText: string;
  marks: TextMark[];
  onMarkClick?: (annotationId: string) => void;
}

function findMark(marks: TextMark[], s: number, e: number): TextMark | null {
  return marks.find((m) => s >= m.start && e <= m.end) ?? null;
}

function markClass(mark: TextMark | null): string {
  if (!mark) return '';
  return `annotation-mark${mark.active ? ' is-active' : ''}`;
}

/**
 * 在词级差异文本上叠加批注高亮：按 diff 片段（same/add/del）顺序遍历，
 * same/add 片段再按批注区间细分。批注只会包在最终文字（same/add）上，
 * 被删除的 <del> 文字不属于新文本、不能挂接批注。
 */
export function AnnotatedDiffText({ parts, finalText, marks, onMarkClick }: AnnotatedDiffTextProps) {
  const nodes: React.ReactNode[] = [];
  let pos = 0; // 当前片段起点在最终文本中的下标
  let key = 0;

  for (const p of parts) {
    if (p.type === 'del') {
      nodes.push(
        <del key={key++} title="删除内容">
          {p.text}
        </del>,
      );
      continue;
    }
    const start = pos;
    const end = pos + p.text.length;
    // 与批注区间求交，切出若干子片段
    const cuts = new Set<number>([start, end]);
    for (const m of marks) {
      if (m.start > start && m.start < end) cuts.add(m.start);
      if (m.end > start && m.end < end) cuts.add(m.end);
    }
    const pts = [...cuts].sort((a, b) => a - b);
    for (let k = 0; k < pts.length - 1; k++) {
      const s = pts[k];
      const e = pts[k + 1];
      if (e <= s) continue;
      const mark = findMark(marks, s, e);
      const cls = markClass(mark);
      const clickProps =
        mark && onMarkClick ? ({ onClick: () => onMarkClick(mark.annotationId) } as const) : {};
      const content = finalText.slice(s, e);
      nodes.push(
        p.type === 'add' ? (
          <ins key={key++} className={cls} data-annotation-anchor={mark?.annotationId} {...clickProps}>
            {content}
          </ins>
        ) : (
          <span key={key++} className={cls} data-annotation-anchor={mark?.annotationId} {...clickProps}>
            {content}
          </span>
        ),
      );
    }
    pos = end;
  }

  return <span className="diff-text">{nodes}</span>;
}
