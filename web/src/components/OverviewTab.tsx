import { type CSSProperties, type ReactNode } from 'react';
import type { OverviewGroup, SessionDetail } from '../lib/api';
import { avatarStyle, initial } from '../lib/theme';

// 课堂情况 tab（还原设计稿「上课记录.dc.html」的 OVERVIEW）：本节课的出勤 / 全班
// 与各组得分 / 作业与背书检查一屏概览。数据全部来自服务端 overview + recap 派生，
// 组件只负责呈现。出勤模型只有到勤/缺勤两态（无「请假」）。

const CHIP = {
  neutral: chip('#f0f2f5', '#3c4451'),
  green: chip('#eef8f1', '#2c8a4f', '#cfe9d5'),
  red: chip('#fdeeee', '#c14a4a', '#f2cfcf'),
  amber: chip('#faf1df', '#a86a12', '#eed9ae'),
  gray: chip('#f4f5f7', '#8a929e'),
};

function chip(bg: string, fg: string, border?: string): CSSProperties {
  return {
    padding: '3px 10px',
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 600,
    background: bg,
    color: fg,
    ...(border ? { border: `1px solid ${border}` } : null),
  };
}

/** One "label · count → chips" row (attendance / highlights / checks share it). */
function ChipRow({
  label,
  dot,
  count,
  chips,
  chipStyle,
  labelWidth = 88,
}: {
  label: string;
  dot: string;
  count?: number;
  chips: string[];
  chipStyle: CSSProperties;
  labelWidth?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ flexShrink: 0, width: labelWidth, display: 'flex', alignItems: 'center', gap: 6, paddingTop: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#5b6472' }}>{label}</span>
        {count != null && (
          <span className="mono" style={{ fontSize: 12, color: '#a6adb8' }}>
            {count}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
        {chips.length === 0 ? (
          <span style={{ fontSize: 12, color: '#b7bec8', padding: '4px 0' }}>无</span>
        ) : (
          chips.map((c, i) => (
            <span key={i} style={chipStyle}>
              {c}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e7e9ee', borderRadius: 13, padding: '16px 18px', ...style }}>
      {children}
    </div>
  );
}

function CardHead({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 13 }}>
      <span style={{ fontWeight: 700, fontSize: 14.5, color: '#1e2430' }}>{title}</span>
      {note && (
        <span className="mono" style={{ fontSize: 12, color: '#9aa1ac' }}>
          {note}
        </span>
      )}
    </div>
  );
}

export function OverviewTab({ d }: { d: SessionDetail }) {
  const o = d.overview;
  const presentCount = o.present.length;
  const stars = d.recap.stars.map((s) => s.name);
  const warned = d.recap.warned.map((w) => w.name);

  const stats: { label: string; value: string; color: string; sub: string }[] = [
    { label: '到勤', value: `${presentCount}/${o.totalStudents}`, color: '#1e2430', sub: `应到 ${o.totalStudents} 人` },
    {
      label: '缺勤',
      value: `${o.absent.length}`,
      color: o.absent.length ? '#c14a4a' : '#1e2430',
      sub: o.absent.join('、') || '无',
    },
    {
      label: '全班总分',
      value: o.classScore >= 0 ? `+${o.classScore}` : `${o.classScore}`,
      color: o.classScore > 0 ? '#2c8a4f' : '#1e2430',
      sub: `被提醒 ${warned.length} 人`,
    },
    {
      label: '作业完成',
      value: `${o.homework.done.length}/${presentCount}`,
      color: '#1e2430',
      sub: `需补 ${o.homework.redo.length} · 没交 ${o.homework.miss.length}`,
    },
    {
      label: '背书完成',
      value: `${o.recitation.full.length}/${presentCount}`,
      color: '#1e2430',
      sub: `部分 ${o.recitation.part.length} · 没背 ${o.recitation.none.length} · 未检查 ${o.recitation.unchecked.length}`,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* STAT STRIP */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e7e9ee',
          borderRadius: 13,
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          overflow: 'hidden',
        }}
      >
        {stats.map((st, i) => (
          <div
            key={st.label}
            style={{ padding: '13px 16px 12px', borderRight: i === stats.length - 1 ? undefined : '1px solid #f1f3f6' }}
          >
            <div style={{ fontSize: 11.5, fontWeight: 600, color: '#9aa1ac' }}>{st.label}</div>
            <div
              className="mono"
              style={{ marginTop: 4, fontWeight: 600, fontSize: 20, lineHeight: 1, color: st.color }}
            >
              {st.value}
            </div>
            <div
              style={{
                marginTop: 5,
                fontSize: 11.5,
                color: '#a6adb8',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {st.sub}
            </div>
          </div>
        ))}
      </div>

      {/* ATTENDANCE + HIGHLIGHTS */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 330px', gap: 14 }}>
        <Card>
          <CardHead title="出勤" note={`到勤 ${presentCount} / 应到 ${o.totalStudents}`} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ChipRow label="到勤" dot="#2fb457" count={presentCount} chips={o.present} chipStyle={CHIP.neutral} />
            <ChipRow label="缺勤" dot="#e0454a" count={o.absent.length} chips={o.absent} chipStyle={CHIP.red} />
          </div>
        </Card>

        <Card style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: '#1e2430', marginBottom: 13 }}>亮点与提醒</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ChipRow label="表现亮眼" dot="#2fb457" chips={stars} chipStyle={CHIP.green} labelWidth={78} />
            <ChipRow label="被提醒" dot="#e0454a" chips={warned} chipStyle={CHIP.red} labelWidth={78} />
          </div>
          <div style={{ marginTop: 'auto', paddingTop: 12, fontSize: 11.5, color: '#a6adb8', lineHeight: 1.5 }}>
            净加分 ≥ 2 计入亮眼，两者均会同步到家长 recap。
          </div>
        </Card>
      </div>

      {/* GROUP SCORES */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, margin: '4px 0 10px' }}>
          <span style={{ fontWeight: 700, fontSize: 14.5, color: '#1e2430' }}>各组得分</span>
          <span className="mono" style={{ fontSize: 12, color: '#9aa1ac' }}>
            本节合计 +{o.classScore} 分 · 排名按得分
          </span>
        </div>
        {o.groups.length === 0 ? (
          <Card>
            <div style={{ textAlign: 'center', color: '#9aa1ac', fontSize: 13 }}>本节课没有分组记录</div>
          </Card>
        ) : (
          <div
            style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(o.groups.length, 3)}, 1fr)`, gap: 12 }}
          >
            {o.groups.map((g, i) => (
              <GroupCard key={g.id} group={g} rank={i + 1} />
            ))}
          </div>
        )}
      </div>

      {/* CHECKS */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Card style={{ display: 'flex', flexDirection: 'column' }}>
          <CardHead title="作业检查" note={`完成 ${o.homework.done.length} / ${presentCount}`} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ChipRow
              label="完成"
              dot="#2fb457"
              count={o.homework.done.length}
              chips={o.homework.done}
              chipStyle={CHIP.green}
              labelWidth={96}
            />
            <ChipRow
              label="需补"
              dot="#e0912a"
              count={o.homework.redo.length}
              chips={o.homework.redo}
              chipStyle={CHIP.amber}
              labelWidth={96}
            />
            <ChipRow
              label="没交"
              dot="#e0454a"
              count={o.homework.miss.length}
              chips={o.homework.miss}
              chipStyle={CHIP.red}
              labelWidth={96}
            />
          </div>
          <div style={{ marginTop: 'auto', paddingTop: 12, fontSize: 11.5, color: '#a6adb8' }}>
            {o.absent.length ? `缺勤学生不计入检查（${o.absent.join('、')}）` : '全员到勤，均计入检查'}
          </div>
        </Card>

        <Card style={{ display: 'flex', flexDirection: 'column' }}>
          <CardHead
            title="背书检查"
            note={`已检查 ${presentCount - o.recitation.unchecked.length} / ${presentCount}`}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ChipRow
              label="已背完"
              dot="#2fb457"
              count={o.recitation.full.length}
              chips={o.recitation.full}
              chipStyle={CHIP.green}
              labelWidth={96}
            />
            <ChipRow
              label="背完部分"
              dot="#e0912a"
              count={o.recitation.part.length}
              chips={o.recitation.part}
              chipStyle={CHIP.amber}
              labelWidth={96}
            />
            <ChipRow
              label="没背"
              dot="#e0454a"
              count={o.recitation.none.length}
              chips={o.recitation.none}
              chipStyle={CHIP.red}
              labelWidth={96}
            />
            <ChipRow
              label="未检查"
              dot="#c9cfd6"
              count={o.recitation.unchecked.length}
              chips={o.recitation.unchecked}
              chipStyle={CHIP.gray}
              labelWidth={96}
            />
          </div>
          <div style={{ marginTop: 'auto', paddingTop: 12, fontSize: 11.5, color: '#a6adb8' }}>
            背诵范围：本课课文{d.lessonNumber != null ? ` Lesson ${d.lessonNumber}` : ''}
          </div>
        </Card>
      </div>
    </div>
  );
}

function GroupCard({ group, rank }: { group: OverviewGroup; rank: number }) {
  // present-by-score desc, absent to the bottom
  const members = group.members
    .slice()
    .sort((a, b) => ((a.absent ? -99 : a.score) < (b.absent ? -99 : b.score) ? 1 : -1));
  return (
    <div style={{ background: '#fff', border: '1px solid #e7e9ee', borderRadius: 13, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '11px 14px',
          borderBottom: '1px solid #f1f3f6',
          background: '#fafbfc',
        }}
      >
        <span
          className="mono"
          style={{
            width: 22,
            height: 22,
            borderRadius: 7,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
            ...(rank === 1 ? { background: '#2fb457', color: '#fff' } : { background: '#eef1f5', color: '#7a828f' }),
          }}
        >
          {rank}
        </span>
        <span style={{ fontSize: 16 }}>{group.emoji}</span>
        <span style={{ fontWeight: 700, fontSize: 14.5, color: '#1e2430' }}>{group.name}</span>
        <span
          className="mono"
          style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 19, color: rank === 1 ? '#2c8a4f' : '#1e2430' }}
        >
          +{group.score}
        </span>
      </div>
      <div style={{ padding: '7px 8px 8px' }}>
        {members.map((m) => {
          const scoreText = m.absent ? '—' : m.score > 0 ? `+${m.score}` : m.score < 0 ? `${m.score}` : '±0';
          const scoreColor = m.absent ? '#c6ccd4' : m.score > 0 ? '#2c8a4f' : m.score < 0 ? '#c14a4a' : '#9aa1ac';
          return (
            <div
              key={m.name}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 7px', borderRadius: 8 }}
            >
              <div style={avatarStyle(m.name, 26)}>{initial(m.name)}</div>
              <span
                style={{
                  fontWeight: 600,
                  fontSize: 13.5,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                  color: m.absent ? '#a6adb8' : '#1e2430',
                }}
              >
                {m.name}
              </span>
              {m.absent && (
                <span
                  style={{
                    flexShrink: 0,
                    padding: '1px 6px',
                    borderRadius: 5,
                    fontSize: 10,
                    fontWeight: 600,
                    background: '#fdeeee',
                    color: '#c14a4a',
                  }}
                >
                  缺
                </span>
              )}
              <span className="mono" style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 13.5, color: scoreColor }}>
                {scoreText}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
