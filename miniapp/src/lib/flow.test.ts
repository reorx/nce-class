import { describe, expect, it } from 'vitest';
import type { WxChild, WxMe } from './api';
import { mockLoginCode, pickChild, routeForMe, validateJoinForm } from './flow';

const me = (over: Partial<WxMe>): WxMe => ({
  account: { id: 'wa-1', nickname: null, avatarUrl: null },
  teacher: null,
  children: [],
  pending: [],
  ...over,
});

const child = (studentId: string, name: string): WxChild => ({
  studentId,
  name,
  photoUrl: null,
  classId: 'c1',
  className: '三年级A班',
});

describe('mockLoginCode（wxAuth h5 mock 分支）', () => {
  it('有 mock 名用 mock 名，空值/非字符串回退 dev-new', () => {
    expect(mockLoginCode('dev-teacher')).toBe('mock:dev-teacher');
    expect(mockLoginCode('  dev-parent ')).toBe('mock:dev-parent');
    expect(mockLoginCode('')).toBe('mock:dev-new');
    expect(mockLoginCode(undefined)).toBe('mock:dev-new');
    expect(mockLoginCode(42)).toBe('mock:dev-new');
  });
});

describe('routeForMe 首页分流', () => {
  it('老师优先，其次孩子，再次 pending，否则欢迎页', () => {
    expect(routeForMe(me({ teacher: { id: 't1', name: '王莉', username: 'wangli', orgName: '晨光' } }))).toBe(
      'teacher',
    );
    expect(routeForMe(me({ children: [child('s1', '小明')] }))).toBe('children');
    expect(routeForMe(me({ pending: [{ id: 'jr1', classId: 'c1', className: '三年级A班', cnName: '朵朵' }] }))).toBe(
      'pending',
    );
    expect(routeForMe(me({}))).toBe('welcome');
  });

  it('同时有孩子和 pending → 走孩子首页', () => {
    expect(
      routeForMe(
        me({
          children: [child('s1', '小明')],
          pending: [{ id: 'jr1', classId: 'c2', className: '别班', cnName: '朵朵' }],
        }),
      ),
    ).toBe('children');
  });
});

describe('pickChild 多孩切换', () => {
  const kids = [child('s1', '小明'), child('s2', '小红')];

  it('命中记忆 id 用它，否则回退第一个；空列表 null', () => {
    expect(pickChild(kids, 's2')?.name).toBe('小红');
    expect(pickChild(kids, 's-gone')?.name).toBe('小明');
    expect(pickChild(kids, null)?.name).toBe('小明');
    expect(pickChild([], 's1')).toBeNull();
  });
});

describe('validateJoinForm', () => {
  it('中文名必填；手机号可空但填了必须 11 位 1 开头', () => {
    expect(validateJoinForm({ cnName: '', parentPhone: '' })).toContain('中文名');
    expect(validateJoinForm({ cnName: '  ', parentPhone: '' })).toContain('中文名');
    expect(validateJoinForm({ cnName: '朵朵', parentPhone: '' })).toBeNull();
    expect(validateJoinForm({ cnName: '朵朵', parentPhone: '13800138000' })).toBeNull();
    expect(validateJoinForm({ cnName: '朵朵', parentPhone: '12345' })).toContain('11 位');
    expect(validateJoinForm({ cnName: '朵朵', parentPhone: '23800138000' })).toContain('11 位');
  });
});
