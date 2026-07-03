import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import { api, type Me, type ProfileSession, type StudentProfile as Profile } from '../lib/api';
import { barGeometry, netColor, netLabel, type BarGeom } from '../lib/profile';
import { avatarStyle, GREEN, initial, sourceTag, statusTag } from '../lib/theme';

// ---------------------------------------------------------------------------
// 学生成长档案 (§7.4)：头部指标 + 「课堂表现」矩阵（横轴=课次、纵轴=维度）。
// 矩阵取代了设计稿里的独立趋势图与每节课明细表——得分行内嵌 mini 柱条承担趋势，
// 时间从左到右（旧 → 新），列多时横向滚动并默认停在最新一课。
// ---------------------------------------------------------------------------

export function StudentProfile({ me }: { me: Me | null }) {
  const { id = '', sid = '' } = useParams();
  const [p, setP] = useState<Profile | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    api
      .getStudentProfile(sid)
      .then(setP)
      .catch(() => setFailed(true));
  }, [sid]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar me={me} active="classes" />
      <div style={{ width: '100%', maxWidth: 1088, margin: '0 auto', padding: '22px 26px 64px' }}>
        <Link
          to={`/classes/${p?.class.id ?? id}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: '#7a828f',
            textDecoration: 'none',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 14,
          }}
        >
          <span style={{ fontSize: 14 }}>←</span>返回 {p?.class.name ?? '班级'}
        </Link>

        {failed && (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: '#9aa1ac', fontSize: 13.5 }}>
            学生不存在或已被删除
          </div>
        )}
        {p && (
          <>
            <Header p={p} />
            <Tiles p={p} />
            {p.sessions.length === 0 ? <Empty /> : <Matrix sessions={p.sessions} />}
          </>
        )}
      </div>
    </div>
  );
}

// ---- header card ------------------------------------------------------------

function badge(t: { label: string; color: string; bg: string }) {
  return (
    <span
      style={{ fontSize: 11, fontWeight: 600, color: t.color, background: t.bg, padding: '3px 9px', borderRadius: 6 }}
    >
      {t.label}
    </span>
  );
}

function Header({ p }: { p: Profile }) {
  const s = p.student;
  const sTag = statusTag(s.status);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 17,
        background: '#fff',
        border: '1px solid #e7e9ee',
        borderRadius: 14,
        padding: '19px 22px',
        marginBottom: 13,
      }}
    >
      <div style={{ ...avatarStyle(s.id, 62, s.photoUrl != null), fontSize: 26 }}>{initial(s.name)}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-.3px' }}>{s.name}</h1>
          {badge(sourceTag(s.source))}
          {sTag && badge(sTag)}
        </div>
        <div style={{ marginTop: 7, fontSize: 13.5, color: '#7a828f', whiteSpace: 'nowrap' }}>
          {p.class.name} · {p.currentGroup ? `${p.currentGroup.emoji ?? ''} ${p.currentGroup.name}`.trim() : '未分组'} ·
          已上课{' '}
          <span className="mono" style={{ fontWeight: 600, color: '#5b6472' }}>
            {p.totals.attended}
          </span>{' '}
          节
        </div>
      </div>
    </div>
  );
}

// ---- metric tiles -------------------------------------------------------------

const tileStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #e7e9ee',
  borderRadius: 12,
  padding: '15px 17px',
};
const tileLabel: CSSProperties = { fontSize: 12, color: '#7a828f', fontWeight: 600 };
const tileValue: CSSProperties = { fontWeight: 600, fontSize: 27, marginTop: 7 };

function Tiles({ p }: { p: Profile }) {
  const t = p.totals;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
      <div style={tileStyle}>
        <div style={tileLabel}>已上课</div>
        <div className="mono" style={{ ...tileValue, color: '#1e2430' }}>
          {t.attended} <span style={{ fontSize: 14, color: '#9aa1ac', fontWeight: 500 }}>节</span>
        </div>
      </div>
      <div style={tileStyle}>
        <div style={tileLabel}>个人总分</div>
        <div className="mono" style={{ ...tileValue, color: GREEN }}>
          {t.personalTotal}
        </div>
        <div style={{ fontSize: 10.5, color: '#aab1bc', marginTop: 4 }}>只统计个人事件，不含组分</div>
      </div>
      <div style={tileStyle}>
        <div style={tileLabel}>累计加星</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 7 }}>
          <span style={{ color: '#f2a83a', fontSize: 18 }}>★</span>
          <span className="mono" style={{ fontWeight: 600, fontSize: 27, color: '#2c8a4f' }}>
            {t.plus}
          </span>
        </div>
      </div>
      <div style={tileStyle}>
        <div style={tileLabel}>累计扣分</div>
        <div className="mono" style={{ ...tileValue, color: t.minus > 0 ? '#c14a4a' : '#9aa1ac' }}>
          {t.minus > 0 ? `−${t.minus}` : '0'}
        </div>
      </div>
    </div>
  );
}

// ---- empty state ----------------------------------------------------------------

function Empty() {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e7e9ee',
        borderRadius: 14,
        padding: '60px 20px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: '#5b6472', marginBottom: 6 }}>还没有上课记录</div>
      <div style={{ fontSize: 13, color: '#9aa1ac', lineHeight: 1.8 }}>
        该学生尚未参与任何课堂。
        <br />
        下次开始课堂后，这里会按课次记录出勤、背书、作业与得分。
      </div>
    </div>
  );
}

// ---- performance matrix (the main module) --------------------------------------

const LABEL_W = 116;
const COL_W = 92;
const BAR_H = 26;

const pill = (fg: string, bg: string, border: string): CSSProperties => ({
  display: 'inline-block',
  fontSize: 11.5,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 6,
  color: fg,
  background: bg,
  border: `1px solid ${border}`,
  whiteSpace: 'nowrap',
});

const PILL = {
  green: pill('#2c8a4f', '#eef8f1', '#cfe9d5'),
  yellow: pill('#a5791a', '#fbf3e0', '#f0dfb0'),
  red: pill('#c14a4a', '#fdeeee', '#f2cfcf'),
  gray: pill('#7a828f', '#f0f2f5', '#e4e7ec'),
};

const recitePill = (v: string) =>
  v === '已背完' ? PILL.green : v === '背完部分' ? PILL.yellow : v === '没背' ? PILL.red : PILL.gray;

function Dash({ hint }: { hint?: string }) {
  return (
    <span title={hint} style={{ color: '#c0c6cf', fontSize: 13 }}>
      —
    </span>
  );
}

/** A matrix cell for one dimension: 缺席/未入班 collapse to a dash. */
function cell(s: ProfileSession, render: (mine: NonNullable<ProfileSession['mine']>) => ReactNode): ReactNode {
  if (!s.mine) return <Dash hint="当时未入班" />;
  if (!s.mine.attended) return <Dash hint="缺席" />;
  return render(s.mine);
}

function Matrix({ sessions }: { sessions: ProfileSession[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  // 时间从左到右，默认停在最新一课
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [sessions]);

  const geom = barGeometry(
    sessions.map((s) => (s.mine && s.mine.attended ? s.mine.personalScore : null)),
    BAR_H,
  );

  const labelCell = (label: string): ReactNode => (
    <div
      style={{
        position: 'sticky',
        left: 0,
        zIndex: 1,
        width: LABEL_W,
        flexShrink: 0,
        background: '#fff',
        padding: '0 18px',
        display: 'flex',
        alignItems: 'center',
        fontWeight: 600,
        fontSize: 13,
        color: '#5b6472',
        borderRight: '1px solid #eef0f3',
      }}
    >
      {label}
    </div>
  );

  const row = (label: string, minHeight: number, renderCell: (s: ProfileSession, i: number) => ReactNode) => (
    <div style={{ display: 'flex', minHeight, borderBottom: '1px solid #f1f3f6' }}>
      {labelCell(label)}
      {sessions.map((s, i) => (
        <div
          key={s.id}
          style={{
            width: COL_W,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 4px',
          }}
        >
          {renderCell(s, i)}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ background: '#fff', border: '1px solid #e7e9ee', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '18px 22px 14px' }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>课堂表现</div>
        <div style={{ fontSize: 12.5, color: '#7a828f', marginTop: 3 }}>
          按课次时间从左到右 · 得分为个人净分（加星 − 扣分，不含组分）
        </div>
      </div>
      <div ref={scroller} style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: LABEL_W + sessions.length * COL_W }}>
          {/* column headers */}
          <div
            style={{
              display: 'flex',
              background: '#fafbfc',
              borderTop: '1px solid #eef0f3',
              borderBottom: '1px solid #eef0f3',
            }}
          >
            <div
              className="mono"
              style={{
                position: 'sticky',
                left: 0,
                zIndex: 1,
                width: LABEL_W,
                flexShrink: 0,
                background: '#fafbfc',
                padding: '9px 18px',
                fontSize: 10.5,
                letterSpacing: '.6px',
                color: '#a6adb8',
                borderRight: '1px solid #eef0f3',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              课次
            </div>
            {sessions.map((s) => (
              <div
                key={s.id}
                title={s.lessonTitle ?? undefined}
                style={{ width: COL_W, flexShrink: 0, padding: '7px 4px', textAlign: 'center' }}
              >
                <div className="mono" style={{ fontWeight: 600, fontSize: 12.5, color: '#1e2430' }}>
                  {s.date}
                </div>
                <div style={{ fontSize: 10.5, color: '#a6adb8', marginTop: 1 }}>
                  {s.lessonNumber != null ? `第${s.lessonNumber}课` : s.weekday}
                </div>
              </div>
            ))}
          </div>

          {row('出勤', 44, (s) =>
            s.mine ? (
              s.mine.attended ? (
                <span style={PILL.green}>出勤</span>
              ) : (
                <span style={PILL.red}>缺席</span>
              )
            ) : (
              <Dash hint="当时未入班" />
            ),
          )}
          {row('背书', 44, (s) => cell(s, (m) => <span style={recitePill(m.recitation)}>{m.recitation}</span>))}
          {row('作业', 44, (s) =>
            cell(s, (m) => <span style={m.homework === '完成' ? PILL.green : PILL.gray}>{m.homework}</span>),
          )}
          {row('课堂得分', 64, (s, i) =>
            cell(s, (m) => (
              <>
                <ScoreBar geom={geom.bars[i]} zero={geom.zero} />
                <span className="mono" style={{ fontWeight: 600, fontSize: 12.5, color: netColor(m.personalScore) }}>
                  {netLabel(m.personalScore)}
                </span>
              </>
            )),
          )}
          {row('所在组', 52, (s) =>
            cell(s, (m) =>
              m.groupName ? (
                <>
                  <div style={{ fontWeight: 600, fontSize: 12, color: '#3c4451', whiteSpace: 'nowrap' }}>
                    {m.groupEmoji} {m.groupName}
                  </div>
                  <span
                    className="mono"
                    style={{
                      marginTop: 3,
                      fontSize: 11,
                      color: '#7a828f',
                      background: '#eef1f5',
                      padding: '1px 7px',
                      borderRadius: 5,
                    }}
                  >
                    组分 {m.groupScore ?? 0}
                  </span>
                </>
              ) : (
                <Dash hint="未分组" />
              ),
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/** The mini trend bar inside a score cell: shared zero line, up green / down red. */
function ScoreBar({ geom, zero }: { geom: BarGeom | null; zero: number }) {
  return (
    <div style={{ position: 'relative', width: 26, height: BAR_H, marginBottom: 3 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: zero, height: 1, background: '#e4e7ec' }} />
      {geom && (
        <div
          style={{
            position: 'absolute',
            left: 9,
            width: 8,
            bottom: geom.bottom,
            height: geom.height,
            borderRadius: 3,
            background: geom.positive ? GREEN : '#d94b4b',
          }}
        />
      )}
    </div>
  );
}
