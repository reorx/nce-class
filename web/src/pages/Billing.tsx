import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Me } from '../api/auth';
import type { BillingBatchItem } from '../api/billing';
import { BillingBatchModal } from '../components/BillingBatchModal';
import { QueryBlock, RefreshStatus } from '../components/QueryState';
import { TopBar } from '../components/TopBar';
import { centsToYuan, fmtMoney } from '../lib/money';
import { GREEN } from '../lib/theme';
import { utcToLocalDate } from '../lib/utcTime';
import { useBillingBatchesQuery, usePrefetchBillingBatch } from '../queries/billing';

const md = (d: string | null) => (d ? d.slice(5) : '—');

type Filter = 'all' | 'pending' | 'settled';

export function Billing({ me }: { me: Me | null }) {
  const batchesQuery = useBillingBatchesQuery();
  const prefetch = usePrefetchBillingBatch();
  const batches = batchesQuery.data;
  const [filter, setFilter] = useState<Filter>('all');
  const [createOpen, setCreateOpen] = useState(false);

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
              <RefreshStatus query={batchesQuery} style={{ marginLeft: 10 }} />
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

        <QueryBlock query={batchesQuery} what="收款项">
          {(list) =>
            shown.length === 0 ? (
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
                {list.length === 0 ? '还没有收款项，点右上角「创建收款项」开始' : '没有匹配的收款项'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {shown.map((b) => (
                  <BatchCard key={b.id} b={b} onIntent={() => void prefetch(b.id)} />
                ))}
              </div>
            )
          }
        </QueryBlock>
      </div>

      <BillingBatchModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

/** onIntent：指针移入 / 获得焦点时预取完整详情（fresh 时不重复请求）。 */
function BatchCard({ b, onIntent }: { b: BillingBatchItem; onIntent: () => void }) {
  const settled = b.invoiceCount > 0 && b.paidCount === b.invoiceCount;
  const pct = b.totalAmountCents > 0 ? Math.round((b.paidAmountCents / b.totalAmountCents) * 100) : 0;
  return (
    <Link
      to={`/billing/${b.id}`}
      onPointerEnter={onIntent}
      onFocus={onIntent}
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
        {b.addonCents > 0 && ` · 附加 ¥${centsToYuan(b.addonCents)}/人`} · 创建于 {md(utcToLocalDate(b.createdAt))}
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
