import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BillingBatchModal } from '../components/BillingBatchModal';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { TopBar } from '../components/TopBar';
import { api, ApiError, type BillingBatchDetail, type InvoiceItem, type InvoiceLessonRow, type Me } from '../lib/api';
import { weekdayCN } from '../lib/attendance';
import { centsToYuan, fmtMoney, yuanToCents } from '../lib/money';
import { statusTag } from '../lib/theme';

const md = (d: string | null) => (d ? d.slice(5) : '—');

export function BillingBatch({ me }: { me: Me | null }) {
  const { batchId = '' } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const [d, setD] = useState<BillingBatchDetail | null>(null);
  const [editing, setEditing] = useState<InvoiceItem | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = () =>
    api
      .billingBatchDetail(batchId)
      .then(setD)
      .catch(() => toast('收款项加载失败', 'error'));

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  async function confirmDelete() {
    if (busy) return;
    setBusy(true);
    try {
      await api.deleteBillingBatch(batchId);
      toast('收款项已删除');
      navigate('/billing');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '删除失败', 'error');
      setBusy(false);
    }
  }

  async function confirmPay(inv: InvoiceItem) {
    try {
      await api.confirmInvoice(inv.id);
      await reload();
      toast(`已确认收款：${inv.studentName} ${fmtMoney(inv.finalAmountCents)}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '操作失败', 'error');
    }
  }

  async function undoPay(inv: InvoiceItem) {
    try {
      await api.unconfirmInvoice(inv.id);
      await reload();
      toast(`已撤销收款：${inv.studentName}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '操作失败', 'error');
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar me={me} active="billing" />
      <div style={{ width: '100%', maxWidth: 1020, margin: '0 auto', padding: '22px 26px 64px' }}>
        <Link
          to="/billing"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: '#7a828f',
            textDecoration: 'none',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 13,
          }}
        >
          <span style={{ fontSize: 14 }}>←</span>返回收银台
        </Link>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: '-.3px' }}>
              {d ? `${d.className} · ${d.scheduleName}` : ' '}
            </h1>
            {d && (
              <div className="mono" style={{ fontSize: 12.5, color: '#8a929e', marginTop: 6 }}>
                周期 {md(d.minDate)} ~ {md(d.maxDate)} · 计划 {d.lessonCount} 节（已上 {d.heldSessionCount} / 未上{' '}
                {d.futureLessonCount}）· 单价 ¥{centsToYuan(d.unitPriceCents)}/节
                {d.addonCents > 0 &&
                  ` · 附加 ¥${centsToYuan(d.addonCents)}/人${d.addonNote ? `（${d.addonNote}）` : ''}`}
                {d.snapshotAt && ` · 快照于 ${d.snapshotAt.slice(5, 16)}`}
              </div>
            )}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 9 }}>
            <button style={ghostBtn} onClick={() => setResetOpen(true)} disabled={d == null}>
              ↻ 重置收款项
            </button>
            <button style={{ ...ghostBtn, color: '#d94a4a' }} onClick={() => setDeleteOpen(true)}>
              删除收款项
            </button>
          </div>
        </div>

        {d && (
          <div
            style={{
              display: 'flex',
              gap: 26,
              flexWrap: 'wrap',
              fontSize: 13,
              margin: '12px 0 18px',
              padding: '11px 16px',
              background: 'rgba(79,110,247,.05)',
              borderRadius: 9,
              color: '#3c4451',
            }}
          >
            <span>
              学生 <b>{d.invoiceCount}</b>
            </span>
            <span>
              已收款{' '}
              <b style={{ color: '#2c7a48' }}>
                {d.paidCount} 人 · {fmtMoney(d.paidAmountCents)}
              </b>
            </span>
            <span>
              待收款{' '}
              <b style={{ color: '#b06c22' }}>
                {d.invoiceCount - d.paidCount} 人 · {fmtMoney(d.pendingAmountCents)}
              </b>
            </span>
            <span>
              应收合计 <b>{fmtMoney(d.totalAmountCents)}</b>
            </span>
          </div>
        )}

        {d && (
          <div style={{ background: '#fff', border: '1px solid #e7e9ee', borderRadius: 13, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: '#8a929e', textAlign: 'left', borderBottom: '1px solid #ebedf1' }}>
                  <th style={th}>学生</th>
                  <th style={th}>已上到堂</th>
                  <th style={th}>未上计划</th>
                  <th style={th}>计费节数</th>
                  <th style={th}>应收</th>
                  <th style={th}>备注</th>
                  <th style={th}>状态</th>
                  <th style={{ ...th, textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {d.invoices.map((inv) => (
                  <InvoiceRow
                    key={inv.id}
                    inv={inv}
                    held={d.heldSessionCount}
                    onEdit={() => setEditing(inv)}
                    onConfirm={() => confirmPay(inv)}
                    onUndo={() => undoPay(inv)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 12, color: '#9aa1ac', marginTop: 12, lineHeight: 1.7 }}>
          「重置收款项」只刷新<b>待收款</b>学生的快照（并为新入班学生补建收款单）；已收款的行不动。
          手动改过金额的行重算时保留最终金额与备注、仅更新节数统计并标黄提醒。
        </p>
      </div>

      {d && (
        <BillingBatchModal
          open={resetOpen}
          onClose={() => setResetOpen(false)}
          batch={d}
          onReset={(next) => {
            setD(next);
            setResetOpen(false);
          }}
        />
      )}

      {editing && d && (
        <InvoiceEditModal
          inv={editing}
          batch={d}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="删除收款项">
        <div style={{ fontSize: 14, color: '#3c4451', lineHeight: 1.7 }}>
          确定删除「<b>{d ? `${d.className} · ${d.scheduleName}` : ''}</b>」吗？全部 {d?.invoiceCount ?? 0}{' '}
          张学生收款单会一并删除。
          {d != null && d.paidCount > 0 && (
            <div style={{ color: '#d94a4a', marginTop: 8 }}>
              ⚠️ 其中 {d.paidCount} 人已确认收款（{fmtMoney(d.paidAmountCents)}），删除后这些台账记录将丢失。
            </div>
          )}
          <div style={{ color: '#8a929e', marginTop: 8, fontSize: 12.5 }}>删除后该课程周期可重新生成收款项。</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <button style={ghostBtn} onClick={() => setDeleteOpen(false)}>
            取消
          </button>
          <button
            style={{ ...primaryBtn, background: '#d94a4a', boxShadow: 'none', opacity: busy ? 0.6 : 1 }}
            onClick={confirmDelete}
          >
            {busy ? '删除中…' : '删除'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function InvoiceRow({
  inv,
  held,
  onEdit,
  onConfirm,
  onUndo,
}: {
  inv: InvoiceItem;
  held: number;
  onEdit: () => void;
  onConfirm: () => void;
  onUndo: () => void;
}) {
  const sTag = statusTag(inv.studentStatus);
  const adjusted = inv.adjusted === 1;
  const suspended = inv.studentStatus !== 'active';
  return (
    <tr
      style={{
        borderBottom: '1px solid #f1f3f6',
        background: adjusted ? 'rgba(232,145,58,.05)' : undefined,
      }}
    >
      <td style={td}>
        <span style={{ fontWeight: 600, color: '#1e2430' }}>{inv.studentName}</span>
        {sTag && (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: sTag.color,
              background: sTag.bg,
              padding: '2px 7px',
              borderRadius: 999,
              marginLeft: 7,
            }}
          >
            {sTag.label}
          </span>
        )}
      </td>
      <td style={td} className="mono">
        {inv.attendedCount}/{held}
      </td>
      <td style={td} className="mono">
        {suspended && inv.plannedCount === 0 ? (
          <span style={{ color: '#aab1bc' }}>
            0 <span style={{ fontSize: 11 }}>(不计未来)</span>
          </span>
        ) : (
          inv.plannedCount
        )}
      </td>
      <td style={td} className="mono">
        {inv.billableCount}
      </td>
      <td style={td}>
        {adjusted && (
          <span className="mono" style={{ textDecoration: 'line-through', color: '#aab1bc', marginRight: 6 }}>
            {fmtMoney(inv.computedAmountCents)}
          </span>
        )}
        <b className="mono">{fmtMoney(inv.finalAmountCents)}</b>
        {adjusted && (
          <span title="手动调整过" style={{ fontSize: 11, color: '#e8913a', marginLeft: 5, fontWeight: 700 }}>
            改
          </span>
        )}
      </td>
      <td style={{ ...td, fontSize: 12, color: inv.note ? '#5b6472' : '#c0c6cf', maxWidth: 140 }}>{inv.note ?? '—'}</td>
      <td style={td}>
        {inv.status === 'paid' ? (
          <>
            <span style={{ color: '#2c7a48', fontWeight: 700 }}>✓ 已收款</span>
            <div style={{ fontSize: 11, color: '#8a929e', marginTop: 2 }}>
              {inv.paidAt?.slice(5, 16)}
              {inv.paidByName ? ` · ${inv.paidByName}` : ''}
            </div>
          </>
        ) : (
          <span style={{ color: '#b06c22', fontWeight: 700 }}>待收款</span>
        )}
      </td>
      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
        {inv.status === 'paid' ? (
          <button style={linkBtn('#8a929e')} onClick={onUndo}>
            撤销
          </button>
        ) : (
          <>
            <button style={linkBtn('#4f6ef7')} onClick={onEdit}>
              编辑
            </button>
            <span style={{ color: '#d3d9df' }}> · </span>
            <button style={linkBtn('#2c7a48')} onClick={onConfirm}>
              确认收款
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

// ===== 学生费用编辑弹窗 ======================================================
function InvoiceEditModal({
  inv,
  batch,
  onClose,
  onSaved,
}: {
  inv: InvoiceItem;
  batch: BillingBatchDetail;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<InvoiceLessonRow[] | null>(null);
  const [price, setPrice] = useState(centsToYuan(inv.unitPriceCents));
  const [finalAmount, setFinalAmount] = useState(centsToYuan(inv.finalAmountCents));
  const [note, setNote] = useState(inv.note ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .invoiceLessons(inv.id)
      .then((r) => setRows(r.rows))
      .catch(() => toast('出勤明细加载失败', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv.id]);

  const priceCents = yuanToCents(price);
  const computed =
    priceCents == null ? null : inv.billableCount === 0 ? 0 : priceCents * inv.billableCount + batch.addonCents;
  const finalCents = yuanToCents(finalAmount);
  const overridden = computed != null && finalCents != null && finalCents !== computed;
  const canSubmit = priceCents != null && finalCents != null && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await api.updateInvoice(inv.id, { unitPriceCents: priceCents!, finalAmountCents: finalCents!, note });
      toast(`已保存 ${inv.studentName} 的费用`);
      await onSaved();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '保存失败，请重试', 'error');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`编辑费用 — ${inv.studentName} · ${batch.scheduleName}`} width={640}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#5b6472', marginBottom: 6 }}>周期出勤明细</div>
      <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #eef0f3', borderRadius: 9 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: '#8a929e', textAlign: 'left', borderBottom: '1px solid #ebedf1' }}>
              <th style={thSm}>#</th>
              <th style={thSm}>日期</th>
              <th style={thSm}>时间</th>
              <th style={thSm}>课堂</th>
              <th style={thSm}>出勤</th>
              <th style={{ ...thSm, textAlign: 'right' }}>计费</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r, i) => (
              <LessonRow key={`${r.kind}-${r.sessionId ?? r.date + (r.startTime ?? '')}-${i}`} r={r} idx={i + 1} />
            ))}
          </tbody>
        </table>
        {rows == null && <div style={{ padding: 14, color: '#9aa1ac', fontSize: 12.5 }}>加载中…</div>}
      </div>
      <div style={{ fontSize: 12, color: '#8a929e', margin: '8px 0 16px' }}>
        已上到堂 {inv.attendedCount} · 未上按计划 {inv.plannedCount} → 计费节数 <b>{inv.billableCount}</b>
        {batch.addonCents > 0 && `；附加费 ¥${centsToYuan(batch.addonCents)}/人（计费为 0 时不收）`}
      </div>

      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={lbl}>该生单价（元）</div>
          <input value={price} onChange={(e) => setPrice(e.target.value)} style={{ ...fieldSm, width: 100 }} />
        </div>
        <div style={{ fontSize: 13, color: '#8a929e', paddingBottom: 9 }}>× {inv.billableCount} 节 =</div>
        <div>
          <div style={lbl}>应收（自动）</div>
          <div className="mono" style={{ fontSize: 16, fontWeight: 700, padding: '7px 0', color: '#1e2430' }}>
            {computed == null ? '—' : fmtMoney(computed)}
          </div>
        </div>
        <div>
          <div style={lbl}>最终收款金额（元）</div>
          <input
            value={finalAmount}
            onChange={(e) => setFinalAmount(e.target.value)}
            style={{ ...fieldSm, width: 110, borderColor: overridden ? '#e8913a' : undefined }}
          />
        </div>
        {computed != null && (
          <button
            style={{ ...linkBtn('#8a929e'), paddingBottom: 9 }}
            title="最终金额恢复为自动应收"
            onClick={() => setFinalAmount(centsToYuan(computed))}
          >
            = 应收
          </button>
        )}
      </div>
      {overridden && (
        <div style={{ fontSize: 12, color: '#b06c22', marginBottom: 10 }}>
          最终金额已覆盖自动应收，「重新计算」将保留此金额与备注。
        </div>
      )}
      <div style={lbl}>备注</div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="如 老学员优惠 -40"
        style={{ ...fieldSm, width: '100%', margin: '4px 0 18px' }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
        <button style={ghostBtn} onClick={onClose}>
          取消
        </button>
        <button
          style={{ ...primaryBtn, background: '#4f6ef7', opacity: canSubmit ? 1 : 0.55 }}
          disabled={!canSubmit}
          onClick={submit}
        >
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </Modal>
  );
}

function LessonRow({ r, idx }: { r: InvoiceLessonRow; idx: number }) {
  const dim = r.kind !== 'session';
  return (
    <tr style={{ borderBottom: '1px solid #f4f6f8', opacity: dim ? 0.62 : 1 }}>
      <td style={tdSm} className="mono">
        {idx}
      </td>
      <td style={tdSm} className="mono">
        {r.date.slice(5)} {weekdayCN(r.date).slice(1)}
      </td>
      <td style={tdSm} className="mono">
        {r.kind === 'session' ? (r.startTime ?? '—') : `${r.startTime}–${r.endTime}`}
      </td>
      <td style={{ ...tdSm, fontSize: 12, color: '#8a929e' }}>
        {r.kind === 'session'
          ? `${r.lessonNumber ? `L${r.lessonNumber} ` : ''}${r.lessonTitle ?? ''}${r.inSchedule === false ? '（临时加课）' : ''}` ||
            '—'
          : r.kind === 'missed'
            ? '未开课'
            : '—'}
      </td>
      <td style={tdSm}>
        {r.kind === 'session' ? (
          r.attendance == null ? (
            <span style={{ color: '#aab1bc' }}>未入班</span>
          ) : r.attendance === 'present' ? (
            <span style={{ color: '#2c7a48' }}>✓ 到堂</span>
          ) : (
            <>
              <span style={{ color: r.attendance === 'leave' ? '#b06c22' : '#d94a4a' }}>
                {r.attendance === 'leave' ? '假 请假' : '✕ 缺席'}
              </span>
              {r.madeUp && <span style={{ fontSize: 11, color: '#2c7a48', marginLeft: 5 }}>已补课</span>}
            </>
          )
        ) : (
          <span style={{ color: '#8a929e' }}>○ 未上</span>
        )}
      </td>
      <td style={{ ...tdSm, textAlign: 'right' }}>
        {r.billable ? (
          <span style={{ color: '#1e2430' }}>
            ✓{r.kind === 'planned' && <span style={{ fontSize: 11, color: '#8a929e', marginLeft: 4 }}>按计划</span>}
          </span>
        ) : (
          <span style={{ color: '#c0c6cf' }}>—</span>
        )}
      </td>
    </tr>
  );
}

const th: CSSProperties = { padding: '9px 12px', fontWeight: 600, fontSize: 12 };
const td: CSSProperties = { padding: '10px 12px', verticalAlign: 'top' };
const thSm: CSSProperties = { padding: '7px 10px', fontWeight: 600, fontSize: 11.5 };
const tdSm: CSSProperties = { padding: '7px 10px' };
const lbl: CSSProperties = { fontSize: 12, fontWeight: 700, color: '#5b6472', marginBottom: 4 };
const fieldSm: CSSProperties = {
  height: 36,
  padding: '0 10px',
  border: '1px solid #e2e5ea',
  borderRadius: 8,
  fontSize: 13.5,
  color: '#1e2430',
  background: '#fbfcfd',
};
const primaryBtn: CSSProperties = {
  height: 38,
  padding: '0 18px',
  background: '#2fb457',
  color: '#fff',
  border: 'none',
  borderRadius: 9,
  fontWeight: 600,
  fontSize: 13.5,
  cursor: 'pointer',
};
const ghostBtn: CSSProperties = {
  height: 38,
  padding: '0 15px',
  background: '#fff',
  color: '#5b6472',
  border: '1px solid #e2e5ea',
  borderRadius: 9,
  fontWeight: 600,
  fontSize: 13.5,
  cursor: 'pointer',
};
const linkBtn = (color: string): CSSProperties => ({
  border: 'none',
  background: 'transparent',
  color,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  padding: 0,
});
