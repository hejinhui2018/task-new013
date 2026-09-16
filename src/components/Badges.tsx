import type { Provenance, Side } from '../lib/merge';

export const SIDE_LABEL: Record<Side, string> = {
  brand: '品牌',
  legal: '法务',
};

export const SIDE_FULL_LABEL: Record<Side, string> = {
  brand: '品牌版',
  legal: '法务版',
};

export function sideLabels(sides: Side[]): string {
  return sides.map((s) => SIDE_LABEL[s]).join('+');
}

const PROVENANCE_LABEL: Record<Provenance, string> = {
  base: '底稿原文',
  brand: '品牌版',
  legal: '法务版',
  both: '双方一致',
  manual: '手动填写',
};

/** 段落来源徽章：合并结果中每段都标明出处。 */
export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  return (
    <span className={`badge badge-prov-${provenance}`}>
      <i>●</i>来源：{PROVENANCE_LABEL[provenance]}
    </span>
  );
}
