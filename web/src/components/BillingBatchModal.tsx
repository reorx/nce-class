import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type BillingBatchDetail, type ClassListItem, type ScheduleItem } from '../lib/api';
import { parseLessonCount, previewPerStudentCents } from '../lib/billingForm';
import { centsToYuan, fmtMoney, yuanToCents } from '../lib/money';
import { Modal } from './Modal';
import { useToast } from './Toast';

const md = (d: string | null) => (d ? d.slice(5) : '—');

/**
 * 收款项表单弹窗，创建与重置共用一套字段：
 * - 创建（batch 不传）：选班级 → 选课程周期 → 课程次数/单价/附加费 → 生成收款项
 * - 重置（batch 传入）：班级与周期锁定为该批次，条款可改 → 重新计算收款项
 * 课程次数默认取自课程周期的排班节数，可手动修改，以输入值为准。
 */
export function BillingBatchModal({
  open,
  onClose,
  batch,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  batch?: BillingBatchDetail | null;
  onReset?: (d: BillingBatchDetail) => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const reset = batch != null;
  const [classes, setClasses] = useState<ClassListItem[]>([]);
  const [classId, setClassId] = useState('');
  const [schedules, setSchedules] = useState<ScheduleItem[] | null>(null);
  const [scheduleId, setScheduleId] = useState('');
  const [lessonCount, setLessonCount] = useState('');
  const [price, setPrice] = useState('');
  const [addon, setAddon] = useState('');
  const [addonNote, setAddonNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || reset) return;
    api
      .classes()
      .then((cs) => {
        setClasses(cs);
        setClassId((cur) => cur || cs[0]?.id || '');
      })
      .catch(() => toast('班级加载失败', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset]);

  useEffect(() => {
    if (!open || reset || !classId) return;
    setSchedules(null);
    setScheduleId('');
    setLessonCount('');
    api
      .listSchedules(classId)
      .then(setSchedules)
      .catch(() => toast('课程周期加载失败', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset, classId]);

  // 重置模式：打开时用批次当前条款回填
  useEffect(() => {
    if (!open || !batch) return;
    setLessonCount(String(batch.lessonCount));
    setPrice(centsToYuan(batch.unitPriceCents));
    setAddon(batch.addonCents > 0 ? centsToYuan(batch.addonCents) : '');
    setAddonNote(batch.addonNote ?? '');
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, batch?.id]);

  const cls = classes.find((c) => c.id === classId) ?? null;
  const sched = (schedules ?? []).find((s) => s.id === scheduleId) ?? null;
  const scheduleLessonCount = reset ? batch.scheduleLessonCount : (sched?.lessonCount ?? null);
  const scheduleChosen = reset || sched != null;
  const count = parseLessonCount(lessonCount);
  const priceCents = yuanToCents(price);
  const addonCents = addon.trim() === '' ? 0 : yuanToCents(addon);
  const perStudent = previewPerStudentCents({ lessonCount: count, unitPriceCents: priceCents, addonCents });
  const canSubmit = scheduleChosen && count != null && priceCents != null && addonCents != null && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      if (reset) {
        const d = await api.recalculateBillingBatch(batch.id, {
          unitPriceCents: priceCents!,
          addonCents: addonCents!,
          addonNote: addonNote.trim(),
          lessonCount: count!,
        });
        toast('已重新计算：待收款行已按新条款刷新，新入班学生已补建');
        onReset?.(d);
      } else {
        const d = await api.createBillingBatch({
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
      setBusy(false);
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
          <select value={classId} onChange={(e) => setClassId(e.target.value)} style={{ ...field, marginBottom: 16 }}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}（{c.studentCount} 人）
              </option>
            ))}
          </select>

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
            {schedules && schedules.length === 0 && (
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
          {reset ? '重算口径' : '预售金额'}（全勤口径）：{count} 节 × ¥{centsToYuan(priceCents!)}
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
          ? '只重算待收款学生：节数与金额按上方条款重新快照、单价统一为上方单价（个别改过单价的行也会被统一），并为新入班学生补建收款单；手动改过金额的行保留最终金额与备注；已收款的行不变。'
          : '生成时按「已上到堂 + 未上计划」逐学生快照应收；停课学生只结已上部分，完全未参与的学生应收为 0。'}
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
