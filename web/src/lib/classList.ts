import type { ClassListItem } from './api';

/** 已归档班级列表页（首页「n 个归档」入口 / 已归档班级详情页的返回链接）。 */
export const ARCHIVED_CLASSES_URL = '/classes?is_archived=true';

type Row = Pick<ClassListItem, 'name' | 'studentCount' | 'isArchived'>;

/**
 * 班级列表页的派生视图。首页（archived=false）只看未归档班级，归档页只看已归档；
 * classCount/studentTotal 是当前模式全部班级的口径（不随搜索词变），list 再按搜索词收窄；
 * archivedCount 供首页「n 个归档」入口（0 时不显示）。
 */
export function classListView<T extends Row>(classes: T[], opts: { archived: boolean; search: string }) {
  const scope = classes.filter((c) => c.isArchived === opts.archived);
  const q = opts.search.trim();
  return {
    list: q ? scope.filter((c) => c.name.includes(q)) : scope,
    classCount: scope.length,
    studentTotal: scope.reduce((a, c) => a + c.studentCount, 0),
    archivedCount: classes.filter((c) => c.isArchived).length,
  };
}
