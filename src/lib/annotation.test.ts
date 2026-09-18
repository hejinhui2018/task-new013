import { describe, it, expect } from 'vitest';
import { buildMergedDocument, type MergeResult, type Resolutions } from './merge';
import {
  attachAnnotations,
  locateQuote,
  makeAnchorAt,
  reanchorAnnotation,
  type Annotation,
} from './annotation';

/** 构造合并结果；未指定的修订版视为与底稿完全一致。 */
function mergeDocs(
  base: string[],
  brand?: string[],
  legal?: string[],
  resolutions: Resolutions = {},
): MergeResult {
  return buildMergedDocument(base, brand ?? base, legal ?? base, resolutions);
}

const P0 = '甲方与乙方就合作事宜达成一致。';
const P1 = '甲方同意在验收后三十日内付款。';
const P2 = '乙方同意按约定时间交付系统并提供一年维保。';

function annotationAt(
  merge: MergeResult,
  blockKey: string,
  quote: string,
  note = '一条审稿意见',
): Annotation {
  const block = merge.blocks.find((b) => b.identityKey === blockKey)!;
  const idx = block.text.indexOf(quote);
  if (idx < 0) throw new Error(`测试夹具中找不到引文：${quote}`);
  return {
    id: `ann-${blockKey}-${quote.slice(0, 4)}`,
    note,
    author: '审稿人',
    createdAt: 1,
    updatedAt: 1,
    anchor: makeAnchorAt(blockKey, block.text, idx, idx + quote.length),
  };
}

describe('批注挂接：基础跟随', () => {
  const base = [P0, P1, P2];

  it('精确引文挂接在原块对应区间', () => {
    const merge = mergeDocs(base);
    const a = annotationAt(merge, 'b1', '三十日内付款');
    const [t] = attachAnnotations(merge, [a]);
    expect(t.status).toBe('attached');
    expect(t.candidates).toHaveLength(1);
    const c = t.candidates[0];
    expect(c.blockKey).toBe('b1');
    expect(c.text).toBe('三十日内付款');
    expect(c.kind).toBe('exact');
    expect(c.start).toBe(P1.indexOf('三十日内付款'));
  });

  it('段落移动后批注跟随同一段落（块身份不随位置改变）', () => {
    const baseMerge = mergeDocs(base);
    const a = annotationAt(baseMerge, 'b1', '三十日内付款');

    // 品牌把 b1 移到文首，法务不动 → 自动合并、无冲突
    const moved = mergeDocs(base, [P1, P0, P2]);
    expect(moved.stats.pending).toBe(0);
    const order = moved.blocks.map((b) => b.identityKey);
    expect(order[0]).toBe('b1'); // 位置确实变了
    const [t] = attachAnnotations(moved, [a]);
    expect(t.status).toBe('attached');
    expect(t.candidates[0].blockKey).toBe('b1');
    expect(t.candidates[0].text).toBe('三十日内付款');
  });

  it('只改一侧的小幅措辞修改，批注经模糊匹配跟随', () => {
    const baseMerge = mergeDocs(base);
    const a = annotationAt(baseMerge, 'b1', '三十日内付款');
    // 法务把"三十日"改为"四十五日"，品牌未动
    const changed = mergeDocs(base, undefined, [P0, P1.replace('三十日', '四十五日'), P2]);
    const [t] = attachAnnotations(changed, [a]);
    expect(t.status).toBe('attached');
    expect(t.candidates[0].kind).toBe('fuzzy');
    expect(t.candidates[0].score).toBeGreaterThanOrEqual(0.55);
  });

  it('新增段落身份键在重新合并后保持稳定', () => {
    const inserted = '这是品牌新增的过渡段落，内容保持不变。';
    const m1 = mergeDocs(base, [P0, inserted, P1, P2]);
    const m2 = mergeDocs(base, [P0, inserted, P1, P2]);
    const key1 = m1.blocks.find((b) => b.baseIdx === null)!.identityKey;
    const key2 = m2.blocks.find((b) => b.baseIdx === null)!.identityKey;
    expect(key1).toBe(key2);
  });

  it('新增段落因周边移动导致锚点变化时，按精确内容唯一兜底跟随', () => {
    const inserted = '这是品牌新增的过渡段落，内容保持不变。';
    // 第一次合并：新增段在文首（锚点 -1）
    const m1 = mergeDocs(base, [inserted, P0, P1, P2]);
    const insBlock1 = m1.blocks.find((b) => b.baseIdx === null)!;
    expect(insBlock1.identityKey.startsWith('ins:-1')).toBe(true);
    const a = annotationAt(m1, insBlock1.identityKey, '过渡段落');
    // 第二次合并：新增段移到 P0 之后（锚点变为 0），原身份键消失
    const m2 = mergeDocs(base, [P0, inserted, P1, P2]);
    const insBlock2 = m2.blocks.find((b) => b.baseIdx === null)!;
    expect(insBlock2.identityKey).not.toBe(insBlock1.identityKey);
    const [t] = attachAnnotations(m2, [a]);
    expect(t.status).toBe('attached');
    expect(t.candidates[0].blockKey).toBe(insBlock2.identityKey);
    expect(t.candidates[0].text).toBe('过渡段落');
  });

  it('新增段落锚点变化且存在多个相同内容段落时标歧义，不猜测', () => {
    const inserted = '完全相同的新增提示内容。';
    const m1 = mergeDocs(base, [inserted, P0, P1, P2]);
    const a = annotationAt(m1, m1.blocks.find((b) => b.baseIdx === null)!.identityKey, '新增提示');
    // 两个相同文本的新增段，且都不在原锚点（-1），原身份键消失
    const m2 = mergeDocs(base, [P0, inserted, P1, inserted, P2]);
    const keys = m2.blocks.filter((b) => b.baseIdx === null).map((b) => b.identityKey);
    expect(keys).toHaveLength(2);
    expect(keys).not.toContain(a.anchor.blockKey);
    const [t] = attachAnnotations(m2, [a]);
    expect(t.status).toBe('ambiguous');
    expect(t.candidates.length).toBe(2);
  });
});

describe('批注挂接：不猜测位置的异常状态', () => {
  const base = [P0, P1, P2];

  it('目标被双方删除 → 待重挂（detached）', () => {
    const baseMerge = mergeDocs(base);
    const a = annotationAt(baseMerge, 'b1', '三十日内付款');
    const deleted = mergeDocs(base, [P0, P2], [P0, P2]);
    expect(deleted.blocks.find((b) => b.identityKey === 'b1')).toBeUndefined();
    const [t] = attachAnnotations(deleted, [a]);
    expect(t.status).toBe('detached');
    expect(t.candidates).toHaveLength(0);
  });

  it('大幅重写（引文消失、相似度低于阈值）→ 待重挂', () => {
    const baseMerge = mergeDocs(base);
    const a = annotationAt(baseMerge, 'b1', '三十日内付款');
    // 段落仍能对齐为原地改写（共有"甲方同意在验收后"等锚点），但引文整句消失
    const rewritten = '甲方同意在验收合格后交付系统。';
    const changed = mergeDocs(base, undefined, [P0, rewritten, P2]);
    expect(changed.blocks.find((b) => b.identityKey === 'b1')).toBeDefined();
    const [t] = attachAnnotations(changed, [a]);
    expect(t.status).toBe('detached');
    expect(t.reason).toContain('大幅重写');
  });

  it('未解决 edit-edit 冲突 → conflict，不挂在底稿临时文本上', () => {
    const baseMerge = mergeDocs(base);
    const a = annotationAt(baseMerge, 'b1', '三十日内付款');
    const conflict = mergeDocs(
      base,
      [P0, '甲方要求六十日内付款。', P2],
      [P0, '甲方应在十日内提前付款。', P2],
    );
    expect(conflict.stats.pending).toBe(1);
    const [t] = attachAnnotations(conflict, [a]);
    expect(t.status).toBe('conflict');
    expect(t.candidates).toHaveLength(0);
  });

  it('冲突解决后自动重新判断：采用的一侧保留引文 → 恢复挂接', () => {
    const baseMerge = mergeDocs(base);
    const a = annotationAt(baseMerge, 'b1', '三十日内付款');
    const conflict = mergeDocs(
      base,
      [P0, '甲方同意在验收后三十日内付款，以银行转账方式支付。', P2],
      [P0, '甲方应在十日内付款。', P2],
    );
    expect(attachAnnotations(conflict, [a])[0].status).toBe('conflict');
    const resolved = mergeDocs(
      base,
      [P0, '甲方同意在验收后三十日内付款，以银行转账方式支付。', P2],
      [P0, '甲方应在十日内付款。', P2],
      { c1: { choice: 'brand' } },
    );
    const [t] = attachAnnotations(resolved, [a]);
    expect(t.status).toBe('attached');
    expect(t.candidates[0].blockKey).toBe('b1');
  });

  it('delete-edit 冲突中裁决删除 → 待重挂；裁决保留 → 重新挂接', () => {
    const baseMerge = mergeDocs(base);
    const a = annotationAt(baseMerge, 'b1', '三十日内付款');
    // 品牌删除 b1，法务改写 b1
    const conflict = mergeDocs(base, [P0, P2], [P0, P1.replace('三十日', '四十五日'), P2]);
    expect(attachAnnotations(conflict, [a])[0].status).toBe('conflict');

    const deleted = mergeDocs(base, [P0, P2], [P0, P1.replace('三十日', '四十五日'), P2], {
      c1: { choice: 'brand' },
    });
    expect(attachAnnotations(deleted, [a])[0].status).toBe('detached');

    const kept = mergeDocs(base, [P0, P2], [P0, P1.replace('三十日', '四十五日'), P2], {
      c1: { choice: 'legal' },
    });
    expect(attachAnnotations(kept, [a])[0].status).toBe('attached');
  });

  it('同段内出现多个相同候选且上下文无法区分 → ambiguous，不自动选用', () => {
    const text = '同意。同意。';
    const merge = mergeDocs([text]);
    const a: Annotation = {
      id: 'dup',
      note: 'n',
      author: 'r',
      createdAt: 1,
      updatedAt: 1,
      // 只有引文、没有可用的前后缀指纹（如早期版本留下的批注）
      anchor: { blockKey: 'b0', exact: '同意', prefix: '', suffix: '' },
    };
    const [t] = attachAnnotations(merge, [a]);
    expect(t.status).toBe('ambiguous');
    expect(t.candidates.length).toBe(2);
    expect(t.candidates.map((c) => c.start)).toEqual([0, 3]);
  });
});

describe('批注挂接：消歧与手动重挂', () => {
  it('前缀/后缀指纹可区分同段内重复引文', () => {
    const text = '甲方同意付款。乙方同意交货。';
    // 模拟选中第二个"同意"，前缀包含"乙方"
    const idx2 = text.indexOf('同意', text.indexOf('同意') + 1);
    const anchor = makeAnchorAt('b1', text, idx2, idx2 + 2);
    const merge = mergeDocs([P0, text]);
    const a: Annotation = {
      id: 'x',
      note: 'n',
      author: 'r',
      createdAt: 1,
      updatedAt: 1,
      anchor,
    };
    const [t] = attachAnnotations(merge, [a]);
    expect(t.status).toBe('attached');
    expect(t.candidates[0].start).toBe(idx2);
  });

  it('locateQuote 对空白差异做归一化匹配', () => {
    const cands = locateQuote('甲方  同意 付款', '甲方同意付款', '', '');
    expect(cands).toHaveLength(1);
    expect(cands[0].kind).toBe('normalized');
    expect(cands[0].text).toBe('甲方  同意 付款');
  });

  it('手动重挂后，批注挂在新文字上并更新指纹', () => {
    const baseMerge = mergeDocs([P0, P1, P2]);
    const a = annotationAt(baseMerge, 'b1', '三十日内付款');
    const deleted = mergeDocs([P0, P1, P2], [P0, P2], [P0, P2]);
    expect(attachAnnotations(deleted, [a])[0].status).toBe('detached');

    // 用户把它手动挂到 b2 的新文字上
    const b2 = deleted.blocks.find((b) => b.identityKey === 'b2')!;
    const idx = b2.text.indexOf('一年维保');
    const reanchored = reanchorAnnotation(a, 'b2', b2.text, idx, idx + 4, 99);
    expect(reanchored.anchor.exact).toBe('一年维保');
    expect(reanchored.updatedAt).toBe(99);
    const [t] = attachAnnotations(deleted, [reanchored]);
    expect(t.status).toBe('attached');
    expect(t.candidates[0].blockKey).toBe('b2');
  });

  it('歧义状态下用户选定候选后变为已挂接', () => {
    const text = '同意。同意。';
    const merge = mergeDocs([text]);
    const a: Annotation = {
      id: 'dup2',
      note: 'n',
      author: 'r',
      createdAt: 1,
      updatedAt: 1,
      anchor: { blockKey: 'b0', exact: '同意', prefix: '', suffix: '' },
    };
    const [amb] = attachAnnotations(merge, [a]);
    expect(amb.status).toBe('ambiguous');
    const pick = amb.candidates[1];
    const fixed = reanchorAnnotation(a, pick.blockKey, text, pick.start, pick.end, 2);
    const [t] = attachAnnotations(merge, [fixed]);
    expect(t.status).toBe('attached');
    expect(t.candidates[0].start).toBe(pick.start);
  });

  it('makeAnchorAt 对越界下标自动收敛', () => {
    const anchor = makeAnchorAt('b0', 'abcdef', -100, 100);
    expect(anchor.exact).toBe('abcdef');
    expect(anchor.prefix).toBe('');
    expect(anchor.suffix).toBe('');
  });
});
