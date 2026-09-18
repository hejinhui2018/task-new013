import { joinParagraphs, normalizeText, splitParagraphs } from './lib/text';
import { SAMPLE_BASE, SAMPLE_BRAND, SAMPLE_LEGAL } from './sample';

/**
 * 90 秒批注演示剧本（基于内置示例稿派生，不另造数据）：
 * 1. 在自动合并后的数据段上添加批注；
 * 2. 品牌把该段移到文末 —— 批注跟随到新位置；
 * 3. 双方围绕该句各自改写 —— 段落变成冲突，批注脱离（冲突中，不猜位置）；
 * 4. 采用品牌版解决冲突 —— 批注自动恢复挂接；
 * 5. 法务大幅重写该句 —— 原文消失，批注标记为待重挂；
 * 6. 手动把批注挂到新文字上。
 */

const base = splitParagraphs(SAMPLE_BASE);
const brand0 = splitParagraphs(SAMPLE_BRAND);
const legal0 = splitParagraphs(SAMPLE_LEGAL);

/** 演示批注挂在底稿第 6 段（数据段，baseIdx=5），对应冲突 id 为 c5。 */
export const DEMO_BASE_IDX = 5;
export const DEMO_CONFLICT_ID = 'c5';
export const DEMO_COMMENT_ID = 'cm-demo';
export const DEMO_COMMENT_TEXT = '请核对“十二万家”这一数据的统计口径与截止日期。';
export const DEMO_QUOTE = '十二万家中小企业';
export const DEMO_NEW_QUOTE = '注册商户数已突破十五万家';

const DATA = base[DEMO_BASE_IDX];

function replaceParagraph(arr: string[], from: string, to: string): string[] {
  return arr.map((p) => (normalizeText(p) === normalizeText(from) ? to : p));
}

/** 法务版数据段本身已有修订，按其中稳定出现的文字定位替换。 */
function replaceContaining(arr: string[], needle: string, to: string): string[] {
  return arr.map((p) => (p.includes(needle) ? to : p));
}

function moveParagraphToEnd(arr: string[], target: string): string[] {
  const rest = arr.filter((p) => normalizeText(p) !== normalizeText(target));
  const moved = arr.find((p) => normalizeText(p) === normalizeText(target));
  return moved ? [...rest, moved] : arr;
}

// 第二步：品牌把数据段移到文末（法务不动位置 → 自动合并，批注跟随）
const brand2 = moveParagraphToEnd(brand0, DATA);

// 第三步：双方在数据段上围绕批注句各自改写（保留被批注的原词，位置仍有一方移动）
const DATA_BRAND =
  '截至发布会当日，星澜科技平台已服务超过十二万家中小企业，北辰银行的企业客户规模位居全国城商行前列。';
const DATA_LEGAL =
  '目前，星澜科技平台已服务超过十二万家中小企业（数据截至2026年6月，经双方确认），北辰银行的企业客户规模位居全国城商行前列，客户满意度持续提升。';
const brand3 = replaceParagraph(brand2, DATA, DATA_BRAND);
const legal3 = replaceContaining(legal0, '十二万家中小企业', DATA_LEGAL);

// 第五步：仅法务大幅重写该句（品牌维持原样移动 → 自动采用法务新文本，原批注句消失）
const DATA_HEAVY =
  '平台注册商户数已突破十五万家，北辰银行企业客户规模位居全国城商行前列。';
const legal4 = replaceContaining(legal0, '十二万家中小企业', DATA_HEAVY);

export interface DemoScenario {
  baseText: string;
  brandText: string;
  legalText: string;
}

export const DEMO_SCENARIOS: Record<number, DemoScenario> = {
  2: { baseText: SAMPLE_BASE, brandText: joinParagraphs(brand2), legalText: SAMPLE_LEGAL },
  3: { baseText: SAMPLE_BASE, brandText: joinParagraphs(brand3), legalText: joinParagraphs(legal3) },
  5: { baseText: SAMPLE_BASE, brandText: joinParagraphs(brand2), legalText: joinParagraphs(legal4) },
};

export interface DemoStep {
  title: string;
  narration: string;
  action: string;
}

export const DEMO_STEPS: DemoStep[] = [
  {
    title: '① 添加批注',
    narration: '审稿人在合并稿里划选“十二万家中小企业”，留下核对口径的批注。',
    action: '添加批注',
  },
  {
    title: '② 段落移动，批注跟随',
    narration: '品牌把数据段整体移到文末，批注标记自动跟到新位置，没有留在旧位置。',
    action: '模拟品牌移动段落',
  },
  {
    title: '③ 落入冲突，批注脱离',
    narration: '双方围绕这句各自改写，段落进入未解决冲突；批注不猜位置，标记为“冲突中·待重挂”。',
    action: '模拟双方改写',
  },
  {
    title: '④ 冲突解决，批注恢复',
    narration: '采用品牌版解决冲突后，系统重新判断：原句仍在，批注自动挂回。',
    action: '采用品牌版解决',
  },
  {
    title: '⑤ 大幅重写，标记待重挂',
    narration: '法务把这句大幅改写，原词消失且没有近似文字，批注进入“待重挂”，绝不乱挂。',
    action: '模拟大幅重写',
  },
  {
    title: '⑥ 手动重挂',
    narration: '点击“手动选择新文字”后划选新句（或用下方按钮模拟），批注重新挂好；全程可撤销、可刷新恢复。',
    action: '模拟选中新文字并重挂',
  },
];
