import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { TopBar } from '../components/TopBar';
import { api, ApiError, type BillingBatchItem, type ClassListItem, type Me, type ScheduleItem } from '../lib/api';
import { centsToYuan, fmtMoney, yuanToCents } from '../lib/money';
import { GREEN } from '../lib/theme';

const md = (d: string | null) => (d ? d.slice(5) : '—');

type Filter = 'all' | 'pending' | 'settled';

export function Billing({ me }: { me: Me | null }) {
  const toast = useToast();
  const [batches, setBatches] = useState<BillingBatchItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [createOpen, setCreateOpen] = useState(false);

  const reload = () =>
    api
      .listBillingBatches()
      .then(setBatches)
      .catch(() => toast('收款项加载失败', 'error'));

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const list = batches ?? [];
    if (filter === 'pending') return list.filter((b) => b.pendingAmountCents > 0 || b.paidCount < b.invoiceCount);
    if (filter === 'settled') return list.filter((b) => b.invoiceCount > 0 && b.paidCount === b.invoiceCount);
    return list;
  }, [batches, filter]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar me={me} active="billing" />
      <div style={{ width: '100%', maxWidth: 860, margin: '0 auto', padding: '26px 26px 64px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-.3px' }}>收银台</h1>
            <div style={{ marginTop: 6, fontSize: 13, color: '#7a828f' }}>
              按「班级 + 课程周期」发起收款，逐学生结算与确认到账
            </div>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            style={{
              marginLeft: 'auto',
              height: 38,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 16px',
              background: GREEN,
              color: '#fff',
              border: 'none',
              borderRadius: 9,
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(47,180,87,.24)',
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 400, lineHeight: 1 }}>+</span>创建收款项
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {(
            [
              ['all', '全部'],
              ['pending', '有待收款'],
              ['settled', '已收齐'],
            ] as const
          ).map(([k, label]) => {
            const on = filter === k;
            return (
              <button
                key={k}
                onClick={() => setFilter(k)}
                style={{
                  padding: '5px 14px',
                  borderRadius: 999,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  background: on ? '#1e2430' : '#fff',
                  color: on ? '#fff' : '#7a828f',
                  border: on ? '1px solid #1e2430' : '1px solid #e2e5ea',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {batches && shown.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '56px 20px',
              color: '#9aa1ac',
              fontSize: 13.5,
              background: '#fff',
              border: '1px dashed #d3d9df',
              borderRadius: 14,
            }}
          >
            {batches.length === 0 ? '还没有收款项，点右上角「创建收款项」开始' : '没有匹配的收款项'}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {shown.map((b) => (
            <BatchCard key={b.id} b={b} />
          ))}
        </div>
      </div>

      <CreateBatchModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function BatchCard({ b }: { b: BillingBatchItem }) {
  const settled = b.invoiceCount > 0 && b.paidCount === b.invoiceCount;
  const pct = b.totalAmountCents > 0 ? Math.round((b.paidAmountCents / b.totalAmountCents) * 100) : 0;
  return (
    <Link
      to={`/billing/${b.id}`}
      style={{
        display: 'block',
        background: '#fff',
        border: '1px solid #e7e9ee',
        borderRadius: 13,
        padding: '15px 18px',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <strong style={{ fontSize: 15.5, color: '#1e2430' }}>
          {b.className} · {b.scheduleName}
        </strong>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 12.5,
            fontWeight: 700,
            color: settled ? '#2c7a48' : '#b06c22',
          }}
        >
          {settled ? '✓ 已收齐' : `${b.paidCount}/${b.invoiceCount} 已收`}
        </span>
      </div>
      <div className="mono" style={{ fontSize: 12.5, color: '#8a929e', marginTop: 5 }}>
        {md(b.minDate)} ~ {md(b.maxDate)} · {b.lessonCount} 节 · ¥{centsToYuan(b.unitPriceCents)}/节
        {b.addonCents > 0 && ` · 附加 ¥${centsToYuan(b.addonCents)}/人`} · 创建于 {md(b.createdAt.slice(0, 10))}
      </div>
      <div style={{ marginTop: 10, height: 6, borderRadius: 3, background: '#eef1f5', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: settled ? '#2fb457' : '#4caf7d' }} />
      </div>
      <div style={{ fontSize: 12.5, color: '#8a929e', marginTop: 7 }}>
        已收 <b style={{ color: '#2c7a48' }}>{fmtMoney(b.paidAmountCents)}</b> / 应收 {fmtMoney(b.totalAmountCents)}
      </div>
    </Link>
  );
}

// ===== 创建收款项弹窗 ========================================================
function CreateBatchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [classes, setClasses] = useState<ClassListItem[]>([]);
  const [classId, setClassId] = useState('');
  const [schedules, setSchedules] = useState<ScheduleItem[] | null>(null);
  const [scheduleId, setScheduleId] = useState('');
  const [price, setPrice] = useState('');
  const [addon, setAddon] = useState('');
  const [addonNote, setAddonNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api
      .classes()
      .then((cs) => {
        setClasses(cs);
        setClassId((cur) => cur || cs[0]?.id || '');
      })
      .catch(() => toast('班级加载失败', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !classId) return;
    setSchedules(null);
    setScheduleId('');
    api
      .listSchedules(classId)
      .then(setSchedules)
      .catch(() => toast('课程周期加载失败', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, classId]);

  const cls = classes.find((c) => c.id === classId) ?? null;
  const sched = (schedules ?? []).find((s) => s.id === scheduleId) ?? null;
  const priceCents = yuanToCents(price);
  const addonCents = addon.trim() === '' ? 0 : yuanToCents(addon);
  const perStudent =
    sched && priceCents != null && addonCents != null ? sched.lessonCount * priceCents + addonCents : null;
  const canSubmit = sched != null && priceCents != null && addonCents != null && !busy;

  async function submit() {
    if (!canSubmit || !sched) return;
    setBusy(true);
    try {
      const d = await api.createBillingBatch({
        scheduleId: sched.id,
        unitPriceCents: priceCents!,
        addonCents: addonCents!,
        addonNote: addonNote.trim() || undefined,
      });
      toast(`已为 ${d.invoiceCount} 名学生创建收款单`);
      navigate(`/billing/${d.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '创建失败，请重试', 'error');
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="创建收款项" width={480}>
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
              onClick={() => setScheduleId(s.id)}
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

      <div style={{ display: 'flex', gap: 14, marginTop: 14 }}>
        <div>
          <div style={label}>3. 每节课单价（元）</div>
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

      {sched && perStudent != null && cls && (
        <div style={{ fontSize: 12.5, color: '#5b6472', margin: '12px 0 2px' }}>
          预售金额（全勤口径）：{sched.lessonCount} 节 × ¥{centsToYuan(priceCents!)}
          {addonCents! > 0 && ` + 附加 ¥${centsToYuan(addonCents!)}`} = <b>{fmtMoney(perStudent)}</b> / 人 ·{' '}
          {cls.studentCount} 名学生共 <b>{fmtMoney(perStudent * cls.studentCount)}</b>
        </div>
      )}
      <div style={{ fontSize: 12, color: '#9aa1ac', marginTop: 8, lineHeight: 1.6 }}>
        生成时按「已上到堂 + 未上计划」逐学生快照应收；停课学生只结已上部分，完全未参与的学生应收为 0。
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
        {busy ? '生成中…' : '生成收款项'}
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
