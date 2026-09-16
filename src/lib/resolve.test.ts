import { describe, it, expect } from 'vitest';
import { buildMergedDocument, exportMergedText } from './merge';

describe('人工解决冲突', () => {
  const base = ['一', '二', '三'];
  const brand = ['一', '二品牌', '三'];
  const legal = ['一', '二法务', '三'];

  it('edit-edit：选择法务版', () => {
    const r = buildMergedDocument(base, brand, legal, { c1: { choice: 'legal' } });
    const block = r.blocks[1];
    expect(block.text).toBe('二法务');
    expect(block.status).toBe('resolved');
    expect(block.provenance).toBe('legal');
    expect(r.stats.pending).toBe(0);
    expect(r.stats.resolved).toBe(1);
  });

  it('edit-edit：选择底稿', () => {
    const r = buildMergedDocument(base, brand, legal, { c1: { choice: 'base' } });
    expect(r.blocks[1].text).toBe('二');
    expect(r.blocks[1].provenance).toBe('base');
  });

  it('edit-edit：手动填写', () => {
    const r = buildMergedDocument(base, brand, legal, {
      c1: { choice: 'manual', manualText: '二（人工定稿）' },
    });
    expect(r.blocks[1].text).toBe('二（人工定稿）');
    expect(r.blocks[1].provenance).toBe('manual');
  });

  it('delete-edit：选择删除方则该段被移除', () => {
    const b = ['一', '二', '三'];
    const br = ['一', '三']; // 品牌删除"二"
    const le = ['一', '二改', '三']; // 法务修改"二"
    const r = buildMergedDocument(b, br, le, { c1: { choice: 'brand' } });
    const block = r.blocks.find((x) => x.baseIdx === 1)!;
    expect(block.status).toBe('removed');
    expect(block.removedBy).toBe('brand');
    expect(r.stats.removedByResolution).toBe(1);
    // 导出文本中不再包含该段
    const exported = exportMergedText(r);
    expect(exported).not.toContain('二改');
    expect(exported).not.toContain('【未解决冲突');
  });

  it('delete-edit：选择修改方则保留其内容', () => {
    const b = ['一', '二', '三'];
    const br = ['一', '三'];
    const le = ['一', '二改', '三'];
    const r = buildMergedDocument(b, br, le, { c1: { choice: 'legal' } });
    expect(r.blocks.map((x) => x.text)).toEqual(['一', '二改', '三']);
    expect(r.blocks[1].status).toBe('resolved');
  });

  it('delete-move：选择移动方则段落出现在新位置', () => {
    const b = ['一', '二', '三', '四'];
    const br = ['一', '三', '二', '四']; // 品牌移动"二"
    const le = ['一', '三', '四']; // 法务删除"二"
    const r = buildMergedDocument(b, br, le, { c1: { choice: 'brand' } });
    expect(r.blocks.map((x) => x.text)).toEqual(['一', '三', '二', '四']);
    const block = r.blocks[2];
    expect(block.status).toBe('resolved');
    expect(block.moved!.by).toEqual(['brand']);
  });

  it('move-move：选择品牌方则按品牌位置落位', () => {
    const b = ['一', '二', '三', '四', '五'];
    const br = ['一', '三', '四', '五', '二']; // 移到末尾
    const le = ['一', '三', '二', '四', '五']; // 移到"三"后
    const r = buildMergedDocument(b, br, le, { c1: { choice: 'brand' } });
    expect(r.blocks.map((x) => x.text)).toEqual(['一', '三', '四', '五', '二']);
    expect(r.blocks[4].moved!.anchorBaseIdx).toBe(4);
  });

  it('move-move：选择法务方则按法务位置落位', () => {
    const b = ['一', '二', '三', '四', '五'];
    const br = ['一', '三', '四', '五', '二'];
    const le = ['一', '三', '二', '四', '五'];
    const r = buildMergedDocument(b, br, le, { c1: { choice: 'legal' } });
    expect(r.blocks.map((x) => x.text)).toEqual(['一', '三', '二', '四', '五']);
  });

  it('重新打开（移除裁决）后回到待解决状态', () => {
    const resolved = buildMergedDocument(base, brand, legal, { c1: { choice: 'legal' } });
    expect(resolved.stats.resolved).toBe(1);
    const reopened = buildMergedDocument(base, brand, legal, {});
    expect(reopened.stats.pending).toBe(1);
    expect(reopened.blocks[1].status).toBe('pending');
    expect(reopened.blocks[1].text).toBe('二');
  });

  it('未解决冲突在导出文本中带标记', () => {
    const r = buildMergedDocument(base, brand, legal, {});
    const exported = exportMergedText(r);
    expect(exported).toContain('【未解决冲突 · 底稿第2段');
    expect(exported).toContain('二'); // 暂保留底稿原文
  });
});
