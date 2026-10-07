import type { ClassDetail } from '../api/classes';
import type { SessionDetail } from '../api/sessions';
import { buildClassroomSession, buildEditSession, type ClassroomSession } from './classroomStore';
import { configFromDetail } from './setup';

// 进入课堂页的判定（kb/docs/classroom-session-lifecycle.md「进入课堂页的判定顺序」）：
// 1. 本地已有该班课堂 → 恢复（edit_id 指向别的课 → 冲突拦截，不覆盖）；不等服务器。
// 2. edit_id → 读这节课的原始记录 + 班级当前默认分组，还原成可编辑课堂。
// 3. ?lesson / title / duration → 按班级最新名单直接开新课。
// 4. 都不是 → 课前配置。
// 2、3 需要服务器数据：数据到齐后由 settleBoot 定稿，定稿前再查一次存储。

export type ServerBootPlan =
  | { kind: 'edit'; editId: string }
  | { kind: 'url'; lessonNumber: string; lessonTitle: string; durationMin: number };

export type BootPlan =
  | { kind: 'resume'; session: ClassroomSession }
  | { kind: 'conflict' }
  | ServerBootPlan
  | { kind: 'setup' };

export function bootPlan(stored: ClassroomSession | null, search: string): BootPlan {
  const sp = new URLSearchParams(search);
  const editId = sp.get('edit_id');
  if (stored) {
    // 每班只有一个本地课堂槽位：要编辑的不是槽里这节，就拦下，绝不覆盖进行中的课。
    return editId && stored.editOfSessionId !== editId ? { kind: 'conflict' } : { kind: 'resume', session: stored };
  }
  if (editId) return { kind: 'edit', editId };
  const lesson = sp.get('lesson');
  const title = sp.get('title');
  const duration = sp.get('duration');
  if (lesson || title || duration) {
    return {
      kind: 'url',
      lessonNumber: (lesson ?? '').replace(/[^0-9]/g, ''),
      lessonTitle: title ?? '',
      durationMin: Math.max(1, Number(duration) || 120),
    };
  }
  return { kind: 'setup' };
}

export type BootOutcome =
  | { kind: 'resume'; session: ClassroomSession }
  | { kind: 'conflict' }
  | { kind: 'redirect' }
  | { kind: 'create'; session: ClassroomSession };

/**
 * 服务器数据到齐后的最终决定。先再查一次存储（stored 由调用方此刻重新读取）：这期间已恢复 / 建好的
 * 课堂（StrictMode 重跑、别的标签页、晚到的回复）一律优先，永不覆盖，也不会生成第二个 clientSessionId。
 * edit_id 的课不属于当前路由的班级 → 回课前配置。
 */
export function settleBoot(
  plan: ServerBootPlan,
  ctx: {
    classId: string;
    stored: ClassroomSession | null;
    classDetail: ClassDetail;
    sessionDetail?: SessionDetail;
    clientSessionId: () => string;
    now: string;
  },
): BootOutcome {
  if (ctx.stored) {
    if (plan.kind === 'edit' && ctx.stored.editOfSessionId !== plan.editId) return { kind: 'conflict' };
    return { kind: 'resume', session: ctx.stored };
  }
  if (plan.kind === 'edit') {
    const detail = ctx.sessionDetail;
    if (!detail || detail.classId !== ctx.classId) return { kind: 'redirect' };
    const defaultGrouping = ctx.classDetail.groups.map((g) => ({
      clientId: g.id,
      name: g.name,
      emoji: g.emoji,
      orderIndex: g.orderIndex,
      memberIds: g.memberIds,
    }));
    return { kind: 'create', session: buildEditSession(detail, defaultGrouping) };
  }
  const cfg = configFromDetail(ctx.classDetail, {
    lessonNumber: plan.lessonNumber,
    lessonTitle: plan.lessonTitle,
    durationMin: plan.durationMin,
    className: ctx.classDetail.name,
  });
  return {
    kind: 'create',
    session: buildClassroomSession(cfg, { classId: ctx.classId, clientSessionId: ctx.clientSessionId(), startedAt: ctx.now }),
  };
}
