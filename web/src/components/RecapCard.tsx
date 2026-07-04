import type { CSSProperties } from 'react';
import type { Recap } from '../lib/api';
import {
  dateLabel,
  fmtDurationCn,
  fmtSigned,
  groupBars,
  homeworkTone,
  recitationTone,
  toneColor,
  type RecapPersonal,
} from '../lib/recapCard';

// 课堂战报卡片，还原设计稿「Recap 页面.dc.html」（390 宽移动端画板）。
// personal 不传 = 非个人模式：隐藏「个人表现」卡，其余部分一致。

const BALOO = "'Baloo 2', 'Nunito', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif";

const card: CSSProperties = {
  background: '#ffffff',
  borderRadius: 20,
  padding: 16,
  border: '1px solid #ece5d4',
  boxShadow: '0 6px 18px rgba(120,95,40,.06)',
};

const chip = (bg: string, border: string, color: string): CSSProperties => ({
  padding: '6px 12px',
  borderRadius: 999,
  background: bg,
  border: `1px solid ${border}`,
  fontWeight: 800,
  fontSize: 12,
  color,
});

export function RecapCard({
  recap,
  className,
  year,
  personal,
}: {
  recap: Recap;
  className: string;
  year?: string | null;
  personal?: RecapPersonal | null;
}) {
  const bars = groupBars(recap.groups);
  return (
    <div
      style={{
        width: '100%',
        background: '#faf7f0',
        color: '#3a3628',
        fontFamily: "'Nunito', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
        display: 'flex',
        flexDirection: 'column',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {/* 头部 */}
      <div
        style={{
          padding: '32px 22px 20px',
          background: 'radial-gradient(120% 100% at 50% 0%, #fdf3da 0%, #faf7f0 75%)',
          textAlign: 'center',
          borderBottom: '1px solid #f0e8d5',
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 12, letterSpacing: 3, color: '#a89a72' }}>
          {className} · {dateLabel(year, recap.date)}
        </div>
        <div style={{ marginTop: 8, fontFamily: BALOO, fontWeight: 800, fontSize: 26, color: '#a87f24' }}>
          🏆 {recap.lessonNumber != null ? `Lesson ${recap.lessonNumber} ` : ''}课堂战报
        </div>
        {recap.lessonTitle && (
          <div style={{ marginTop: 5, fontWeight: 800, fontSize: 13, color: '#8a7f63' }}>{recap.lessonTitle}</div>
        )}
        <div style={{ marginTop: 6, fontWeight: 700, fontSize: 12, color: '#a89a72' }}>
          时长 {fmtDurationCn(recap.actualDurationMin)} · {recap.attendancePresent}人到课
        </div>
      </div>

      <div style={{ padding: '6px 16px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 各组得分（领奖台） */}
        {bars.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 6px 0' }}>
            {bars.map((b) => (
              <div key={b.name} style={{ flex: b.winner ? 1.15 : 1, textAlign: 'center', minWidth: 0 }}>
                <div style={{ fontSize: b.winner ? 26 : 22 }}>{b.emoji}</div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 12,
                    margin: '4px 0',
                    color: b.winner ? '#a87f24' : '#6b6350',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {b.name}
                </div>
                <div
                  style={{
                    height: b.height,
                    borderRadius: '12px 12px 4px 4px',
                    background: b.winner ? 'linear-gradient(180deg, #eecf7c, #cda23f)' : '#efe9db',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: BALOO,
                    fontWeight: 800,
                    fontSize: b.winner ? 26 : 19,
                    color: b.winner ? '#4a3808' : '#8a7f63',
                  }}
                >
                  {b.score}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 个人卡（仅个人模式） */}
        {personal && <PersonalCard p={personal} />}

        {/* 今日之星与老师提醒 */}
        <div style={card}>
          <div style={{ fontWeight: 900, fontSize: 14, color: '#a87f24', marginBottom: 10 }}>🌟 今日之星</div>
          {recap.stars.length === 0 ? (
            <div style={{ fontWeight: 700, fontSize: 12, color: '#b5ab8e' }}>本节暂无 · 下节课争取上榜！</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {recap.stars.map((s) => (
                <span key={s.name} style={chip('#fdf3da', '#e8d193', '#8f6b16')}>
                  {s.name} +{s.net}
                </span>
              ))}
            </div>
          )}
          <div style={{ fontWeight: 900, fontSize: 14, color: '#b5645c', margin: '14px 0 10px' }}>💬 老师提醒</div>
          {recap.warned.length === 0 ? (
            <div style={{ fontWeight: 700, fontSize: 12, color: '#b5ab8e' }}>本节无人被提醒，全班表现棒极了 ✓</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {recap.warned.map((w) => (
                <span key={w.name} style={chip('#fbeeec', '#e8bcb6', '#a04a42')}>
                  {w.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PersonalCard({ p }: { p: RecapPersonal }) {
  const scoreColor = p.personalScore > 0 ? '#b8891f' : p.personalScore < 0 ? '#a04a42' : '#8a7f63';
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: '#efe9db',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: 18,
            color: '#8a7f63',
            border: '2.5px solid #d9b45a',
            flexShrink: 0,
          }}
        >
          {p.name[0]}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 17, color: '#3a3628', whiteSpace: 'nowrap' }}>
            {p.name}{' '}
            {p.groupName && (
              <span style={{ fontSize: 12, color: '#a89a72', fontWeight: 700 }}>
                {p.groupEmoji} {p.groupName}
              </span>
            )}
          </div>
          <div style={{ fontWeight: 700, fontSize: 12, color: '#a89a72', marginTop: 2, whiteSpace: 'nowrap' }}>
            {p.attended ? '到课 ✓ · 本节表现' : '本节缺席'}
          </div>
        </div>
        {p.attended && (
          <div style={{ marginLeft: 'auto', fontFamily: BALOO, fontWeight: 800, fontSize: 26, color: scoreColor }}>
            {fmtSigned(p.personalScore)}
          </div>
        )}
      </div>
      {p.attended && (
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <StatusCell icon="📖" label={`背书 · ${p.recitation}`} color={toneColor(recitationTone(p.recitation))} />
          <StatusCell icon="📝" label={`作业 · ${p.homework}`} color={toneColor(homeworkTone(p.homework))} />
        </div>
      )}
    </div>
  );
}

function StatusCell({ icon, label, color }: { icon: string; label: string; color: string }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 12,
        background: '#f7f3e9',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span style={{ fontSize: 15 }}>{icon}</span>
      <div style={{ fontWeight: 800, fontSize: 13, color, whiteSpace: 'nowrap' }}>{label}</div>
    </div>
  );
}
