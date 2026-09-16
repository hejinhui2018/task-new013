import { alignVersion, type Alignment } from './align';
import { normalizeText } from './text';

/**
 * 三方段落合并引擎。
 *
 * 对底稿的每个段落分别做"存在性 / 位置 / 内容"三个维度的裁决：
 * - 只有一方修改（或双方改得一样）→ 自动采用；
 * - 双方都改了同一段且结果不同 → edit-edit 冲突；
 * - 一方删除、另一方修改 → delete-edit 冲突；一方删除、另一方移动 → delete-move 冲突；
 * - 双方把同一段移到不同位置 → move-move 冲突；
 * - 一方移动、另一方只改内容 → 自动合并：保留新位置，同时采用新内容（不会误判成删除+新增）。
 */

export type Side = 'brand' | 'legal';

export type ConflictType = 'edit-edit' | 'delete-edit' | 'delete-move' | 'move-move';

export type Choice = 'brand' | 'legal' | 'base' | 'manual';

export interface Resolution {
  choice: Choice;
  manualText?: string;
}

/** 冲突 id -> 人工裁决结果 */
export type Resolutions = Record<string, Resolution>;

export interface Conflict {
  id: string;
  type: ConflictType;
  baseIdx: number;
  baseText: string;
  /** 该侧段落文本；null 表示该侧删除了此段 */
  brandText: string | null;
  legalText: string | null;
  /** 该侧若移动了此段，记录移动锚点（位于底稿第 anchor 段之后，-1 为文首） */
  brandAnchor: number | null;
  legalAnchor: number | null;
}

export type Provenance = 'base' | 'brand' | 'legal' | 'both' | 'manual';

export interface MoveInfo {
  by: Side[];
  fromBaseIdx: number;
  anchorBaseIdx: number;
}

export interface MergedBlock {
  id: string;
  /** 来源底稿段落下标；新增段落为 null */
  baseIdx: number | null;
  /** 应用裁决后的最终文本（未解决冲突为默认文本） */
  text: string;
  status: 'auto' | 'pending' | 'resolved' | 'removed';
  provenance: Provenance;
  /** 内容相对底稿被哪些方修改过 */
  changedBy: Side[];
  moved: MoveInfo | null;
  conflictId: string | null;
  resolution?: Resolution;
  /** 因裁决而被删除时，记录采用哪一侧的删除意见 */
  removedBy?: Side;
  insertedBy: Side[];
  /** 各版本中的段落下标，用于界面交叉定位 */
  sourceIdx: { brand: number | null; legal: number | null };
}

export interface MergeStats {
  total: number;
  unchanged: number;
  autoChanged: number;
  inserted: number;
  autoDeleted: number;
  removedByResolution: number;
  moved: number;
  pending: number;
  resolved: number;
}

export interface MergeResult {
  blocks: MergedBlock[];
  conflicts: Conflict[];
  stats: MergeStats;
  alignments: { brand: Alignment; legal: Alignment };
}

interface SideState {
  present: boolean;
  verIdx: number | null;
  text: string | null;
  moved: boolean;
  modified: boolean;
  /** 移动锚点（仅 moved 时有效，-1 表示移到文首） */
  anchor: number | null;
}

function statesFor(align: Alignment, ver: string[], baseLen: number): SideState[] {
  const byBase = new Map(align.pairs.map((p) => [p.baseIdx, p]));
  const out: SideState[] = [];
  for (let i = 0; i < baseLen; i++) {
    const p = byBase.get(i);
    if (p) {
      out.push({
        present: true,
        verIdx: p.verIdx,
        text: ver[p.verIdx],
        moved: p.moved,
        modified: p.modified,
        anchor: p.moved ? align.anchorOf.get(p.verIdx) ?? -1 : null,
      });
    } else {
      out.push({ present: false, verIdx: null, text: null, moved: false, modified: false, anchor: null });
    }
  }
  return out;
}

interface Item {
  /** 排序槽位：原地段落 = 底稿下标；移动/新增段落 = 锚点下标 + 0.5 */
  slot: number;
  order: number;
  block: MergedBlock;
}

/** 内容三方裁决：两方一致用一致值，否则看哪方没动。 */
function autoContent(baseText: string, brandText: string, legalText: string): string {
  const nb = normalizeText(baseText);
  const nbr = normalizeText(brandText);
  const nl = normalizeText(legalText);
  if (nbr === nl) return brandText;
  if (nbr === nb) return legalText;
  if (nl === nb) return brandText;
  return baseText;
}

function buildConflictItem(
  conflict: Conflict,
  auto: { slot: number; anchor: number | null },
  movedBy: Side[],
  resolution: Resolution | undefined,
  states: { b: SideState; l: SideState },
): Item {
  const c = conflict;
  const i = c.baseIdx;
  const moverSide: Side | null =
    c.type === 'delete-move' ? (states.b.present && states.b.moved ? 'brand' : 'legal') : null;
  const moverAnchor = moverSide === 'brand' ? c.brandAnchor : moverSide === 'legal' ? c.legalAnchor : null;

  let text: string;
  let slot: number;
  let status: MergedBlock['status'];
  let provenance: Provenance;
  let removedBy: Side | undefined;
  let moved: MoveInfo | null = null;

  if (!resolution) {
    status = 'pending';
    provenance = 'base';
    switch (c.type) {
      case 'edit-edit':
        // 位置无争议（可能已被一方移动），内容暂保留底稿原文
        text = c.baseText;
        slot = auto.slot;
        if (movedBy.length > 0 && auto.anchor !== null) {
          moved = { by: movedBy, fromBaseIdx: i, anchorBaseIdx: auto.anchor };
        }
        break;
      case 'move-move':
        // 位置有争议，暂放回原位；内容能自动合并则自动合并
        text = autoContent(c.baseText, c.brandText ?? c.baseText, c.legalText ?? c.baseText);
        slot = i;
        break;
      case 'delete-edit':
        // 暂保留被修改后的内容，等待人工确认
        text = (c.brandText ?? c.legalText)!;
        slot = i;
        break;
      case 'delete-move':
        // 暂按移动方放在新位置，等待人工确认
        text = (c.brandText ?? c.legalText)!;
        slot = (moverAnchor ?? i) + 0.5;
        moved = { by: [moverSide!], fromBaseIdx: i, anchorBaseIdx: moverAnchor ?? i };
        break;
    }
  } else {
    switch (resolution.choice) {
      case 'brand':
      case 'legal': {
        const side = resolution.choice;
        const sideText = side === 'brand' ? c.brandText : c.legalText;
        const sideAnchor = side === 'brand' ? c.brandAnchor : c.legalAnchor;
        provenance = side;
        if (sideText === null) {
          // 该侧的意见是删除此段
          status = 'removed';
          removedBy = side;
          text = c.baseText;
          slot = i;
        } else {
          status = 'resolved';
          text = sideText;
          if (c.type === 'move-move' || c.type === 'delete-move') {
            // 位置争议随所选一侧落定
            slot = sideAnchor !== null ? sideAnchor + 0.5 : i;
            if (sideAnchor !== null) moved = { by: [side], fromBaseIdx: i, anchorBaseIdx: sideAnchor };
          } else {
            slot = auto.slot;
            if (movedBy.length > 0 && auto.anchor !== null) {
              moved = { by: movedBy, fromBaseIdx: i, anchorBaseIdx: auto.anchor };
            }
          }
        }
        break;
      }
      case 'base':
        status = 'resolved';
        provenance = 'base';
        text = c.baseText;
        slot = i;
        break;
      case 'manual':
        status = 'resolved';
        provenance = 'manual';
        text = resolution.manualText ?? '';
        slot = i;
        break;
    }
  }

  const changedBy: Side[] = [];
  if (states.b.modified) changedBy.push('brand');
  if (states.l.modified) changedBy.push('legal');

  return {
    slot,
    order: i,
    block: {
      id: `b${i}`,
      baseIdx: i,
      text,
      status,
      provenance,
      changedBy,
      moved,
      conflictId: c.id,
      resolution,
      removedBy,
      insertedBy: [],
      sourceIdx: { brand: states.b.verIdx, legal: states.l.verIdx },
    },
  };
}

export function buildMergedDocument(
  base: string[],
  brand: string[],
  legal: string[],
  resolutions: Resolutions,
): MergeResult {
  const alignBrand = alignVersion(base, brand);
  const alignLegal = alignVersion(base, legal);
  const sb = statesFor(alignBrand, brand, base.length);
  const sl = statesFor(alignLegal, legal, base.length);

  const conflicts: Conflict[] = [];
  const items: Item[] = [];
  let autoDeleted = 0;

  for (let i = 0; i < base.length; i++) {
    const b = sb[i];
    const l = sl[i];
    const baseText = base[i];

    // 双方都删除
    if (!b.present && !l.present) {
      autoDeleted++;
      continue;
    }

    // 移动目标集合（锚点，-1 表示文首）
    const moveTargets = new Set<number>();
    if (b.present && b.moved && b.anchor !== null) moveTargets.add(b.anchor);
    if (l.present && l.moved && l.anchor !== null) moveTargets.add(l.anchor);
    const autoAnchor = moveTargets.size === 1 ? [...moveTargets][0] : null;
    const auto = { slot: autoAnchor !== null ? autoAnchor + 0.5 : i, anchor: autoAnchor };
    const movedBy: Side[] = [];
    if (b.moved) movedBy.push('brand');
    if (l.moved) movedBy.push('legal');

    // 只有一方删除
    if (!b.present || !l.present) {
      const other = b.present ? b : l;
      if (other.modified || other.moved) {
        // 另一方动了它（改内容或挪位置）→ 冲突
        const type: ConflictType = other.moved ? 'delete-move' : 'delete-edit';
        const conflict: Conflict = {
          id: `c${i}`,
          type,
          baseIdx: i,
          baseText,
          brandText: b.text,
          legalText: l.text,
          brandAnchor: b.moved ? b.anchor : null,
          legalAnchor: l.moved ? l.anchor : null,
        };
        conflicts.push(conflict);
        items.push(buildConflictItem(conflict, auto, movedBy, resolutions[conflict.id], { b, l }));
      } else {
        // 另一方没动 → 自动删除
        autoDeleted++;
      }
      continue;
    }

    const contentConflict =
      b.modified && l.modified && normalizeText(b.text!) !== normalizeText(l.text!);
    const positionConflict = moveTargets.size > 1;

    if (positionConflict || contentConflict) {
      const conflict: Conflict = {
        id: `c${i}`,
        type: positionConflict ? 'move-move' : 'edit-edit',
        baseIdx: i,
        baseText,
        brandText: b.text,
        legalText: l.text,
        brandAnchor: b.moved ? b.anchor : null,
        legalAnchor: l.moved ? l.anchor : null,
      };
      conflicts.push(conflict);
      items.push(buildConflictItem(conflict, auto, movedBy, resolutions[conflict.id], { b, l }));
      continue;
    }

    // 自动合并：内容取改动方（或双方一致值），位置取唯一移动目标
    const changedBy: Side[] = [];
    if (b.modified) changedBy.push('brand');
    if (l.modified) changedBy.push('legal');
    const text = b.modified ? b.text! : l.modified ? l.text! : baseText;
    items.push({
      slot: auto.slot,
      order: i,
      block: {
        id: `b${i}`,
        baseIdx: i,
        text,
        status: 'auto',
        provenance: changedBy.length === 0 ? 'base' : changedBy.length === 2 ? 'both' : changedBy[0],
        changedBy,
        moved:
          movedBy.length > 0 && autoAnchor !== null
            ? { by: movedBy, fromBaseIdx: i, anchorBaseIdx: autoAnchor }
            : null,
        conflictId: null,
        insertedBy: [],
        sourceIdx: { brand: b.verIdx, legal: l.verIdx },
      },
    });
  }

  // 新增段落：双方在同锚点插入相同内容时去重为一段
  interface InsAgg {
    anchor: number;
    text: string;
    sides: Side[];
    verIdxs: { brand: number | null; legal: number | null };
  }
  const insMap = new Map<string, InsAgg>();
  const collectInsertions = (align: Alignment, ver: string[], side: Side) => {
    for (const ins of align.inserted) {
      const text = ver[ins.verIdx];
      const key = `${ins.anchor}::${normalizeText(text)}`;
      const existing = insMap.get(key);
      if (existing) {
        existing.sides.push(side);
        existing.verIdxs[side] = ins.verIdx;
      } else {
        const verIdxs: { brand: number | null; legal: number | null } = { brand: null, legal: null };
        verIdxs[side] = ins.verIdx;
        insMap.set(key, { anchor: ins.anchor, text, sides: [side], verIdxs });
      }
    }
  };
  collectInsertions(alignBrand, brand, 'brand');
  collectInsertions(alignLegal, legal, 'legal');
  let insCounter = 0;
  for (const ins of insMap.values()) {
    items.push({
      slot: ins.anchor + 0.5,
      order: 10000 + insCounter,
      block: {
        id: `ins${insCounter}`,
        baseIdx: null,
        text: ins.text,
        status: 'auto',
        provenance: ins.sides.length === 2 ? 'both' : ins.sides[0],
        changedBy: [...ins.sides],
        moved: null,
        conflictId: null,
        insertedBy: [...ins.sides],
        sourceIdx: { brand: ins.verIdxs.brand, legal: ins.verIdxs.legal },
      },
    });
    insCounter++;
  }

  items.sort((x, y) => x.slot - y.slot || x.order - y.order);
  const blocks = items.map((it) => it.block);
  conflicts.sort((x, y) => x.baseIdx - y.baseIdx);

  const stats: MergeStats = {
    total: blocks.filter((b) => b.status !== 'removed').length,
    unchanged: blocks.filter(
      (b) => b.status === 'auto' && b.changedBy.length === 0 && b.moved === null && b.insertedBy.length === 0,
    ).length,
    autoChanged: blocks.filter(
      (b) => b.status === 'auto' && b.insertedBy.length === 0 && (b.changedBy.length > 0 || b.moved !== null),
    ).length,
    inserted: blocks.filter((b) => b.insertedBy.length > 0).length,
    autoDeleted,
    removedByResolution: blocks.filter((b) => b.status === 'removed').length,
    moved: blocks.filter((b) => b.moved !== null && b.status !== 'removed').length,
    pending: conflicts.filter((c) => !resolutions[c.id]).length,
    resolved: conflicts.filter((c) => resolutions[c.id]).length,
  };

  return {
    blocks,
    conflicts,
    stats,
    alignments: { brand: alignBrand, legal: alignLegal },
  };
}

/** 导出合并稿纯文本；未解决冲突以标记行保留底稿原文。 */
export function exportMergedText(merge: MergeResult): string {
  return merge.blocks
    .filter((b) => b.status !== 'removed')
    .map((b) =>
      b.status === 'pending'
        ? `【未解决冲突 · 底稿第${(b.baseIdx ?? 0) + 1}段，暂保留底稿原文】\n${b.text}`
        : b.text,
    )
    .join('\n\n');
}
