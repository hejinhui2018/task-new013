import { describe, it, expect } from 'vitest';
import { buildMergedDocument } from './merge';

describe('三方合并：基本规则', () => {
  it('双方都未修改时保留底稿', () => {
    const r = buildMergedDocument(['甲', '乙'], ['甲', '乙'], ['甲', '乙'], {});
    expect(r.blocks.map((b) => b.text)).toEqual(['甲', '乙']);
    expect(r.blocks.every((b) => b.provenance === 'base')).toBe(true);
    expect(r.conflicts).toHaveLength(0);
    expect(r.stats.unchanged).toBe(2);
  });

  it('只有品牌修改时自动采用品牌版', () => {
    const r = buildMergedDocument(['甲', '乙', '丙'], ['甲', '乙改', '丙'], ['甲', '乙', '丙'], {});
    expect(r.blocks.map((b) => b.text)).toEqual(['甲', '乙改', '丙']);
    expect(r.blocks[1].provenance).toBe('brand');
    expect(r.blocks[1].changedBy).toEqual(['brand']);
    expect(r.conflicts).toHaveLength(0);
  });

  it('只有法务修改时自动采用法务版', () => {
    const r = buildMergedDocument(['甲', '乙', '丙'], ['甲', '乙', '丙'], ['甲', '乙改', '丙'], {});
    expect(r.blocks.map((b) => b.text)).toEqual(['甲', '乙改', '丙']);
    expect(r.blocks[1].provenance).toBe('legal');
    expect(r.conflicts).toHaveLength(0);
  });

  it('双方改成相同内容时不算冲突', () => {
    const r = buildMergedDocument(['甲', '乙'], ['甲', '乙改'], ['甲', '乙改'], {});
    expect(r.blocks.map((b) => b.text)).toEqual(['甲', '乙改']);
    expect(r.blocks[1].provenance).toBe('both');
    expect(r.conflicts).toHaveLength(0);
  });

  it('双方各自修改不同段落时全部自动合并', () => {
    const r = buildMergedDocument(
      ['一', '二', '三'],
      ['一改', '二', '三'],
      ['一', '二', '三改'],
      {},
    );
    expect(r.blocks.map((b) => b.text)).toEqual(['一改', '二', '三改']);
    expect(r.conflicts).toHaveLength(0);
    expect(r.stats.autoChanged).toBe(2);
  });

  it('一方删除、另一方未动时自动删除', () => {
    const r = buildMergedDocument(['甲', '乙', '丙'], ['甲', '丙'], ['甲', '乙', '丙'], {});
    expect(r.blocks.map((b) => b.text)).toEqual(['甲', '丙']);
    expect(r.conflicts).toHaveLength(0);
    expect(r.stats.autoDeleted).toBe(1);
  });

  it('双方都删除时自动删除', () => {
    const r = buildMergedDocument(['甲', '乙', '丙'], ['甲', '丙'], ['甲', '丙'], {});
    expect(r.blocks.map((b) => b.text)).toEqual(['甲', '丙']);
    expect(r.stats.autoDeleted).toBe(1);
  });
});

describe('三方合并：插入', () => {
  it('单方插入的段落自动合并到正确位置', () => {
    const r = buildMergedDocument(['甲', '乙', '丙'], ['甲', '新段', '乙', '丙'], ['甲', '乙', '丙'], {});
    expect(r.blocks.map((b) => b.text)).toEqual(['甲', '新段', '乙', '丙']);
    const ins = r.blocks[1];
    expect(ins.insertedBy).toEqual(['brand']);
    expect(ins.provenance).toBe('brand');
    expect(ins.baseIdx).toBeNull();
    expect(r.stats.inserted).toBe(1);
  });

  it('双方在同一位置插入相同内容时去重为一段', () => {
    const r = buildMergedDocument(['甲', '乙'], ['甲', '新段', '乙'], ['甲', '新段', '乙'], {});
    expect(r.blocks.map((b) => b.text)).toEqual(['甲', '新段', '乙']);
    expect(r.blocks[1].provenance).toBe('both');
    expect(r.blocks[1].insertedBy).toEqual(['brand', 'legal']);
    expect(r.stats.inserted).toBe(1);
  });

  it('双方插入不同内容时都保留', () => {
    const r = buildMergedDocument(['甲', '乙'], ['甲', '品牌新段', '乙'], ['甲', '法务新段', '乙'], {});
    expect(r.blocks.map((b) => b.text)).toEqual(['甲', '品牌新段', '法务新段', '乙']);
    expect(r.stats.inserted).toBe(2);
    expect(r.conflicts).toHaveLength(0);
  });

  it('插入到文首', () => {
    const r = buildMergedDocument(['甲'], ['卷首语', '甲'], ['甲'], {});
    expect(r.blocks.map((b) => b.text)).toEqual(['卷首语', '甲']);
  });
});

describe('三方合并：冲突分类', () => {
  it('双方以不同方式修改同一段 → edit-edit 冲突', () => {
    const r = buildMergedDocument(['甲', '乙', '丙'], ['甲', '乙品牌改', '丙'], ['甲', '乙法务改', '丙'], {});
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].type).toBe('edit-edit');
    expect(r.conflicts[0].baseIdx).toBe(1);
    // 未解决时保留底稿原文
    const block = r.blocks.find((b) => b.conflictId === 'c1')!;
    expect(block.status).toBe('pending');
    expect(block.text).toBe('乙');
    expect(r.stats.pending).toBe(1);
  });

  it('一方删除、另一方修改 → delete-edit 冲突', () => {
    const r = buildMergedDocument(['甲', '乙', '丙'], ['甲', '丙'], ['甲', '乙改', '丙'], {});
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].type).toBe('delete-edit');
    expect(r.conflicts[0].brandText).toBeNull();
    expect(r.conflicts[0].legalText).toBe('乙改');
    // 未解决时暂保留被修改的内容
    const block = r.blocks.find((b) => b.conflictId === 'c1')!;
    expect(block.status).toBe('pending');
    expect(block.text).toBe('乙改');
  });

  it('冲突 id 与底稿段落下标稳定对应', () => {
    const r = buildMergedDocument(['甲', '乙'], ['甲改', '乙'], ['甲改改', '乙'], {});
    expect(r.conflicts[0].id).toBe('c0');
  });
});
