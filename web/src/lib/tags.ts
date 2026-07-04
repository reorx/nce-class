// ---------------------------------------------------------------------------
// 奖章 tag 纯逻辑：名字归一化 + 下拉数据源合并。
//
// tag 是自由文本、组织内全局共享的奖章名（中文界面叫「奖章」）。课堂本地只存
// 名字字符串（离线可用），结束课堂随 commit payload 一起入库，服务端按名字
// 幂等 upsert 进 org 库 — 这里的归一化口径必须与 server/src/app.ts 的
// buildCommitInput 保持一致（trim + 折叠空白 + 截断 MAX_TAG_LEN）。
// ---------------------------------------------------------------------------

/** 与服务端 MAX_TAG_LEN 一致；picker 的输入框用它做 maxLength。 */
export const MAX_TAG_LEN = 20;

/** trim + 折叠连续空白 + 按码点截断（不切开 emoji）+ 再 trim（截断可能留尾随空格），
 *  得到入库/展示用的规范名（空白输入 → ''）。 */
export function normalizeTagName(raw: string): string {
  return [...raw.trim().replace(/\s+/g, ' ')].slice(0, MAX_TAG_LEN).join('').trim();
}

/** 去重键：归一化后折叠 ASCII 大小写（中文 no-op），对齐服务端 NOCASE 唯一索引。 */
export function tagKey(raw: string): string {
  return normalizeTagName(raw).toLowerCase();
}

/** 下拉数据源 = org 库 ∪ 本节课本地新增，大小写不敏感去重（保留先出现的写法），中文序排序。 */
export function mergeTagOptions(orgTags: string[], localTags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...orgTags, ...localTags]) {
    const name = normalizeTagName(raw);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b, 'zh'));
}
