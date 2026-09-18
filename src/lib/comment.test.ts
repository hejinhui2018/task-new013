import { describe, it, expect } from 'vitest';
import { buildMergedDocument, exportMergedText, type MergeResult } from './merge';
import {
  addComment,
  anchorForQuote,
  candidateAnchor,
  createCommentRecord,
  deleteComment,
  editComment,
  migrateComments,
  reanchorComment,
  trackComments,
  type CommentAnchor,
  type CommentRecord,
} from './comment';

function merge(base: string[], brand: string[], legal: string[], resolutions = {}): MergeResult {
  return buildMergedDocument(base, brand, legal, resolutions);
}

function makeRecord(m: MergeResult, quote: string, baseIdx?: number, blockId?: string, id = 'c1'): CommentRecord {
  const anchor: CommentAnchor = anchorForQuote(m.blocks, { quote, baseIdx: baseIdx ?? null, blockId })!;
  expect(anchor).not.toBeNull();
  expect(anchor.blockId).not.toBeNull();
  return createCommentRecord({ id, text: '批注内容', now: 1, ...anchor, blockId: anchor.blockId! });
}

function statusOf(m: MergeResult, rec: CommentRecord) {
  return trackComments([rec], m)[0];
}

describe('批注跟踪：挂接与跟随', () => {
  it('新建批注精确挂接到对应段落', () => {
    const m = merge(['甲段', '乙段'], ['甲段', '乙段'], ['甲段', '乙段']);
    const tc = statusOf(m, makeRecord(m, '乙段', 1));
    expect(tc.status).toBe('attached');
    expect(tc.blockId).toBe('b1');
    expect(tc.annotation?.exact).toBe(true);
  });

  it('段落被移动后批注跟随到新位置', () => {
    const m0 = merge(['首段', '乙段', '尾段'], ['首段', '乙段', '尾段'], ['首段', '乙段', '尾段']);
    const rec = makeRecord(m0, '乙段', 1);
    // 品牌把乙段移到文末，法务不动 → 自动合并为移动
    const m1 = merge(['首段', '乙段', '尾段'], ['首段', '尾段', '乙段'], ['首段', '乙段', '尾段']);
    const tc = statusOf(m1, rec);
    expect(tc.status).toBe('attached');
    expect(tc.blockId).toBe('b1');
    const block = m1.blocks.find((b) => b.id === tc.blockId)!;
    expect(block.moved).not.toBeNull();
    expect(m1.blocks[m1.blocks.length - 1].id).toBe('b1');
  });

  it('仅一侧小幅改写时批注模糊跟随，并保留原词命中区间', () => {
    const m0 = merge(
      ['开头', '今天天气很好适合出门散步'],
      ['开头', '今天天气很好适合出门散步'],
      ['开头', '今天天气很好适合出门散步'],
    );
    const rec = makeRecord(m0, '适合出门散步', 1);
    const m1 = merge(
      ['开头', '今天天气很好适合出门散步'],
      ['开头', '今天天气很好适合出门散步'],
      ['开头', '今天天气很好适合出门走走呀'],
    );
    const tc = statusOf(m1, rec);
    expect(tc.status).toBe('attached');
    expect(tc.annotation?.exact).toBe(false);
    expect(tc.annotation?.text).toContain('适合出门');
  });
});

describe('批注跟踪：不猜测位置', () => {
  it('目标段落被删除时标记为待重挂（orphan）', () => {
    const m0 = merge(['甲段', '乙段'], ['甲段', '乙段'], ['甲段', '乙段']);
    const rec = makeRecord(m0, '乙段', 1);
    const m1 = merge(['甲段', '乙段'], ['甲段'], ['甲段']);
    const tc = statusOf(m1, rec);
    expect(tc.status).toBe('orphan');
    expect(tc.blockId).toBeNull();
    expect(tc.reason).toContain('删除或大幅改写');
  });

  it('目标句被大幅重写、原词基本消失时标记为待重挂', () => {
    const m0 = merge(['甲', '乙方合同条款需要逐条核对'], ['甲', '乙方合同条款需要逐条核对'], [
      '甲',
      '乙方合同条款需要逐条核对',
    ]);
    const rec = makeRecord(m0, '乙方合同条款需要逐条核对', 1);
    const m1 = merge(
      ['甲', '乙方合同条款需要逐条核对'],
      ['甲', '乙方合同条款需要逐条核对'],
      ['甲', '这块内容全部换成了截然不同的全新表述内容'],
    );
    const tc = statusOf(m1, rec);
    expect(tc.status).toBe('orphan');
  });

  it('原块仍存在且只含一处命中时，跨段重复文字按段落身份挂回（不是猜测）', () => {
    const m0 = merge(
      ['共同前缀关键句共同后缀', '其他文字'],
      ['共同前缀关键句共同后缀', '其他文字'],
      ['共同前缀关键句共同后缀', '其他文字'],
    );
    const rec = makeRecord(m0, '共同前缀关键句', 0);
    const m1 = merge(
      ['共同前缀关键句共同后缀', '其他文字'],
      ['共同前缀关键句共同后缀', '其他文字'],
      ['共同前缀关键句共同后缀', '其他', '共同前缀关键句共同后缀'],
    );
    const tc = statusOf(m1, rec);
    expect(tc.status).toBe('attached');
    expect(tc.blockId).toBe('b0');
  });

  it('原块消失后出现多处相同文字且上下文无法区分时标记歧义并给出候选', () => {
    const m1 = merge(
      ['甲', '乙'],
      ['甲', '共同前缀关键句共同后缀', '乙'],
      ['甲', '共同前缀关键句共同后缀', '乙', '共同前缀关键句共同后缀'],
    );
    // 记录来自已不存在的块（b9），且无上下文可用于区分
    const rec: CommentRecord = {
      id: 'gone',
      text: 'x',
      createdAt: 1,
      updatedAt: 1,
      anchor: { quote: '共同前缀关键句', prefix: '', suffix: '', blockBaseIdx: null, blockId: 'b9' },
    };
    const tc = statusOf(m1, rec);
    expect(tc.status).toBe('ambiguous');
    expect(tc.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('同一段落内多处相同文字且无上下文可区分时标记歧义', () => {
    const m0 = merge(['甲乙甲乙'], ['甲乙甲乙'], ['甲乙甲乙']);
    // 旧数据 / 迁移来的记录可能没有上下文，两处"甲乙"完全无法区分
    const rec: CommentRecord = {
      id: 'dup',
      text: '指的是哪一处？',
      createdAt: 1,
      updatedAt: 1,
      anchor: { quote: '甲乙', prefix: '', suffix: '', blockBaseIdx: 0, blockId: 'b0' },
    };
    const tc = statusOf(m0, rec);
    expect(tc.status).toBe('ambiguous');
    expect(tc.candidates).toHaveLength(2);
  });

  it('上下文能区分重复文字时自动跟随到正确的一处', () => {
    const m0 = merge(['甲共同前缀关键句甲后缀'], ['甲共同前缀关键句甲后缀'], ['甲共同前缀关键句甲后缀']);
    const rec = makeRecord(m0, '关键句', 0);
    const m1 = merge(
      ['甲共同前缀关键句甲后缀'],
      ['甲共同前缀关键句甲后缀'],
      ['甲共同前缀关键句甲后缀', '乙共同前缀关键句乙后缀'],
    );
    const tc = statusOf(m1, rec);
    expect(tc.status).toBe('attached');
    expect(tc.blockId).toBe('b0');
  });
});

describe('批注跟踪：冲突联动', () => {
  const BASE = ['开头段', '乙方合同条款'];
  const BRAND_PENDING = ['开头段', '乙方合同条款品牌补充内容'];
  const LEGAL_PENDING = ['开头段', '乙方合同条款法务补充内容'];

  it('锚点落入未解决冲突时标记为冲突中，且不给出确定位置', () => {
    const m0 = merge(BASE, BASE, BASE);
    const rec = makeRecord(m0, '乙方合同条款', 1);
    const m1 = merge(BASE, BRAND_PENDING, LEGAL_PENDING);
    const tc = statusOf(m1, rec);
    expect(tc.status).toBe('conflict');
    expect(tc.blockId).toBeNull();
    expect(tc.candidates.length).toBeGreaterThan(0);
  });

  it('冲突解决后自动重新判断并恢复挂接', () => {
    const m0 = merge(BASE, BASE, BASE);
    const rec = makeRecord(m0, '乙方合同条款', 1);
    const m1 = merge(BASE, BRAND_PENDING, LEGAL_PENDING, { c1: { choice: 'brand' } });
    const tc = statusOf(m1, rec);
    expect(tc.status).toBe('attached');
    expect(tc.annotation?.text).toContain('乙方合同条款');
  });

  it('冲突以删除该段解决时转为待重挂', () => {
    const m0 = merge(BASE, BASE, BASE);
    const rec = makeRecord(m0, '乙方合同条款', 1);
    // 品牌删除、法务修改 → delete-edit 冲突；采用品牌（删除）
    const m1 = merge(BASE, ['开头段'], LEGAL_PENDING, { c1: { choice: 'brand' } });
    const block = m1.blocks.find((b) => b.conflictId === 'c1');
    expect(block?.status).toBe('removed');
    const tc = statusOf(m1, rec);
    expect(tc.status).toBe('orphan');
  });

  it('批注在另一处有确定 live 位置时，不因冲突块中也有文字而进入冲突态', () => {
    const m0 = merge(BASE, BASE, BASE);
    const rec = makeRecord(m0, '乙方合同条款', 1);
    // 法务新增一段含相同文字，原段双方改成 edit-edit 冲突
    const m1 = merge(
      BASE,
      BRAND_PENDING,
      ['开头段', '乙方合同条款法务补充内容', '附注：乙方合同条款'],
    );
    const tc = statusOf(m1, rec);
    // 新增段为唯一 live 命中 → 直接挂接，不猜冲突块
    expect(tc.status).toBe('attached');
    expect(tc.blockId).toBeDefined();
    expect(m1.blocks.find((b) => b.id === tc.blockId)?.status).not.toBe('pending');
  });
});

describe('批注记录的增删改重挂', () => {
  const m0 = merge(['甲', '乙'], ['甲', '乙'], ['甲', '乙']);
  const rec = makeRecord(m0, '乙', 1);

  it('新增 / 编辑 / 删除都是不可变更新', () => {
    let list = addComment([], rec);
    expect(list).toHaveLength(1);
    list = editComment(list, rec.id, '改后的批注', 2);
    expect(list[0].text).toBe('改后的批注');
    expect(list[0].updatedAt).toBe(2);
    expect(list[0].createdAt).toBe(1);
    list = deleteComment(list, rec.id);
    expect(list).toHaveLength(0);
  });

  it('手动重挂以新文字重建锚点，批注内容不变', () => {
    const m1 = merge(['甲', '乙', '丙'], ['甲', '乙', '丙'], ['甲', '乙', '丙']);
    const anchor = anchorForQuote(m1.blocks, { quote: '丙', baseIdx: 2 })!;
    const reanchored = reanchorComment([rec], rec.id, { ...anchor, blockId: anchor.blockId! }, 3);
    const tc = trackComments(reanchored, m1)[0];
    expect(tc.status).toBe('attached');
    expect(tc.blockId).toBe('b2');
    expect(tc.record.text).toBe('批注内容');
  });

  it('可通过候选命中一键构造新锚点', () => {
    const m1 = merge(
      ['甲', '共同前缀关键句'],
      ['甲', '共同前缀关键句'],
      ['甲', '共同前缀关键句', '共同前缀关键句'],
    );
    expect(m1.blocks.filter((b) => b.text.includes('共同前缀关键句'))).toHaveLength(2);
    const rec2: CommentRecord = {
      id: 'c2',
      text: '挂到哪',
      createdAt: 1,
      updatedAt: 1,
      // 原块 b9 已不存在，原地段与新增段各含一处相同文字且无上下文 → 歧义
      anchor: { quote: '共同前缀关键句', prefix: '', suffix: '', blockBaseIdx: null, blockId: 'b9' },
    };
    const tc = statusOf(m1, rec2);
    expect(tc.status).toBe('ambiguous');
    const anchor = candidateAnchor(m1.blocks, tc.candidates[0]);
    expect(anchor?.quote).toContain('共同前缀关键句');
    const fixed = reanchorComment([rec2], rec2.id, anchor!, 9);
    expect(trackComments(fixed, m1)[0].status).toBe('attached');
  });
});

describe('批注与导出 / 旧数据兼容', () => {
  it('批注文字绝不进入复制 / 下载的正文', () => {
    const m = merge(['甲', '乙'], ['甲', '乙'], ['甲', '乙']);
    const anchor = anchorForQuote(m.blocks, { quote: '乙', baseIdx: 1 })!;
    const rec = createCommentRecord({
      id: 'x',
      text: '仅供审稿人看的内部意见，绝不能出现在正文里',
      now: 1,
      ...anchor,
      blockId: anchor.blockId!,
    });
    const text = exportMergedText(m);
    expect(text).toContain('乙');
    expect(text).not.toContain(rec.text);
    expect(text).not.toContain('批注');
  });

  it('旧版数据（无 comments 字段、记录缺字段）可安全迁移', () => {
    expect(migrateComments(undefined)).toEqual([]);
    expect(migrateComments(null)).toEqual([]);
    expect(migrateComments('nope')).toEqual([]);
    const migrated = migrateComments([
      { id: 'a', text: '意见', anchor: { quote: '引文' } },
      { id: 'b', text: 'x', anchor: { quote: 'y', prefix: '前缀', suffix: '后缀', blockBaseIdx: 3, blockId: 'b3' } },
      null,
      { text: '缺 id' },
    ]);
    expect(migrated).toHaveLength(2);
    expect(migrated[0].anchor.prefix).toBe('');
    expect(migrated[0].anchor.blockBaseIdx).toBeNull();
    expect(migrated[1].anchor.blockId).toBe('b3');
  });
});
