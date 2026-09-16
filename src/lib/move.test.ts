import { describe, it, expect } from 'vitest';
import { buildMergedDocument } from './merge';

describe('移动识别', () => {
  it('单方移动段落：按新位置合并，不误判为删除+新增', () => {
    const base = ['一', '二', '三', '四'];
    const brand = ['一', '三', '二', '四']; // 把"二"移到"三"之后
    const legal = ['一', '二', '三', '四'];
    const r = buildMergedDocument(base, brand, legal, {});
    expect(r.blocks.map((b) => b.text)).toEqual(['一', '三', '二', '四']);
    expect(r.conflicts).toHaveLength(0);
    expect(r.stats.autoDeleted).toBe(0);
    expect(r.stats.inserted).toBe(0);
    expect(r.stats.moved).toBe(1);
    const moved = r.blocks[2];
    expect(moved.moved).not.toBeNull();
    expect(moved.moved!.by).toEqual(['brand']);
    expect(moved.moved!.fromBaseIdx).toBe(1);
    expect(moved.moved!.anchorBaseIdx).toBe(2);
  });

  it('一方移动 + 另一方修改内容：同时保留新位置和新内容', () => {
    const base = ['一', '二', '三', '四'];
    const brand = ['一', '三', '二', '四']; // 移动"二"
    const legal = ['一', '二改', '三', '四']; // 修改"二"
    const r = buildMergedDocument(base, brand, legal, {});
    expect(r.blocks.map((b) => b.text)).toEqual(['一', '三', '二改', '四']);
    expect(r.conflicts).toHaveLength(0);
    const moved = r.blocks[2];
    expect(moved.text).toBe('二改');
    expect(moved.provenance).toBe('legal');
    expect(moved.moved!.by).toEqual(['brand']);
    expect(moved.moved!.fromBaseIdx).toBe(1);
  });

  it('一方移动并改写：自动采用移动后的位置与改写内容', () => {
    const base = ['一', '二', '三', '四'];
    const brand = ['一', '三', '二改', '四']; // 移动 + 改写
    const legal = ['一', '二', '三', '四'];
    const r = buildMergedDocument(base, brand, legal, {});
    expect(r.blocks.map((b) => b.text)).toEqual(['一', '三', '二改', '四']);
    expect(r.conflicts).toHaveLength(0);
    expect(r.blocks[2].changedBy).toEqual(['brand']);
    expect(r.blocks[2].moved!.by).toEqual(['brand']);
  });

  it('双方移动到同一位置：自动合并', () => {
    const base = ['一', '二', '三', '四'];
    const brand = ['一', '三', '二', '四'];
    const legal = ['一', '三', '二', '四'];
    const r = buildMergedDocument(base, brand, legal, {});
    expect(r.blocks.map((b) => b.text)).toEqual(['一', '三', '二', '四']);
    expect(r.conflicts).toHaveLength(0);
    expect(r.blocks[2].moved!.by).toEqual(['brand', 'legal']);
  });

  it('双方移动到不同位置 → move-move 冲突，暂放原位', () => {
    const base = ['一', '二', '三', '四', '五'];
    const brand = ['一', '三', '四', '五', '二']; // "二"移到末尾
    const legal = ['一', '三', '二', '四', '五']; // "二"移到"三"之后
    const r = buildMergedDocument(base, brand, legal, {});
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].type).toBe('move-move');
    expect(r.conflicts[0].brandAnchor).toBe(4);
    expect(r.conflicts[0].legalAnchor).toBe(2);
    const block = r.blocks.find((b) => b.conflictId === 'c1')!;
    expect(block.status).toBe('pending');
    // 暂放原位（"一"之后、"三"之前）
    expect(r.blocks.map((b) => b.text)).toEqual(['一', '二', '三', '四', '五']);
  });

  it('一方移动、另一方删除 → delete-move 冲突，暂按移动方放置', () => {
    const base = ['一', '二', '三', '四'];
    const brand = ['一', '三', '二', '四']; // 移动"二"
    const legal = ['一', '三', '四']; // 删除"二"
    const r = buildMergedDocument(base, brand, legal, {});
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].type).toBe('delete-move');
    expect(r.conflicts[0].legalText).toBeNull();
    const block = r.blocks.find((b) => b.conflictId === 'c1')!;
    expect(block.status).toBe('pending');
    expect(r.blocks.map((b) => b.text)).toEqual(['一', '三', '二', '四']);
  });

  it('移动识别不依赖段落是否完全相同：近似段落也算移动而非删除+新增', () => {
    const base = ['一', '今日双方共同宣布达成重要战略合作事项', '三', '四'];
    const brand = ['一', '三', '今日双方共同宣布达成重要战略合作事项', '四'];
    const legal = ['一', '今日双方共同宣布达成重要战略合作事项', '三', '四'];
    const r = buildMergedDocument(base, brand, legal, {});
    expect(r.stats.moved).toBe(1);
    expect(r.stats.autoDeleted).toBe(0);
    expect(r.stats.inserted).toBe(0);
  });
});
