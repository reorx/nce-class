import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { BillingBatchDetail } from '../api/billing';
import { ApiError } from '../api/client';
import { billingClassSelection, parseLessonCount, previewPerStudentCents } from '../lib/billingForm';
import { centsToYuan, fmtMoney, yuanToCents } from '../lib/money';
import { useCreateBillingBatchMutation, useRecalculateBillingBatchMutation } from '../queries/billing';
import { useClassesQuery } from '../queries/classes';
import { useSchedulesQuery } from '../queries/schedules';
import { Modal } from './Modal';
import { useToast } from './Toast';

const md = (d: string | null) => (d ? d.slice(5) : '—');

/**
 * 收款项表单弹窗，创建与重置共用一套字段：
 * - 创建（batch 不传）：选班级 → 选课程周期 → 课程次数/单价/附加费 → 生成收款项
 * - 重置（batch 传入）：班级与周期锁定为该批次，条款可改 → 重新计算收款项
 * 课程次数默认取自课程周期的排班节数，可手动修改，以输入值为准。
 *
 * 读取：班级列表与所选班级的周期列表都是共享查询，只在创建模式打开时启用；换班即换 key，
 * 旧班级的请求随观察者离开被取消，晚到也只落在它自己的缓存里，不会覆盖新班级的周期列表。
 * 写入：创建 / 重算的响应是完整批次详情，由 Mutation 写进详情缓存，跳详情页无需再等读取。
 */
export function BillingBatchModal({
  open,
  onClose,
  batch,
}: {
  open: boolean;
  onClose: () => void;
  batch?: BillingBatchDetail | null;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const reset = batch != null;
  const create = useCreateBillingBatchMutation();
  const recalc = useRecalculateBillingBatchMutation();
  const busy = create.isPending || recalc.isPending;
  const classesQuery = useClassesQuery({ enabled: open && !reset });
  const [pickedClassId, setPickedClassId] = useState('');
  // 只列未归档班级；原选择已归档或删除时自动落到首个可用班级（纯派生，再次打开弹窗也适用）。
  const selection = useMemo(
    () => billingClassSelection(classesQuery.data ?? [], pickedClassId),
    [classesQuery.data, pickedClassId],
  );
  const { classes, classId } = selection;
  const classesLoading = classesQuery.data === undefined;
  const schedulesQuery = useSchedulesQuery(classId || undefined, { enabled: open && !reset });
  const schedules = schedulesQuery.data;
  const [scheduleId, setScheduleId] = useState('');
  const [lessonCount, setLessonCount] = useState('');
  const [price, setPrice] = useState('');
  const [addon, setAddon] = useState('');
  const [addonNote, setAddonNote] = useState('');

  // 创建模式每次打开都重新选周期（班级选择与条款保留）。
  useEffect(() => {
    if (!open || reset) return;
    setScheduleId('');
    setLessonCount('');
  }, [open, reset]);

  // 重置模式：打开时用批次当前条款回填一次；之后批次的后台刷新不覆盖正在编辑的条款。
  useEffect(() => {
    if (!open || !batch) return;
    setLessonCount(String(batch.lessonCount));
    setPrice(centsToYuan(batch.unitPriceCents));
    setAddon(batch.addonCents > 0 ? centsToYuan(batch.addonCents) : '');
    setAddonNote(batch.addonNote ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, batch?.id]);

  function pickClass(id: string) {
    setPickedClassId(id);
    setScheduleId('');
    setLessonCount('');
  }

  const cls = classes.find((c) => c.id === classId) ?? null;
  const sched = (schedules ?? []).find((s) => s.id === scheduleId) ?? null;
  const scheduleLessonCount = reset ? batch.scheduleLessonCount : (sched?.lessonCount ?? null);
  const scheduleChosen = reset || (!classesLoading && cls != null && sched != null);
  const count = parseLessonCount(lessonCount);
  const priceCents = yuanToCents(price);
  const addonCents = addon.trim() === '' ? 0 : yuanToCents(addon);
  const perStudent = previewPerStudentCents({ lessonCount: count, unitPriceCents: priceCents, addonCents });
  const canSubmit = scheduleChosen && count != null && priceCents != null && addonCents != null && !busy;

  async function submit() {
    if (!canSubmit) return;
    try {
      if (reset) {
        await recalc.mutateAsync({
          batchId: batch.id,
          terms: {
            unitPriceCents: priceCents!,
            addonCents: addonCents!,
            addonNote: addonNote.trim(),
            lessonCount: count!,
          },
        });
        toast('已重新计算：待收款行已按新条款刷新，新入班学生已补建');
        onClose();
      } else {
        const d = await create.mutateAsync({
          scheduleId: sched!.id,
          unitPriceCents: priceCents!,
          addonCents: addonCents!,
          addonNote: addonNote.trim() || undefined,
          lessonCount: count!,
        });
        toast(`已为 ${d.invoiceCount} 名学生创建收款单`);
        navigate(`/billing/${d.id}`);
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : reset ? '重新计算失败' : '创建失败，请重试', 'error');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={reset ? '重置收款项' : '创建收款项'} width={480}>
      {reset ? (
        <div
          style={{
            padding: '11px 14px',
            borderRadius: 9,
            background: 'rgba(79,110,247,.06)',
            border: '1px solid rgba(79,110,247,.25)',
            marginBottom: 16,
          }}
        >
          <strong style={{ fontSize: 14, color: '#1e2430' }}>
            {batch.className} · {batch.scheduleName}
          </strong>
          <div className="mono" style={{ fontSize: 12, color: '#8a929e', marginTop: 3 }}>
            {md(batch.minDate)} ~ {md(batch.maxDate)} · 排班 {batch.scheduleLessonCount} 节 · 已上{' '}
            {batch.heldSessionCount} 节
          </div>
        </div>
      ) : (
        <>
          <div style={label}>1. 选择班级</div>
          <select
            aria-label="选择班级"
            disabled={classesLoading || classes.length === 0}
            value={classId}
            onChange={(e) => pickClass(e.target.value)}
            style={{ ...field, marginBottom: classesQuery.isError && classesLoading ? 6 : 16 }}
          >
            {classes.length === 0 && (
              <option value="">
                {classesQuery.isError ? '班级加载失败' : classesLoading ? '加载班级中…' : '暂无未归档班级'}
              </option>
            )}
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}（{c.studentCount} 人）
              </option>
            ))}
          </select>
          {classesQuery.isError && classesLoading && (
            <InlineRetry text="班级加载失败" onRetry={() => classesQuery.refetch()} />
          )}

          <div style={label}>2. 选择课程周期（排班表）</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, margin: '8px 0 6px' }}>
            {(schedules ?? []).map((s) => {
              const taken = s.batchId != null;
              const on = s.id === scheduleId;
              return (
                <button
                  key={s.id}
                  disabled={taken}
                  onClick={() => {
                    setScheduleId(s.id);
                    setLessonCount(String(s.lessonCount));
                  }}
                  style={{
                    textAlign: 'left',
                    padding: '10px 13px',
                    borderRadius: 9,
                    cursor: taken ? 'not-allowed' : 'pointer',
                    opacity: taken ? 0.55 : 1,
                    border: on ? '1.5px solid #4f6ef7' : '1px solid #e2e5ea',
                    background: on ? 'rgba(79,110,247,.06)' : '#fff',
                  }}
                >
                  <strong style={{ fontSize: 14, color: '#1e2430' }}>{s.name}</strong>
                  {on && <span style={{ color: '#4f6ef7', fontSize: 12, marginLeft: 8 }}>✓ 已选</span>}
                  {taken && (
                    <span style={{ fontSize: 11.5, color: '#9aa1ac', marginLeft: 8 }}>已生成收款项，不可重复选</span>
                  )}
                  <div className="mono" style={{ fontSize: 12, color: '#8a929e', marginTop: 3 }}>
                    {md(s.minDate)} ~ {md(s.maxDate)} · 共 {s.lessonCount} 节
                  </div>
                </button>
              );
            })}
            {cls && !schedules && schedulesQuery.isError && (
              <InlineRetry text="课程周期加载失败" onRetry={() => schedulesQuery.refetch()} />
            )}
            {cls && !schedules && !schedulesQuery.isError && (
              <div style={{ fontSize: 12.5, color: '#9aa1ac', padding: '6px 0' }}>加载课程周期中…</div>
            )}
            {cls && schedules && schedules.length === 0 && (
              <div style={{ fontSize: 12.5, color: '#8a929e', padding: '6px 0' }}>
                该班还没有排班？
                <Link to={`/classes/${classId}?tab=schedule`} style={{ color: '#4f6ef7' }}>
                  去创建课程周期 →
                </Link>
              </div>
            )}
          </div>
        </>
      )}

      {scheduleChosen && (
        <div style={{ marginTop: reset ? 0 : 14 }}>
          <div style={label}>{reset ? '课程次数' : '3. 课程次数'}</div>
          <input
            value={lessonCount}
            onChange={(e) => setLessonCount(e.target.value)}
            style={{ ...field, width: 120, marginTop: 6 }}
          />
          {scheduleLessonCount != null && (
            <div style={{ fontSize: 12, color: '#9aa1ac', marginTop: 5 }}>
              默认取自课程周期（排班 {scheduleLessonCount} 节），可修改，计费以此处为准
              {count != null && count !== scheduleLessonCount && (
                <b style={{ color: '#b06c22' }}>（已改为 {count} 节）</b>
              )}
            </div>
          )}
          {lessonCount.trim() !== '' && count == null && (
            <div style={{ fontSize: 12, color: '#d94a4a', marginTop: 5 }}>课程次数需为正整数</div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, marginTop: 14 }}>
        <div>
          <div style={label}>{reset ? '每节课单价（元）' : '4. 每节课单价（元）'}</div>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="120"
            style={{ ...field, width: 120, marginTop: 6 }}
          />
        </div>
        <div>
          <div style={label}>附加费/人（元，可选）</div>
          <input
            value={addon}
            onChange={(e) => setAddon(e.target.value)}
            placeholder="0"
            style={{ ...field, width: 120, marginTop: 6 }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={label}>附加费说明</div>
          <input
            value={addonNote}
            onChange={(e) => setAddonNote(e.target.value)}
            placeholder="如 书本费"
            style={{ ...field, marginTop: 6 }}
          />
        </div>
      </div>
      {price.trim() !== '' && priceCents == null && (
        <div style={{ fontSize: 12, color: '#d94a4a', marginTop: 6 }}>单价需为非负数字，至多两位小数</div>
      )}
      {addon.trim() !== '' && addonCents == null && (
        <div style={{ fontSize: 12, color: '#d94a4a', marginTop: 6 }}>附加费需为非负数字，至多两位小数</div>
      )}

      {scheduleChosen && perStudent != null && (
        <div style={{ fontSize: 12.5, color: '#5b6472', margin: '12px 0 2px' }}>
          每人应收：{count} 节 × ¥{centsToYuan(priceCents!)}
          {addonCents! > 0 && ` + 附加 ¥${centsToYuan(addonCents!)}`} = <b>{fmtMoney(perStudent)}</b> / 人
          {!reset && cls && (
            <>
              {' '}
              · {cls.studentCount} 名学生共 <b>{fmtMoney(perStudent * cls.studentCount)}</b>
            </>
          )}
        </div>
      )}
      <div style={{ fontSize: 12, color: '#9aa1ac', marginTop: 8, lineHeight: 1.6 }}>
        {reset
          ? '只重算待收款学生：应收按上方条款刷新、单价统一为上方单价，并为新入班学生补建收款单；手动改过金额的行保留最终金额与备注；已收款的行不变。'
          : '每名学生的应收都按上方条款计算，不看出勤；中途入班、停课等个别情况生成后在详情页直接改最终收款金额。'}
      </div>

      <button
        onClick={submit}
        disabled={!canSubmit}
        style={{
          width: '100%',
          height: 42,
          marginTop: 16,
          background: '#4f6ef7',
          color: '#fff',
          border: 'none',
          borderRadius: 9,
          fontWeight: 600,
          fontSize: 14.5,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
          opacity: canSubmit ? 1 : 0.55,
        }}
      >
        {busy ? (reset ? '重算中…' : '生成中…') : reset ? '重新计算收款项' : '生成收款项'}
      </button>
    </Modal>
  );
}

function InlineRetry({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div role="alert" style={{ fontSize: 12.5, color: '#d94a4a', padding: '6px 0', marginBottom: 10 }}>
      {text} ·{' '}
      <button
        onClick={onRetry}
        style={{ border: 'none', background: 'transparent', padding: 0, color: '#4f6ef7', fontWeight: 600, cursor: 'pointer' }}
      >
        重试
      </button>
    </div>
  );
}

const label: CSSProperties = { fontSize: 12.5, fontWeight: 700, color: '#5b6472' };
const field: CSSProperties = {
  width: '100%',
  height: 38,
  padding: '0 11px',
  border: '1px solid #e2e5ea',
  borderRadius: 9,
  fontSize: 13.5,
  color: '#1e2430',
  background: '#fbfcfd',
};
