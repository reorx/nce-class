import { describe, expect, it } from 'vitest';
import { addTeacherFormValid, deleteImpactLines, paidWarning, resetFormValid } from './admin';
import type { AdminClassItem } from './api';

const item = (p: Partial<AdminClassItem> = {}): AdminClassItem => ({
  id: 'c1',
  name: '三年级A班',
  teacherName: '王莉',
  studentCount: 0,
  sessionCount: 0,
  scheduleCount: 0,
  batchCount: 0,
  invoiceCount: 0,
  paidInvoiceCount: 0,
  paidAmountCents: 0,
  ...p,
});

describe('deleteImpactLines', () => {
  it('lists every non-zero count, then the scaffolding every class loses', () => {
    expect(
      deleteImpactLines(item({ studentCount: 13, sessionCount: 7, scheduleCount: 2, batchCount: 1, invoiceCount: 13 })),
    ).toEqual([
      '13 名学生（含停课、归档）',
      '7 条上课记录（含计分、考勤、作业检查、奖章）',
      '2 个排班周期',
      '1 个收款批次（13 张收款单）',
      '默认分组、班级邀请、家长注册申请与微信绑定',
    ]);
  });

  it('an empty class only loses its scaffolding', () => {
    expect(deleteImpactLines(item())).toEqual(['默认分组、班级邀请、家长注册申请与微信绑定']);
  });
});

describe('paidWarning', () => {
  it('is null when nothing has been confirmed as paid', () => {
    expect(paidWarning(item({ batchCount: 1, invoiceCount: 13 }))).toBeNull();
  });

  it('warns with the confirmed count and amount', () => {
    expect(paidWarning(item({ paidInvoiceCount: 3, paidAmountCents: 1372000 }))).toBe(
      '⚠️ 其中 3 张收款单已确认收款（¥13,720），删除后这些收款台账将永久丢失。',
    );
  });
});

describe('resetFormValid', () => {
  it('needs a new password of at least 6 characters and a non-empty admin password', () => {
    expect(resetFormValid('fresh1', 'x')).toBe(true);
    expect(resetFormValid('12345', 'x')).toBe(false);
    expect(resetFormValid('fresh1', '')).toBe(false);
    expect(resetFormValid('', '')).toBe(false);
  });
});

describe('addTeacherFormValid', () => {
  it('needs a non-blank name and username and a password of at least 6 characters — no admin password', () => {
    const ok = { name: '李芳', username: 'lifang', password: 'secret' };
    expect(addTeacherFormValid(ok)).toBe(true);
    expect(addTeacherFormValid({ ...ok, name: '  ' })).toBe(false);
    expect(addTeacherFormValid({ ...ok, username: ' ' })).toBe(false);
    expect(addTeacherFormValid({ ...ok, password: '12345' })).toBe(false);
  });
});
