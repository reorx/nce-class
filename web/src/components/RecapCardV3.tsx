import type { CSSProperties } from 'react';
import type { Recap } from '../lib/api';
import { dateLabel, fmtSigned } from '../lib/recapCard';
import {
  groupCards,
  podiumNameLines,
  podiumTiers,
  scoreColor,
  statSections,
  ungroupedNote,
  type ChipTone,
  type MemberRow,
  type PodiumTier,
} from '../lib/recapV3';

// 课堂报告 v3，还原设计稿「Recap v3.dc.html」（414 宽移动端画板）：
// 今日之星领奖台 + 各组成员明细表 + 分类统计 + 课后作业。
// showScores=false 时隐藏所有分数（领奖台奖牌与名次保留）；
// showRecitation / showHomework=false 时对应的明细列与分类统计分区整体不出现。

const BALOO = "'Baloo 2', 'Nunito', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif";

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 20,
  border: '1px solid #ece5d4',
  boxShadow: '0 6px 18px rgba(120,95,40,.06)',
};

const CHIP_TONES: Record<ChipTone, { bg: string; border: string; tagFg: string }> = {
  red: { bg: '#fbeeec', border: '#e8bcb6', tagFg: '#c4554d' },
  amber: { bg: '#fdf6e3', border: '#ecd9a0', tagFg: '#b07d16' },
  gray: { bg: '#f2efe6', border: '#e0d8c2', tagFg: '#a89a72' },
};

function SectionHead({ icon, title, hint }: { icon: string; title: string; hint: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '9px 2px 1px' }}>
      <span style={{ fontSize: 17 }}>{icon}</span>
      <span style={{ fontWeight: 900, fontSize: 16, color: '#3a3628' }}>{title}</span>
      <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 12, color: '#a89a72', whiteSpace: 'nowrap' }}>
        {hint}
      </span>
    </div>
  );
}

export function RecapCardV3({
  recap,
  className,
  year,
  homework,
  showScores = true,
  showRecitation = true,
  showHomework = true,
}: {
  recap: Recap;
  className: string;
  year?: string | null;
  homework?: string | null;
  showScores?: boolean;
  showRecitation?: boolean;
  showHomework?: boolean;
}) {
  const tiers = podiumTiers(recap);
  const cards = groupCards(recap);
  const noGroupNote = ungroupedNote(recap);
  const stats = statSections(recap, { showRecitation, showHomework });
  const hwText = (homework ?? '').trim();

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
          padding: '30px 22px 22px',
          background: 'radial-gradient(130% 100% at 50% 0%, #fdf3da 0%, #faf7f0 72%)',
          textAlign: 'center',
          borderBottom: '1px solid #f0e8d5',
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 12, letterSpacing: 3, color: '#a89a72' }}>
          {className} · {dateLabel(year, recap.date)}
        </div>
        <div style={{ marginTop: 9, fontFamily: BALOO, fontWeight: 800, fontSize: 27, color: '#a87f24' }}>
          🏆 {recap.lessonNumber != null ? `Lesson ${recap.lessonNumber} ` : ''}课堂报告
        </div>
        {recap.lessonTitle && (
          <div style={{ marginTop: 5, fontWeight: 700, fontSize: 14, color: '#8a7f63' }}>{recap.lessonTitle}</div>
        )}
      </div>

      <div style={{ padding: '16px 15px 8px', display: 'flex', flexDirection: 'column', gap: 15 }}>
        {/* 今日之星 */}
        <SectionHead icon="🌟" title="今日之星" hint="本节课表现最棒的三位" />
        <div style={{ ...card, borderRadius: 22, padding: '20px 16px 18px' }}>
          {tiers.length === 0 ? (
            <div style={{ fontWeight: 700, fontSize: 13, color: '#b5ab8e', textAlign: 'center' }}>
              本节暂无 · 下节课争取上榜！
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
              {tiers.map((t) => (
                <PodiumSlot key={t.rank} tier={t} showScores={showScores} />
              ))}
            </div>
          )}
          {recap.studentTags.length > 0 && (
            <div
              style={{
                marginTop: tiers.length === 0 ? 14 : 18,
                paddingTop: 14,
                borderTop: '1.5px solid #f0e8d5',
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 13, color: '#8f6b16', marginBottom: 9 }}>🏅 今日奖章</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {recap.studentTags.map((s) => (
                  <span
                    key={s.name}
                    style={{
                      padding: '5px 11px',
                      borderRadius: 12,
                      background: '#fdf3da',
                      border: '1px solid #e8d193',
                      fontWeight: 800,
                      fontSize: 12.5,
                      color: '#8f6b16',
                    }}
                  >
                    {s.name} · {s.tags.join('、')}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 各组详细表现 */}
        {cards.length > 0 && <SectionHead icon="📋" title="各组详细表现" hint="按小组得分排序" />}
        {cards.map((g) => (
          <div key={g.name} style={{ ...card, overflow: 'hidden' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '13px 15px',
                background: g.palette.headBg,
              }}
            >
              {g.emoji && <span style={{ fontSize: 24, lineHeight: 1 }}>{g.emoji}</span>}
              <span style={{ fontWeight: 900, fontSize: 17, color: g.palette.headFg }}>{g.name}</span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '3px 9px',
                  borderRadius: 9,
                  background: 'rgba(255,255,255,.72)',
                  color: g.palette.headFg,
                  fontWeight: 800,
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                }}
              >
                {g.medal ? `${g.medal} ` : ''}
                {g.rankLabel}
              </span>
              {showScores && (
                <div
                  style={{
                    marginLeft: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    fontFamily: BALOO,
                    fontWeight: 800,
                    fontSize: 22,
                    lineHeight: 1,
                    color: g.palette.headFg,
                  }}
                >
                  <span style={{ fontSize: 15 }}>⭐</span>
                  {g.score}
                </div>
              )}
            </div>
            <div style={{ padding: '4px 14px 10px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '9px 2px 8px',
                  borderBottom: '1.5px solid #f0e8d5',
                }}
              >
                <ColHead style={{ flex: 1 }}>学生</ColHead>
                {showScores && <ColHead style={{ width: 40, textAlign: 'center' }}>得分</ColHead>}
                {showRecitation && <ColHead style={{ width: 72 }}>背书</ColHead>}
                {showHomework && <ColHead style={{ width: 52 }}>作业</ColHead>}
              </div>
              {g.members.map((m, idx) => (
                <MemberLine
                  key={m.name + idx}
                  m={m}
                  last={idx === g.members.length - 1}
                  showScores={showScores}
                  showRecitation={showRecitation}
                  showHomework={showHomework}
                />
              ))}
              {g.absentText && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '9px 2px 3px',
                    fontWeight: 700,
                    fontSize: 12,
                    color: '#b3a678',
                  }}
                >
                  <span style={{ fontSize: 13 }}>🚪</span>
                  {g.absentText}
                </div>
              )}
            </div>
          </div>
        ))}
        {noGroupNote && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              margin: '-6px 4px 0',
              fontWeight: 700,
              fontSize: 12,
              color: '#b3a678',
            }}
          >
            <span style={{ fontSize: 13 }}>🚪</span>
            {noGroupNote}
          </div>
        )}

        {/* 分类统计 */}
        <SectionHead icon="🔍" title="分类统计" hint="需要关注的同学" />
        <div style={{ ...card, padding: '6px 16px' }}>
          {stats.map((t, i) => (
            <div
              key={t.title}
              style={{ padding: '15px 0 16px', borderBottom: i < stats.length - 1 ? '1.5px solid #f0e8d5' : 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: t.chips.length ? 11 : 0 }}>
                <span style={{ fontSize: 16 }}>{t.icon}</span>
                <span style={{ fontWeight: 900, fontSize: 14.5, color: '#3a3628' }}>{t.title}</span>
                <span
                  style={{
                    padding: '2px 9px',
                    borderRadius: 9,
                    background: t.chips.length ? '#fbeeec' : '#eaf3ea',
                    color: t.chips.length ? '#c4554d' : '#3a7a4e',
                    fontWeight: 800,
                    fontSize: 11.5,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {t.countLabel}
                </span>
                <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 11, color: '#c2b48f' }}>{t.hint}</span>
              </div>
              {t.chips.length === 0 ? (
                <div style={{ fontWeight: 700, fontSize: 13, color: '#3a7a4e', padding: '10px 1px 2px' }}>
                  {t.emptyText}
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {t.chips.map((c, ci) => {
                    const tone = CHIP_TONES[c.tone];
                    return (
                      <div
                        key={c.name + ci}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 7,
                          padding: '6px 10px 6px 9px',
                          borderRadius: 12,
                          background: tone.bg,
                          border: `1px solid ${tone.border}`,
                        }}
                      >
                        {c.groupEmoji && <span style={{ fontSize: 14, lineHeight: 1 }}>{c.groupEmoji}</span>}
                        <span style={{ fontWeight: 800, fontSize: 13.5, color: '#3a3628', whiteSpace: 'nowrap' }}>
                          {c.name}
                        </span>
                        <span
                          style={{
                            fontWeight: 800,
                            fontSize: 11,
                            color: tone.tagFg,
                            background: 'rgba(255,255,255,.75)',
                            borderRadius: 7,
                            padding: '2px 7px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.tag}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 今日课后作业 */}
        {hwText.length > 0 && (
          <>
            <SectionHead icon="📝" title="今日课后作业" hint="请家长协助完成 ✍️" />
            <div style={{ ...card, padding: 14 }}>
              <div
                style={{
                  whiteSpace: 'pre-wrap',
                  fontWeight: 700,
                  fontSize: 14.5,
                  lineHeight: '28px',
                  color: '#4a4433',
                  backgroundColor: '#fffdf4',
                  backgroundImage:
                    'linear-gradient(to right, rgba(196,170,110,.22) 1px, transparent 1px), linear-gradient(to bottom, rgba(196,170,110,.22) 1px, transparent 1px)',
                  backgroundSize: '28px 28px',
                  border: '1.5px solid #ecd9a0',
                  borderRadius: 12,
                  padding: '12px 16px',
                  overflowWrap: 'break-word',
                }}
              >
                {hwText}
              </div>
            </div>
          </>
        )}
      </div>

      <div
        style={{
          textAlign: 'center',
          padding: '12px 20px 20px',
          fontWeight: 700,
          fontSize: 11,
          color: '#c2b48f',
          lineHeight: 1.6,
        }}
      >
        本报告由老师在课堂结束时一键生成 · NCE Class
      </div>
    </div>
  );
}

function ColHead({ children, style }: { children: string; style?: CSSProperties }) {
  return (
    <span style={{ fontWeight: 800, fontSize: 11, letterSpacing: 1, color: '#b3a678', ...style }}>{children}</span>
  );
}

function MemberLine({
  m,
  last,
  showScores,
  showRecitation,
  showHomework,
}: {
  m: MemberRow;
  last: boolean;
  showScores: boolean;
  showRecitation: boolean;
  showHomework: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 2px',
        borderBottom: last ? 'none' : '1px dashed #f0e8d5',
      }}
    >
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: '#efe9db',
            color: '#8a7f63',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: 13,
            flexShrink: 0,
            border: `2px solid ${m.ring}`,
          }}
        >
          {m.name[0]}
        </div>
        <span
          style={{
            fontWeight: 800,
            fontSize: 15,
            color: '#3a3628',
            overflowWrap: 'break-word',
            minWidth: 0,
          }}
        >
          {m.name}
        </span>
        {m.warns > 0 && (
          <span
            style={{
              flexShrink: 0,
              fontWeight: 800,
              fontSize: 10.5,
              color: '#c4554d',
              background: '#fbeeec',
              border: '1px solid #e8bcb6',
              borderRadius: 7,
              padding: '1.5px 6px',
              whiteSpace: 'nowrap',
            }}
          >
            ⚠ ×{m.warns}
          </span>
        )}
      </div>
      {showScores && (
        <span
          style={{
            width: 40,
            textAlign: 'center',
            fontFamily: BALOO,
            fontWeight: 800,
            fontSize: 17,
            lineHeight: 1,
            color: scoreColor(m.score),
          }}
        >
          {fmtSigned(m.score)}
        </span>
      )}
      {showRecitation && (
        <StatusCell width={72} dot={m.recitation.dot} color={m.recitation.color} text={m.recitation.text} />
      )}
      {showHomework && <StatusCell width={52} dot={m.homework.dot} color={m.homework.color} text={m.homework.text} />}
    </div>
  );
}

function StatusCell({ width, dot, color, text }: { width: number; dot: string; color: string; text: string }) {
  return (
    <div style={{ width, display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <span style={{ fontWeight: 800, fontSize: 12, color, whiteSpace: 'nowrap' }}>{text}</span>
    </div>
  );
}

function PodiumSlot({ tier, showScores }: { tier: PodiumTier; showScores: boolean }) {
  const first = tier.rank === 0;
  const solo = tier.members.length === 1;
  const avSize = first ? 62 : 48;
  const barH = tier.rank === 0 ? 78 : tier.rank === 1 ? 56 : 44;
  return (
    <div
      style={{ flex: first ? 1.18 : 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}
    >
      <div style={{ height: 26, fontSize: 22, lineHeight: '26px' }}>{first ? '👑' : ''}</div>
      {solo ? (
        <>
          <div style={{ position: 'relative', width: avSize, height: avSize, marginTop: 2 }}>
            <div
              style={{
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                background: '#efe9db',
                color: '#8a7f63',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: first ? 24 : 18,
                border: `3px solid ${tier.members[0].ring}`,
              }}
            >
              {tier.members[0].name[0]}
            </div>
            {tier.members[0].groupEmoji && (
              <span style={{ position: 'absolute', bottom: -3, right: -6, fontSize: 17, lineHeight: 1 }}>
                {tier.members[0].groupEmoji}
              </span>
            )}
          </div>
          <div
            style={{
              marginTop: 8,
              fontWeight: 900,
              fontSize: first ? 17 : 15,
              color: '#3a3628',
              textAlign: 'center',
              overflowWrap: 'break-word',
              maxWidth: '100%',
            }}
          >
            {tier.members[0].name}
          </div>
          <div style={{ margin: '2px 0 8px', fontWeight: 700, fontSize: 11, color: '#a89a72', whiteSpace: 'nowrap' }}>
            {tier.members[0].groupName ?? '未分组'}
          </div>
        </>
      ) : (
        // 同分多人：不画头像，只按行列出名字
        <div
          style={{
            marginTop: 2,
            marginBottom: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 3,
            maxWidth: '100%',
          }}
        >
          {(() => {
            const { names, overflow } = podiumNameLines(tier.members.map((m) => m.name));
            return (
              <>
                {names.map((name) => (
                  <div
                    key={name}
                    style={{
                      fontWeight: 900,
                      fontSize: first ? 16 : 14,
                      color: '#3a3628',
                      textAlign: 'center',
                      overflowWrap: 'break-word',
                      maxWidth: '100%',
                    }}
                  >
                    {name}
                  </div>
                ))}
                {overflow && (
                  <div style={{ fontWeight: 700, fontSize: first ? 13 : 12, color: '#a89a72' }}>{overflow}</div>
                )}
              </>
            );
          })()}
        </div>
      )}
      <div
        style={{
          width: '100%',
          height: barH,
          borderRadius: '13px 13px 5px 5px',
          background: first ? 'linear-gradient(180deg, #eecf7c, #cda23f)' : '#efe9db',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 15, lineHeight: 1 }}>{['🥇', '🥈', '🥉'][tier.rank]}</span>
        {showScores && (
          <span
            style={{
              fontFamily: BALOO,
              fontWeight: 800,
              fontSize: first ? 24 : 17,
              lineHeight: 1.1,
              color: first ? '#4a3808' : '#8a7f63',
            }}
          >
            {fmtSigned(tier.score)}
          </span>
        )}
      </div>
    </div>
  );
}
