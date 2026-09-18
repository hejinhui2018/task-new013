export interface TextMark {
  annotationId: string;
  start: number;
  end: number;
  active?: boolean;
}

interface AnnotatedTextProps {
  text: string;
  marks: TextMark[];
  /** 点击高亮片段时触发（用于从正文跳到批注条目） */
  onMarkClick?: (annotationId: string) => void;
}

interface Segment {
  text: string;
  mark: TextMark | null;
}

/** 按批注区间把文本切成不相交片段；区间重叠时后一个不切断前一个。 */
function toSegments(text: string, marks: TextMark[]): Segment[] {
  const sorted = [...marks].sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: Segment[] = [];
  let cursor = 0;
  const pushText = (s: number, e: number) => {
    if (e > s) segments.push({ text: text.slice(s, e), mark: null });
  };
  for (const m of sorted) {
    const start = Math.max(m.start, cursor);
    const end = Math.min(m.end, text.length);
    if (end <= start) continue;
    pushText(cursor, start);
    segments.push({ text: text.slice(start, end), mark: m });
    cursor = end;
  }
  pushText(cursor, text.length);
  return segments;
}

/**
 * 正文 + 批注高亮。批注只在界面层叠加，绝不改动文本本身，
 * 因此复制 / 下载导出的正文不会混入任何批注。
 */
export function AnnotatedText({ text, marks, onMarkClick }: AnnotatedTextProps) {
  const segments = toSegments(text, marks);
  return (
    <>
      {segments.map((seg, i) =>
        seg.mark ? (
          <mark
            key={i}
            className={`annotation-mark${seg.mark.active ? ' is-active' : ''}`}
            data-annotation-anchor={seg.mark.annotationId}
            onClick={onMarkClick ? () => onMarkClick(seg.mark!.annotationId!) : undefined}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
