// 多选拖拽的纯集合逻辑，背书/作业检查视图共用（SegmentView）。
// 约定：选中集非空即处于多选模式（点学生=选中/取消）；选中集清空自动退出。

/** 点学生卡：在/不在选中集之间切换。 */
export function toggleOne(sel: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(sel);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** 栏头全选 checkbox：该栏已全选 → 整栏移出选中集；否则补齐全选（不动其他栏）。 */
export function toggleAll(sel: ReadonlySet<string>, ids: string[]): Set<string> {
  const next = new Set(sel);
  if (allSelected(sel, ids)) for (const id of ids) next.delete(id);
  else for (const id of ids) next.add(id);
  return next;
}

/** 该栏（非空）是否已全选 —— 栏头 checkbox 的勾选态。 */
export function allSelected(sel: ReadonlySet<string>, ids: string[]): boolean {
  return ids.length > 0 && ids.every((id) => sel.has(id));
}

/** 该栏是否有部分选中 —— 栏头 checkbox 的 indeterminate 态。 */
export function someSelected(sel: ReadonlySet<string>, ids: string[]): boolean {
  return ids.some((id) => sel.has(id));
}

/** 拖拽目标集：拖选中者 = 整个选中集一起动；拖未选中者 = 只动它自己。 */
export function dragTargets(sel: ReadonlySet<string>, draggedId: string): string[] {
  return sel.has(draggedId) ? [...sel] : [draggedId];
}
