/** "第4课 · A private conversation" — either part optional; a string 课次
 *  (课前配置 form input) coerces; both blank → the fallback. */
export function lessonLabel(
  lessonNumber: number | string | null | undefined,
  lessonTitle: string | null | undefined,
  fallback = '本节课',
): string {
  const parts = [lessonNumber != null && lessonNumber !== '' && `第${lessonNumber}课`, lessonTitle || null].filter(
    Boolean,
  );
  return parts.join(' · ') || fallback;
}
