import type { Meta, StoryObj } from '@storybook/react-vite';
import { RecapCardV3 } from './RecapCardV3';
import type { Recap, RecapGroup, RecapMember } from '../lib/api';

// 对齐 RecapPanel 的移动端预览：414 宽画板（Recap v3.dc.html）。

const mem = (name: string, over: Partial<RecapMember> = {}): RecapMember => ({
  name,
  attendance: 'present',
  score: 0,
  recitation: '已背完',
  homework: '完成',
  warns: 0,
  ...over,
});

const grp = (name: string, over: Partial<RecapGroup> = {}): RecapGroup => ({
  name,
  emoji: null,
  orderIndex: 0,
  score: 0,
  members: [],
  ...over,
});

const mkRecap = (over: Partial<Recap> = {}): Recap => ({
  date: '07-10',
  weekday: '周五',
  lessonNumber: 12,
  lessonTitle: 'Goodbye and good luck',
  actualDurationMin: 120,
  attendancePresent: 8,
  attendanceTotal: 8,
  groups: [],
  ungrouped: [],
  stars: [],
  warned: [],
  studentTags: [],
  ...over,
});

const meta = {
  title: 'Recap/RecapCardV3',
  component: RecapCardV3,
  args: { className: '三年级A班', year: '2026' },
  decorators: [
    (Story) => (
      <div style={{ width: 414, margin: '24px auto', borderRadius: 16, overflow: 'hidden' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RecapCardV3>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 常规情况：前三分数各不相同，头像 + 组名完整展示。 */
export const Default: Story = {
  args: {
    recap: mkRecap({
      groups: [
        grp('雄狮组', {
          emoji: '🦁',
          orderIndex: 0,
          score: 9,
          members: [
            mem('小明', { score: 5 }),
            mem('思思', { score: 3, recitation: '背完部分' }),
            mem('乐乐', { score: 1, homework: '需补' }),
          ],
        }),
        grp('猛虎组', {
          emoji: '🐯',
          orderIndex: 1,
          score: 6,
          members: [
            mem('欣欣', { score: 4 }),
            mem('大壮', { score: 2, recitation: '没背', warns: 1 }),
            mem('悦悦', { attendance: 'leave' }),
          ],
        }),
      ],
      studentTags: [{ name: '小明', tags: ['发音之星'] }],
    }),
    homework: '1. 抄写 Lesson 12 单词\n2. 背诵课文并录音',
  },
};

/** 验收重点：第一名两人同分、第三名三人同分 → 同档并列，只显示人名不显示头像。 */
export const TiedTopThree: Story = {
  args: {
    recap: mkRecap({
      groups: [
        grp('雄狮组', {
          emoji: '🦁',
          orderIndex: 0,
          score: 12,
          members: [mem('小明', { score: 6 }), mem('思思', { score: 4 }), mem('乐乐', { score: 2 })],
        }),
        grp('猛虎组', {
          emoji: '🐯',
          orderIndex: 1,
          score: 10,
          members: [mem('欣欣', { score: 6 }), mem('大壮', { score: 2 }), mem('多多', { score: 2 })],
        }),
      ],
    }),
  },
};

/** 全员同分：唯一一档（第1名）7 人并列 → 只列前 5 个名字，收尾「等 7 人」。 */
export const AllTiedFirst: Story = {
  args: {
    recap: mkRecap({
      groups: [
        grp('雄狮组', {
          emoji: '🦁',
          orderIndex: 0,
          score: 12,
          members: [
            mem('小明', { score: 3 }),
            mem('思思', { score: 3 }),
            mem('乐乐', { score: 3 }),
            mem('欣欣', { score: 3 }),
          ],
        }),
        grp('猛虎组', {
          emoji: '🐯',
          orderIndex: 1,
          score: 9,
          members: [mem('大壮', { score: 3 }), mem('多多', { score: 3 }), mem('浩浩', { score: 3 })],
        }),
      ],
    }),
  },
};

/** 长名字回归：领奖台与成员明细的人名都不再被 … 截断。 */
export const LongNames: Story = {
  args: {
    recap: mkRecap({
      groups: [
        grp('雄狮组', {
          emoji: '🦁',
          orderIndex: 0,
          score: 9,
          members: [
            mem('欧阳娜娜贝贝', { score: 5 }),
            mem('爱新觉罗·启星', { score: 3 }),
            mem('Alexandria Wang', { score: 1, warns: 2 }),
          ],
        }),
      ],
    }),
  },
};
