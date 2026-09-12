// /admin 管理页的纯派生逻辑：删除班级弹窗的影响面文案 + 修改成员密码表单校验。
import type { AdminClassItem } from './api';
import { fmtMoney } from './money';

const MIN_PASSWORD_LENGTH = 6; // 与服务端 provision.MIN_PASSWORD_LENGTH 同口径

/** 删除班级会一并硬删的数据：只列非零计数，末行是每个班都有的附属数据。 */
export function deleteImpactLines(item: AdminClassItem): string[] {
  const lines: string[] = [];
  if (item.studentCount > 0) lines.push(`${item.studentCount} 名学生（含停课、归档）`);
  if (item.sessionCount > 0) lines.push(`${item.sessionCount} 条上课记录（含计分、考勤、作业检查、奖章）`);
  if (item.scheduleCount > 0) lines.push(`${item.scheduleCount} 个排班周期`);
  if (item.batchCount > 0) lines.push(`${item.batchCount} 个收款批次（${item.invoiceCount} 张收款单）`);
  lines.push('默认分组、班级邀请、家长注册申请与微信绑定');
  return lines;
}

/** 有已确认收款时的高亮警告（真实到账的台账），否则 null。 */
export function paidWarning(item: AdminClassItem): string | null {
  if (item.paidInvoiceCount === 0) return null;
  return `⚠️ 其中 ${item.paidInvoiceCount} 张收款单已确认收款（${fmtMoney(item.paidAmountCents)}），删除后这些收款台账将永久丢失。`;
}

/** 修改成员密码表单：新密码至少 6 位，且已输入管理员自己的密码。 */
export function resetFormValid(password: string, adminPassword: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH && adminPassword.length > 0;
}
