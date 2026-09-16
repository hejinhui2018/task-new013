import { describe, it, expect } from 'vitest';
import { buildMergedDocument } from './lib/merge';
import { splitParagraphs } from './lib/text';
import { SAMPLE_BASE, SAMPLE_BRAND, SAMPLE_LEGAL } from './sample';

/**
 * 端到端校验内置示例：联合发布稿应同时覆盖
 * 互不冲突修改、同段冲突、删除与编辑冲突、插入、段落移动。
 */
describe('内置示例稿件', () => {
  const base = splitParagraphs(SAMPLE_BASE);
  const brand = splitParagraphs(SAMPLE_BRAND);
  const legal = splitParagraphs(SAMPLE_LEGAL);
  const r = buildMergedDocument(base, brand, legal, {});

  it('产生且仅产生预期的两类冲突', () => {
    expect(r.conflicts.map((c) => c.type).sort()).toEqual(['delete-edit', 'edit-edit']);
    expect(r.stats.pending).toBe(2);
  });

  it('互不冲突的修改被自动合并', () => {
    const texts = r.blocks.map((b) => b.text);
    // 法务改的导语
    expect(texts.some((t) => t.includes('在满足适用法律法规的前提下'))).toBe(true);
    // 品牌改的合作内容
    expect(texts.some((t) => t.includes('一站式智能服务'))).toBe(true);
    // 法务改的公司简介
    expect(texts.some((t) => t.includes('约九万企业客户'))).toBe(true);
  });

  it('移动 + 修改的段落同时保留新位置和新内容', () => {
    const moved = r.blocks.find((b) => b.moved !== null);
    expect(moved).toBeDefined();
    // 内容采用法务修订版
    expect(moved!.text).toContain('数据截至2026年6月');
    expect(moved!.provenance).toBe('legal');
    expect(moved!.moved!.by).toEqual(['brand']);
    // 位置在导语（底稿第 2 段，下标 1）之后
    const idx = r.blocks.indexOf(moved!);
    expect(r.blocks[idx - 1].baseIdx).toBe(1);
    expect(r.stats.moved).toBe(1);
    // 没有被误判成删除或新增
    expect(r.stats.autoDeleted).toBe(0);
  });

  it('双方的新增段落都被保留', () => {
    expect(r.stats.inserted).toBe(2);
    const texts = r.blocks.map((b) => b.text);
    expect(texts.some((t) => t.includes('成长伙伴计划'))).toBe(true);
    expect(texts.some((t) => t.includes('不构成任何证券发行'))).toBe(true);
  });

  it('删除与编辑冲突指向免责声明段', () => {
    const c = r.conflicts.find((x) => x.type === 'delete-edit')!;
    expect(c.brandText).toBeNull();
    expect(c.legalText).toContain('前瞻性陈述');
    expect(c.baseText).toContain('前瞻性陈述');
  });

  it('同段冲突指向行长引言段', () => {
    const c = r.conflicts.find((x) => x.type === 'edit-edit')!;
    expect(c.brandText).toContain('重要里程碑');
    expect(c.legalText).toContain('依法合规');
  });

  it('合并结果段落总数正确', () => {
    // 底稿 10 段 + 双方各 1 段新增，无删除
    expect(r.stats.total).toBe(12);
  });
});
