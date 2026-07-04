import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Recap } from '../lib/api';
import { RecapCard } from './RecapCard';

const recap: Recap = {
  date: '07-03',
  weekday: '周五',
  lessonNumber: 3,
  lessonTitle: 'Please send me a card',
  actualDurationMin: 112,
  attendancePresent: 18,
  attendanceTotal: 20,
  groups: [
    { name: '海豚组', emoji: '🐬', orderIndex: 0, score: 10 },
    { name: '狮子组', emoji: '🦁', orderIndex: 1, score: 12 },
    { name: '狐狸组', emoji: '🦊', orderIndex: 2, score: 9 },
  ],
  stars: [
    { name: '王小明', net: 4, photoUrl: '/uploads/photos/xm.png' },
    { name: '李雷', net: 3 },
    { name: '韩梅梅', net: 2 },
    { name: '陈晨', net: 2 },
  ],
  warned: [{ name: '张伟' }],
  studentTags: [],
};

describe('RecapCard', () => {
  it('非个人模式：不传 personal 时隐藏个人表现部分', () => {
    const html = renderToStaticMarkup(<RecapCard recap={recap} className="三年级A班" year="2026" />);
    expect(html).toContain('三年级A班 · 2026.07.03');
    expect(html).toContain('Lesson 3 课堂战报');
    expect(html).toContain('时长 1小时52分');
    expect(html).not.toContain('人到课');
    expect(html).toContain('狮子组');
    expect(html).not.toContain('到课 ✓');
    expect(html).not.toContain('背书 ·');
  });

  it('今日之星：只显示前三名，胶囊带圆头像（有照片用 img，无照片回退首字）', () => {
    const html = renderToStaticMarkup(<RecapCard recap={recap} className="三年级A班" year="2026" />);
    expect(html).toContain('src="/uploads/photos/xm.png"'); // 王小明有照片
    expect(html).toContain('王小明');
    expect(html).toContain('李雷');
    expect(html).toContain('韩梅梅');
    expect(html).not.toContain('陈晨'); // 第四名不上榜
    expect(html).toContain('>李</span>'); // 无照片回退首字头像
  });

  it('奖章：有奖章时按学生渲染 chip，无奖章时整块隐藏', () => {
    const withTags: Recap = {
      ...recap,
      studentTags: [
        { name: '王小明', tags: ['听写全对', '默写全对'] },
        { name: '张伟', tags: ['进步之星'] },
      ],
    };
    const html = renderToStaticMarkup(<RecapCard recap={withTags} className="三年级A班" year="2026" />);
    expect(html).toContain('🏅 奖章');
    expect(html).toContain('王小明 · 听写全对、默写全对');
    expect(html).toContain('张伟 · 进步之星');

    const empty = renderToStaticMarkup(<RecapCard recap={recap} className="三年级A班" year="2026" />);
    expect(empty).not.toContain('🏅 奖章');
  });

  it('个人模式：显示个人卡（姓名/小组/个人分/背书作业状态）', () => {
    const html = renderToStaticMarkup(
      <RecapCard
        recap={recap}
        className="三年级A班"
        year="2026"
        personal={{
          name: '王小明',
          attended: true,
          groupName: '狮子组',
          groupEmoji: '🦁',
          personalScore: 4,
          recitation: '已背完',
          homework: '完成',
        }}
      />,
    );
    expect(html).toContain('到课 ✓ · 本节表现');
    expect(html).toContain('+4');
    expect(html).toContain('背书 · 已背完');
    expect(html).toContain('作业 · 完成');
  });

  it('个人模式：缺席时不显示个人分与检查状态', () => {
    const html = renderToStaticMarkup(
      <RecapCard
        recap={recap}
        className="三年级A班"
        year="2026"
        personal={{
          name: '刘洋',
          attended: false,
          groupName: null,
          groupEmoji: null,
          personalScore: 0,
          recitation: '未检查',
          homework: '没交',
        }}
      />,
    );
    expect(html).toContain('本节缺席');
    expect(html).not.toContain('背书 ·');
  });
});
