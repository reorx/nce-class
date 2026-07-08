// 课堂战报 v3（Recap v3.dc.html）的纯派生逻辑，配合 components/RecapCardV3.tsx。
// 数据来自 recap.groups[].members / recap.ungrouped（服务端 buildRecap 的成员明细）。

import type { Recap, RecapGroup, RecapMember } from './api';

export const isPresent = (m: RecapMember) => m.attendance === 'present';

// ---- 小组配色：按 orderIndex 固定（与名次无关），超出后循环 --------------------

export interface GroupPalette {
  headBg: string;
  headFg: string;
  ring: string;
}

const PALETTES: GroupPalette[] = [
  { headBg: '#fff2d6', headFg: '#b07d16', ring: '#f5a623' },
  { headBg: '#ffe7df', headFg: '#cf5236', ring: '#fb7a5c' },
  { headBg: '#e2f0ff', headFg: '#2a75be', ring: '#6fb1fc' },
  { headBg: '#e3f4e6', headFg: '#3a7a4e', ring: '#6cc07f' },
  { headBg: '#efe7fb', headFg: '#7a4fb5', ring: '#b18ae8' },
];

export const paletteFor = (orderIndex: number): GroupPalette => PALETTES[orderIndex % PALETTES.length];

const UNGROUPED_RING = '#d9c9a0';

// ---- 检查状态样式（读侧口径：背书缺记录=未检查，作业缺记录=没交） ----------------

export interface StatusStyle {
  text: string;
  dot: string;
  color: string;
}

const R_STYLE: Record<string, StatusStyle> = {
  已背完: { text: '已背完', dot: '#3a9d5b', color: '#3a7a4e' },
  背完部分: { text: '背完部分', dot: '#e0a12e', color: '#b07d16' },
  没背: { text: '没背', dot: '#d99a94', color: '#c4554d' },
};
const R_UNCHECKED: StatusStyle = { text: '未检查', dot: '#c9bfa6', color: '#a89a72' };

export function recitationStyle(r: string | null): StatusStyle {
  return (r && R_STYLE[r]) || R_UNCHECKED;
}

const H_STYLE: Record<string, StatusStyle> = {
  完成: { text: '完成', dot: '#3a9d5b', color: '#3a7a4e' },
  需补: { text: '需补', dot: '#e0a12e', color: '#b07d16' },
};
const H_MISS: StatusStyle = { text: '没交', dot: '#d99a94', color: '#c4554d' };

export function homeworkStyle(h: string | null): StatusStyle {
  return (h && H_STYLE[h]) || H_MISS;
}

export const scoreColor = (n: number) => (n > 0 ? '#3a7a4e' : n < 0 ? '#c4554d' : '#a89a72');

// ---- 今日之星：到堂且净分>0 的前三，讲台式排列 [第2名, 第1名, 第3名] ------------

export interface PodiumStar {
  rank: number; // 0 = 第1名
  name: string;
  score: number;
  groupName: string | null;
  groupEmoji: string | null;
  ring: string;
}

/** 全体到堂成员（含未分组），附组信息，供领奖台与分类统计遍历。 */
function presentWithGroup(recap: Recap): (RecapMember & { group: RecapGroup | null })[] {
  const rows: (RecapMember & { group: RecapGroup | null })[] = [];
  for (const g of recap.groups) for (const m of g.members ?? []) rows.push({ ...m, group: g });
  for (const m of recap.ungrouped ?? []) rows.push({ ...m, group: null });
  return rows.filter(isPresent);
}

export function podiumStars(recap: Recap): PodiumStar[] {
  const top3 = presentWithGroup(recap)
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((m, rank) => ({
      rank,
      name: m.name,
      score: m.score,
      groupName: m.group?.name ?? null,
      groupEmoji: m.group?.emoji ?? null,
      ring: m.group ? paletteFor(m.group.orderIndex).ring : UNGROUPED_RING,
    }));
  return [top3[1], top3[0], top3[2]].filter(Boolean) as PodiumStar[];
}

// ---- 各组详细表现 ------------------------------------------------------------

const MEDALS = ['🥇', '🥈', '🥉'];

export interface MemberRow {
  name: string;
  score: number;
  warns: number;
  recitation: StatusStyle;
  homework: StatusStyle;
  ring: string;
}

export interface RecapGroupCard {
  name: string;
  emoji: string | null;
  score: number;
  palette: GroupPalette;
  medal: string; // 前三名有奖牌，其余为空串
  rankLabel: string; // 第N名
  members: MemberRow[]; // 仅到堂成员，按净分降序
  absentText: string | null; // 缺席成员脚注（无则 null）
}

/** 缺席脚注："a、b 请假未到 · c 缺席未到"；全员到堂 → null。 */
export function absentText(members: RecapMember[]): string | null {
  const leave = members.filter((m) => m.attendance === 'leave').map((m) => m.name);
  const absent = members.filter((m) => m.attendance === 'absent').map((m) => m.name);
  const parts = [];
  if (leave.length) parts.push(`${leave.join('、')} 请假未到`);
  if (absent.length) parts.push(`${absent.join('、')} 缺席未到`);
  return parts.length ? parts.join(' · ') : null;
}

export function groupCards(recap: Recap): RecapGroupCard[] {
  return [...recap.groups]
    .sort((a, b) => b.score - a.score || a.orderIndex - b.orderIndex)
    .map((g, rank) => {
      const members = g.members ?? [];
      const palette = paletteFor(g.orderIndex);
      return {
        name: g.name,
        emoji: g.emoji,
        score: g.score,
        palette,
        medal: MEDALS[rank] ?? '',
        rankLabel: `第${rank + 1}名`,
        members: members
          .filter(isPresent)
          .sort((a, b) => b.score - a.score)
          .map((m) => ({
            name: m.name,
            score: m.score,
            warns: m.warns,
            recitation: recitationStyle(m.recitation),
            homework: homeworkStyle(m.homework),
            ring: palette.ring,
          })),
        absentText: absentText(members),
      };
    });
}

/** 未分组学生说明行："浩浩 缺席未到 · 新新 未分组"；无则 null。 */
export function ungroupedNote(recap: Recap): string | null {
  const list = recap.ungrouped ?? [];
  if (list.length === 0) return null;
  const parts = [];
  const away = absentText(list);
  if (away) parts.push(away);
  const present = list.filter(isPresent).map((m) => m.name);
  if (present.length) parts.push(`${present.join('、')} 未分组`);
  return parts.join(' · ');
}

// ---- 分类统计（需要关注的同学） -----------------------------------------------

export type ChipTone = 'red' | 'amber' | 'gray';

export interface StatChip {
  name: string;
  groupEmoji: string | null;
  tag: string;
  tone: ChipTone;
}

export interface StatSection {
  icon: string;
  title: string;
  hint: string;
  chips: StatChip[];
  emptyText: string;
}

/** 背书/作业检查开关：关闭后对应列与统计分区整体不出现（默认都开）。 */
export interface RecapCheckOptions {
  showRecitation?: boolean;
  showHomework?: boolean;
}

export function statSections(recap: Recap, opts: RecapCheckOptions = {}): StatSection[] {
  const present = presentWithGroup(recap);
  const chip = (m: (typeof present)[number], tag: string, tone: ChipTone): StatChip => ({
    name: m.name,
    groupEmoji: m.group?.emoji ?? null,
    tag,
    tone,
  });

  const recite = present
    .filter((m) => m.recitation !== '已背完')
    .map((m) =>
      m.recitation === '背完部分'
        ? chip(m, '背完部分', 'amber')
        : m.recitation === '没背'
          ? chip(m, '没背', 'red')
          : chip(m, '未检查', 'gray'),
    );
  const hw = present
    .filter((m) => m.homework !== '完成')
    .map((m) => (m.homework === '需补' ? chip(m, '需补', 'amber') : chip(m, '没交', 'red')));
  const warn = present
    .filter((m) => m.warns > 0)
    .sort((a, b) => b.warns - a.warns)
    .map((m) => chip(m, `提醒 ×${m.warns}`, 'red'));

  const sections: StatSection[] = [];
  if (opts.showRecitation !== false)
    sections.push({
      icon: '📖',
      title: '背书未完成',
      hint: '含背完部分',
      chips: recite,
      emptyText: '🎉 全员背书过关！',
    });
  if (opts.showHomework !== false)
    sections.push({ icon: '📝', title: '作业未完成', hint: '需课后补交', chips: hw, emptyText: '🎉 全员作业过关！' });
  sections.push({
    icon: '⚠️',
    title: '被老师提醒',
    hint: '每次扣分记一次',
    chips: warn,
    emptyText: '🎉 无人被提醒，课堂纪律很棒！',
  });
  return sections;
}
