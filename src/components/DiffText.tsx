import type { DiffPart } from '../lib/diff';

/**
 * 词级差异渲染：删除的内容用删除线，新增的内容用下划线，
 * 不只依赖颜色，色弱用户也能分辨。
 */
export function DiffText({ parts }: { parts: DiffPart[] }) {
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
