import { useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Me } from '../api/auth';
import type { BillingBatchDetail, InvoiceItem, InvoiceLessonRow } from '../api/billing';
import { ApiError } from '../api/client';
import { BillingBatchModal } from '../components/BillingBatchModal';
import { Modal } from '../components/Modal';
import { LoadErrorBlock, LoadingBlock, QueryBlock, RefreshStatus } from '../components/QueryState';
import { useStudentModal } from '../components/StudentEditModal';
import { useToast } from '../components/Toast';
import { TopBar } from '../components/TopBar';
import { weekdayCN } from '../lib/attendance';
import { centsToYuan, fmtMoney, yuanToCents } from '../lib/money';
import { queryView } from '../lib/queryView';
import { studentNamePair } from '../lib/studentName';
import { editIconBtnStyle, statusTag } from '../lib/theme';
import { utcToLocalMinute } from '../lib/utcTime';
import {
  useBillingBatchQuery,
  useConfirmInvoiceMutation,
  useDeleteBillingBatchMutation,
  useInvoiceLessonsQuery,
  useUnconfirmInvoiceMutation,
  useUpdateInvoiceMutation,
} from '../queries/billing';

const md = (d: string | null) => (d ? d.slice(5) : '—');
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function BillingBatch({ me }: { me: Me | null }) {
  const { batchId = '' } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const del = useDeleteBillingBatchMutation();
  // 删除进行中 / 已删除：不再读取这个批次（删除后缓存被移除，挂着的观察者不能再发 GET）。
  const detailQuery = useBillingBatchQuery(batchId, { enabled: !del.isPending && !del.isSuccess });
  const d = detailQuery.data;
  const view = queryView(detailQuery);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = d?.invoices.find((i) => i.id === editingId) ?? null;
  const [resetOpen, setResetOpen] = useState(false);
  const editStudent = useStudentModal();
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function confirmDelete() {
    if (del.isPending) return;
    try {
      await del.mutateAsync({ batchId });
      toast('收款项已删除');
      navigate('/billing');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '删除失败', 'error');
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

        {view === 'loading' && <LoadingBlock />}
        {view === 'error' && (
          <LoadErrorBlock error={detailQuery.error} what="收款项" onRetry={detailQuery.refetch} />
        )}
        {d && (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: '-.3px' }}>
                  {`${d.className} · ${d.scheduleName}`}
                </h1>
                <div className="mono" style={{ fontSize: 12.5, color: '#8a929e', marginTop: 6 }}>
                  周期 {md(d.minDate)} ~ {md(d.maxDate)} · 计划 {d.lessonCount} 节（已上 {d.heldSessionCount} / 未上{' '}
                  {d.futureLessonCount}）· 单价 ¥{centsToYuan(d.unitPriceCents)}/节
                  {d.addonCents > 0 &&
                    ` · 附加 ¥${centsToYuan(d.addonCents)}/人${d.addonNote ? `（${d.addonNote}）` : ''}`}
                  {d.snapshotAt && ` · 快照于 ${utcToLocalMinute(d.snapshotAt)}`}
                  <RefreshStatus query={detailQuery} style={{ marginLeft: 10, fontFamily: 'inherit' }} />
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 9 }}>
                <button style={ghostBtn} onClick={() => setResetOpen(true)}>
                  ↻ 重置收款项
                </button>
                <button style={{ ...ghostBtn, color: '#d94a4a' }} onClick={() => setDeleteOpen(true)}>
                  删除收款项
                </button>
              </div>
            </div>

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

            <div style={{ background: '#fff', border: '1px solid #e7e9ee', borderRadius: 13, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: '#8a929e', textAlign: 'left', borderBottom: '1px solid #ebedf1' }}>
                    <th style={th}>学生</th>
                    <th style={th}>已上到堂</th>
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
                      batchId={d.id}
                      held={d.heldSessionCount}
                      onEditStudent={() =>
                        editStudent({ studentId: inv.studentId, name: inv.studentName, cnName: inv.studentCnName })
                      }
                      onEdit={() => setEditingId(inv.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p style={{ fontSize: 12, color: '#9aa1ac', marginTop: 12, lineHeight: 1.7 }}>
          应收 = 单价 × 课程次数 + 附加费，每名学生一致，不按出勤扣减；中途入班、停课等个别情况点「编辑」直接填最终收款金额。
          <br />
          「重置收款项」只刷新<b>待收款</b>学生（并为新入班学生补建收款单）；已收款的行不动，改过金额的行保留最终金额与备注并标黄提醒。
        </p>
      </div>

      {d && <BillingBatchModal open={resetOpen} onClose={() => setResetOpen(false)} batch={d} />}

      {editing && d && <InvoiceEditModal inv={editing} batch={d} onClose={() => setEditingId(null)} />}

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
            style={{ ...primaryBtn, background: '#d94a4a', boxShadow: 'none', opacity: del.isPending ? 0.6 : 1 }}
            onClick={confirmDelete}
            disabled={del.isPending}
          >
            {del.isPending ? '删除中…' : '删除'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * 一行收款单。确认 / 撤销各自一个 Mutation 观察者：多行可同时进行，pending 只锁本行，
 * 缓存维护（行回写 + 批次与列表失效）在 hook 层完成，行组件卸载也照常执行。
 */
function InvoiceRow({
  inv,
  batchId,
  held,
  onEditStudent,
  onEdit,
}: {
  inv: InvoiceItem;
  batchId: string;
  held: number;
  /** ✎ 图标 — 改学生姓名；与下方文字版「编辑」（改费用）是两个入口，别混。 */
  onEditStudent: () => void;
  onEdit: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirmInvoiceMutation();
  const unconfirm = useUnconfirmInvoiceMutation();
  const pending = confirm.isPending || unconfirm.isPending;

  async function onConfirm() {
    if (pending) return;
    try {
      await confirm.mutateAsync({ invoiceId: inv.id, batchId });
      toast(`已确认收款：${inv.studentName} ${fmtMoney(inv.finalAmountCents)}`);
    } catch (e) {
      toast(errText(e, '操作失败'), 'error');
    }
  }

  async function onUndo() {
    if (pending) return;
    try {
      await unconfirm.mutateAsync({ invoiceId: inv.id, batchId });
      toast(`已撤销收款：${inv.studentName}`);
    } catch (e) {
      toast(errText(e, '操作失败'), 'error');
    }
  }

  const sTag = statusTag(inv.studentStatus);
  const names = studentNamePair({ name: inv.studentName, cnName: inv.studentCnName });
  const adjusted = inv.adjusted === 1;
  return (
    <tr
      style={{
        borderBottom: '1px solid #f1f3f6',
        background: adjusted ? 'rgba(232,145,58,.05)' : undefined,
      }}
    >
      <td style={td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontWeight: 600, color: '#1e2430' }}>{names.primary}</span>
          {sTag && (
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: sTag.color,
                background: sTag.bg,
                padding: '2px 7px',
                borderRadius: 999,
                marginLeft: 3,
              }}
            >
              {sTag.label}
            </span>
          )}
          <button onClick={onEditStudent} title="编辑学生姓名" style={editIconBtnStyle()}>
            ✎
          </button>
        </div>
        {names.secondary && <div style={{ fontSize: 11.5, color: '#8a919c', marginTop: 1 }}>{names.secondary}</div>}
      </td>
      <td style={td} className="mono">
        {inv.attendedCount}/{held}
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
              {inv.paidAt && utcToLocalMinute(inv.paidAt)}
              {inv.paidByName ? ` · ${inv.paidByName}` : ''}
            </div>
          </>
        ) : (
          <span style={{ color: '#b06c22', fontWeight: 700 }}>待收款</span>
        )}
      </td>
      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
        {inv.status === 'paid' ? (
          <button style={linkBtn('#8a929e')} onClick={onUndo} disabled={pending}>
            {unconfirm.isPending ? '撤销中…' : '撤销'}
          </button>
        ) : (
          <>
            <button style={linkBtn('#4f6ef7')} onClick={onEdit} disabled={pending}>
              编辑
            </button>
            <span style={{ color: '#d3d9df' }}> · </span>
            <button style={linkBtn('#2c7a48')} onClick={onConfirm} disabled={pending}>
              {confirm.isPending ? '确认中…' : '确认收款'}
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

// ===== 学生费用编辑弹窗 ======================================================
// 应收是全班一致的标准值（单价 × 课程次数 + 附加费），这里只看出勤明细、直接填最终收款金额。
function InvoiceEditModal({
  inv,
  batch,
  onClose,
}: {
  inv: InvoiceItem;
  batch: BillingBatchDetail;
  onClose: () => void;
}) {
  const toast = useToast();
  const lessons = useInvoiceLessonsQuery(inv.id);
  const update = useUpdateInvoiceMutation();
  // 草稿只在打开弹窗时从当前收款单建立一次；之后的后台刷新不覆盖输入。
  const [finalAmount, setFinalAmount] = useState(() => centsToYuan(inv.finalAmountCents));
  const [note, setNote] = useState(() => inv.note ?? '');
  const busy = update.isPending;

  const computed = inv.computedAmountCents;
  const finalCents = yuanToCents(finalAmount);
  const overridden = finalCents != null && finalCents !== computed;
  const canSubmit = finalCents != null && !busy;

  async function submit() {
    if (!canSubmit) return;
    try {
      await update.mutateAsync({ invoiceId: inv.id, batchId: batch.id, input: { finalAmountCents: finalCents!, note } });
      toast(`已保存 ${inv.studentName} 的费用`);
      onClose();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '保存失败，请重试', 'error');
    }
  }

  return (
    <Modal open onClose={onClose} title={`编辑费用 — ${inv.studentName} · ${batch.scheduleName}`} width={640}>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#5b6472' }}>周期出勤明细</div>
        <div className="mono" style={{ marginLeft: 'auto', fontSize: 12, color: '#8a929e' }}>
          到堂 {inv.attendedCount} / 已上 {batch.heldSessionCount} 节
        </div>
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #eef0f3', borderRadius: 9 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: '#8a929e', textAlign: 'left', borderBottom: '1px solid #ebedf1' }}>
              <th style={thSm}>#</th>
              <th style={thSm}>日期</th>
              <th style={thSm}>时间</th>
              <th style={thSm}>课堂</th>
              <th style={thSm}>出勤</th>
            </tr>
          </thead>
          <tbody>
            {(lessons.data?.rows ?? []).map((r, i) => (
              <LessonRow key={`${r.kind}-${r.sessionId ?? r.date + (r.startTime ?? '')}-${i}`} r={r} idx={i + 1} />
            ))}
          </tbody>
        </table>
        <QueryBlock query={lessons} what="出勤明细" style={{ padding: 14, fontSize: 12.5 }}>
          {() => null}
        </QueryBlock>
      </div>

      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-end', margin: '18px 0 12px', flexWrap: 'wrap' }}>
        <div>
          <div style={lbl}>应收</div>
          <div className="mono" style={{ fontSize: 16, fontWeight: 700, padding: '7px 0', color: '#1e2430' }}>
            {fmtMoney(computed)}
          </div>
          <div className="mono" style={{ fontSize: 11.5, color: '#8a929e' }}>
            {inv.billableCount} 节 × ¥{centsToYuan(inv.unitPriceCents)}
            {batch.addonCents > 0 && ` + 附加 ¥${centsToYuan(batch.addonCents)}`}
          </div>
        </div>
        <div>
          <div style={lbl}>最终收款金额（元）</div>
          <input
            value={finalAmount}
            onChange={(e) => setFinalAmount(e.target.value)}
            style={{ ...fieldSm, width: 120, borderColor: overridden ? '#e8913a' : undefined }}
          />
        </div>
        <button
          style={{ ...linkBtn('#8a929e'), paddingBottom: 9 }}
          title="最终金额恢复为应收"
          onClick={() => setFinalAmount(centsToYuan(computed))}
        >
          = 应收
        </button>
      </div>
      {finalAmount.trim() !== '' && finalCents == null && (
        <div style={{ fontSize: 12, color: '#d94a4a', marginBottom: 10 }}>金额需为非负数字，至多两位小数</div>
      )}
      {overridden && (
        <div style={{ fontSize: 12, color: '#b06c22', marginBottom: 10 }}>
          最终金额与应收不同，「重置收款项」时会保留此金额与备注。
        </div>
      )}
      <div style={lbl}>备注</div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="如 中途入班，按 15 节收"
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
