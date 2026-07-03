import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Modal } from '../components/Modal';
import { TopBar } from '../components/TopBar';
import { useToast } from '../components/Toast';
import {
  api,
  type ClassDetail as Detail,
  type JoinRequestItem,
  type Me,
  type Recap,
  type Session,
  type Student,
} from '../lib/api';
import {
  addGroup,
  moveStudent,
  removeGroup,
  renameGroup,
  toModel,
  toPayload,
  type GroupingModel,
} from '../lib/grouping';
import { avatarStyle, GREEN, initial, sourceTag, statusTag } from '../lib/theme';

type Tab = 'students' | 'groups' | 'invite' | 'sessions';
const TABS: Tab[] = ['students', 'groups', 'invite', 'sessions'];

export function ClassDetail({ me }: { me: Me | null }) {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [d, setD] = useState<Detail | null>(null);
  const tab = (params.get('tab') as Tab) || 'students';
  const setTab = (t: Tab) => setParams(t === 'students' ? {} : { tab: t }, { replace: true });

  const reload = () =>
    api
      .classDetail(id)
      .then(setD)
      .catch(() => {});

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar me={me} active="classes" />
      <div style={{ width: '100%', maxWidth: 1140, margin: '0 auto', padding: '22px 26px 64px' }}>
        <Link
          to="/"
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
          <span style={{ fontSize: 14 }}>←</span>返回班级
        </Link>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-.3px' }}>{d?.name ?? ' '}</h1>
              {d?.level && (
                <span
                  className="mono"
                  style={{ fontSize: 12, color: '#7a828f', background: '#f0f2f5', padding: '3px 9px', borderRadius: 7 }}
                >
                  {d.level}
                </span>
              )}
            </div>
            <div style={{ marginTop: 8, fontSize: 13.5, color: '#7a828f', whiteSpace: 'nowrap' }}>
              {d?.studentCount ?? 0} 名学生 · {d?.groupCount ?? 0} 个分组 · 负责老师 {d?.teacherName ?? ''}
            </div>
          </div>
          <Link
            to={`/classes/${id}/setup`}
            style={{
              marginLeft: 'auto',
              height: 40,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 20px',
              background: GREEN,
              color: '#fff',
              borderRadius: 10,
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 14.5,
              boxShadow: '0 3px 10px rgba(47,180,87,.24)',
            }}
          >
            <span style={{ fontSize: 9 }}>▶</span>开始上课
          </Link>
        </div>

        <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #ebedf1', marginBottom: 22 }}>
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} style={tabStyle(tab === t)}>
              {tabLabel(t)}
              {t === 'students' && <TabCount n={d?.studentCount} />}
              {t === 'sessions' && <TabCount n={d?.sessionCount} />}
            </button>
          ))}
        </div>

        {d && tab === 'students' && <StudentsTab d={d} reload={reload} />}
        {d && tab === 'groups' && <GroupsTab d={d} reload={reload} />}
        {d && tab === 'invite' && <InviteTab d={d} />}
        {d && tab === 'sessions' && <SessionsTab d={d} reload={reload} />}
      </div>
    </div>
  );
}

function TabCount({ n }: { n?: number }) {
  return (
    <span className="mono" style={{ fontSize: 12, color: '#aab1bc' }}>
      {n ?? ''}
    </span>
  );
}
const tabLabel = (t: Tab) => ({ students: '学生', groups: '分组方案', invite: '邀请家长', sessions: '上课记录' })[t];
const tabStyle = (active: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  padding: '11px 15px 12px',
  border: 'none',
  background: 'transparent',
  fontWeight: 600,
  fontSize: 14.5,
  cursor: 'pointer',
  marginBottom: -1,
  borderBottom: `2px solid ${active ? '#2fb457' : 'transparent'}`,
  color: active ? '#1e2430' : '#7a828f',
});

const fieldStyle: CSSProperties = {
  width: '100%',
  height: 40,
  padding: '0 12px',
  border: '1px solid #e2e5ea',
  borderRadius: 9,
  fontSize: 14,
  color: '#1e2430',
  background: '#fbfcfd',
};
const primaryBtn: CSSProperties = {
  height: 40,
  padding: '0 18px',
  background: GREEN,
  color: '#fff',
  border: 'none',
  borderRadius: 9,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
const ghostBtn: CSSProperties = {
  height: 40,
  padding: '0 18px',
  background: '#fff',
  color: '#5b6472',
  border: '1px solid #e2e5ea',
  borderRadius: 9,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};

// ===== STUDENTS TAB ========================================================
function StudentsTab({ d, reload }: { d: Detail; reload: () => Promise<void> | void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'parent' | 'teacher'>('all');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Student | null>(null);
  const [pendingArchive, setPendingArchive] = useState<Student | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const archivedCount = useMemo(() => d.students.filter((s) => s.status === 'archived').length, [d.students]);
  const archiveMode = showArchived && archivedCount > 0;

  const dupNames = useMemo(() => {
    const byName = new Map<string, number>();
    // archived students are out of the duplicate check (suspended still count)
    d.students.filter((s) => s.status !== 'archived').forEach((s) => byName.set(s.name, (byName.get(s.name) ?? 0) + 1));
    return new Set([...byName].filter(([, n]) => n > 1).map(([n]) => n));
  }, [d.students]);

  const roster = useMemo(() => {
    let list = d.students.filter((s) => (archiveMode ? s.status === 'archived' : s.status !== 'archived'));
    if (filter !== 'all') list = list.filter((s) => s.source === filter);
    if (search.trim()) list = list.filter((s) => s.name.includes(search.trim()));
    list.sort((a, b) => b.score - a.score);
    return list;
  }, [d.students, filter, search, archiveMode]);

  async function submitAdd() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await api.addStudent(d.id, name);
      await reload();
      toast(`已添加「${name}」`);
      setNewName('');
      setAddOpen(false);
    } catch {
      toast('添加失败，请重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || busy) return;
    setBusy(true);
    const name = pendingDelete.name;
    try {
      await api.deleteStudent(pendingDelete.id);
      await reload();
      toast(`已删除「${name}」`);
      setPendingDelete(null);
    } catch {
      toast('删除失败，请重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(s: Student, status: Student['status']) {
    if (busy) return;
    setBusy(true);
    try {
      await api.setStudentStatus(s.id, status);
      await reload();
      if (status === 'suspended') toast(`「${s.name}」已停课，并移出默认分组`);
      else if (status === 'archived') toast(`已归档「${s.name}」`);
      else toast(`「${s.name}」已恢复在读，请到分组方案里拖回小组`);
      setPendingArchive(null);
    } catch {
      toast('操作失败，请重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 36,
            padding: '0 12px',
            background: '#fff',
            border: '1px solid #e7e9ee',
            borderRadius: 9,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#a6adb8"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索学生"
            style={{ border: 'none', background: 'transparent', fontSize: 13, width: 130, color: '#1e2430' }}
          />
        </div>
        <div style={{ display: 'flex', background: '#eef1f5', borderRadius: 9, padding: 3 }}>
          {(
            [
              ['all', '全部'],
              ['parent', '家长自助'],
              ['teacher', '老师添加'],
            ] as const
          ).map(([k, label]) => {
            const on = filter === k;
            return (
              <button
                key={k}
                onClick={() => setFilter(k)}
                style={{
                  padding: '6px 13px',
                  border: 'none',
                  borderRadius: 7,
                  fontWeight: 600,
                  fontSize: 12.5,
                  cursor: 'pointer',
                  background: on ? '#fff' : 'transparent',
                  color: on ? '#1e2430' : '#7a828f',
                  boxShadow: on ? '0 1px 3px rgba(20,28,45,.1)' : 'none',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {archivedCount > 0 && (
          <button
            onClick={() => setShowArchived((v) => !v)}
            style={{
              height: 30,
              padding: '0 13px',
              border: `1px solid ${archiveMode ? '#c8cdd6' : '#e7e9ee'}`,
              borderRadius: 999,
              fontWeight: 600,
              fontSize: 12.5,
              cursor: 'pointer',
              background: archiveMode ? '#eef1f5' : '#fff',
              color: archiveMode ? '#1e2430' : '#7a828f',
            }}
          >
            已归档 {archivedCount}
          </button>
        )}
        <button
          onClick={() => setAddOpen(true)}
          style={{
            marginLeft: 'auto',
            height: 36,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 15px',
            background: GREEN,
            color: '#fff',
            border: 'none',
            borderRadius: 9,
            fontWeight: 600,
            fontSize: 13.5,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(47,180,87,.24)',
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 400, lineHeight: 1 }}>+</span>手动添加学生
        </button>
      </div>

      {dupNames.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '13px 16px',
            background: '#fdf6e7',
            border: '1px solid #f0dcae',
            borderRadius: 11,
            marginBottom: 16,
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#c58a1e"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: '#8a6413' }}>
              发现 {dupNames.size} 组疑似重复学生（{[...dupNames].join('、')}）
            </div>
            <div style={{ fontSize: 12, color: '#a8823a', marginTop: 2 }}>
              家长自助加入可能与老师添加的记录重复，请在卡片右上角 ⋯ → 删除 处理多余的一条。
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(222px,1fr))', gap: 12 }}>
        {roster.map((s) => (
          <StudentCard
            key={s.id}
            s={s}
            dup={dupNames.has(s.name)}
            menuOpen={menuId === s.id}
            onToggleMenu={() => setMenuId((cur) => (cur === s.id ? null : s.id))}
            onCloseMenu={() => setMenuId(null)}
            onView={() => {
              setMenuId(null);
              navigate(`/classes/${d.id}/students/${s.id}`);
            }}
            onSuspend={() => {
              setMenuId(null);
              changeStatus(s, 'suspended');
            }}
            onRestore={() => {
              setMenuId(null);
              changeStatus(s, 'active');
            }}
            onArchive={() => {
              setMenuId(null);
              setPendingArchive(s);
            }}
            onDelete={() => {
              setMenuId(null);
              setPendingDelete(s);
            }}
          />
        ))}
      </div>
      {roster.length === 0 && (
        <div style={{ textAlign: 'center', padding: '56px 20px', color: '#9aa1ac', fontSize: 13.5 }}>
          没有匹配的学生
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="手动添加学生">
        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#5b6472', marginBottom: 6 }}>
          学生姓名
        </label>
        <input
          value={newName}
          autoFocus
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
          placeholder="如 王小明"
          style={fieldStyle}
        />
        <div style={{ fontSize: 12, color: '#9aa1ac', marginTop: 8 }}>
          老师添加的学生 source=teacher，暂无照片，可稍后在分组里安排。
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button style={ghostBtn} onClick={() => setAddOpen(false)}>
            取消
          </button>
          <button style={{ ...primaryBtn, opacity: newName.trim() && !busy ? 1 : 0.55 }} onClick={submitAdd}>
            {busy ? '添加中…' : '添加'}
          </button>
        </div>
      </Modal>

      <Modal open={!!pendingArchive} onClose={() => setPendingArchive(null)} title="归档学生">
        <div style={{ fontSize: 14, color: '#3c4451', lineHeight: 1.7 }}>
          确定归档「<b>{pendingArchive?.name}</b>」吗？归档后：
          <br />· 从学生列表默认隐藏，不再计入班级人数
          <br />· 移出默认分组，不进入课前配置与课堂
          <br />· 已绑定的家长在小程序端仍可查看历史 recap
          <br />· 可随时通过「已归档」筛选恢复在读
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <button style={ghostBtn} onClick={() => setPendingArchive(null)}>
            取消
          </button>
          <button
            style={{ ...primaryBtn, background: '#8a929e', boxShadow: 'none', opacity: busy ? 0.6 : 1 }}
            onClick={() => pendingArchive && changeStatus(pendingArchive, 'archived')}
          >
            {busy ? '归档中…' : '归档'}
          </button>
        </div>
      </Modal>

      <Modal open={!!pendingDelete} onClose={() => setPendingDelete(null)} title="删除学生">
        <div style={{ fontSize: 14, color: '#3c4451', lineHeight: 1.7 }}>
          确定删除「<b>{pendingDelete?.name}</b>」吗？该学生的历史加分记录、分组归属与出勤都会一并移除，且不可恢复。
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <button style={ghostBtn} onClick={() => setPendingDelete(null)}>
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

function StudentCard({
  s,
  dup,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onView,
  onSuspend,
  onRestore,
  onArchive,
  onDelete,
}: {
  s: Student;
  dup: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onView: () => void;
  onSuspend: () => void;
  onRestore: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const tag = sourceTag(s.source);
  const sTag = statusTag(s.status);
  return (
    <div
      style={{
        position: 'relative',
        background: '#fff',
        border: `1px solid ${dup ? '#f0dcae' : '#e7e9ee'}`,
        borderRadius: 12,
        padding: '15px 14px 13px',
      }}
    >
      <button
        onClick={onToggleMenu}
        style={{
          position: 'absolute',
          top: 9,
          right: 8,
          width: 26,
          height: 26,
          border: 'none',
          background: menuOpen ? '#f0f2f5' : 'transparent',
          borderRadius: 7,
          color: '#aab1bc',
          fontSize: 17,
          lineHeight: 1,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ⋯
      </button>
      {menuOpen && (
        <>
          <div onClick={onCloseMenu} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div
            style={{
              position: 'absolute',
              top: 34,
              right: 8,
              zIndex: 41,
              width: 156,
              background: '#fff',
              border: '1px solid #e7e9ee',
              borderRadius: 10,
              boxShadow: '0 12px 30px rgba(20,28,45,.16)',
              padding: 6,
              animation: 'dc-pop .14s ease',
            }}
          >
            {/* history stays viewable for suspended/archived students (§7.4) */}
            <button style={menuItemStyle('#3c4451')} onClick={onView}>
              查看成长档案
            </button>
            {s.status === 'active' && (
              <button style={menuItemStyle('#b06c22')} onClick={onSuspend}>
                停课
              </button>
            )}
            {s.status !== 'active' && (
              <button style={menuItemStyle('#2c7a48')} onClick={onRestore}>
                恢复在读
              </button>
            )}
            {s.status !== 'archived' && (
              <button style={menuItemStyle('#5b6472')} onClick={onArchive}>
                归档
              </button>
            )}
            <div style={{ height: 1, background: '#f1f3f6', margin: '4px 0' }} />
            <button style={menuItemStyle('#d94a4a')} onClick={onDelete}>
              删除学生
            </button>
          </div>
        </>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <div style={avatarStyle(s.id, 46, s.hasPhoto)}>{initial(s.name)}</div>
        <div style={{ minWidth: 0, paddingRight: 18 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 15,
              color: '#1e2430',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {s.name}
          </div>
          <div style={{ marginTop: 5, display: 'flex', gap: 5 }}>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: tag.color,
                background: tag.bg,
                padding: '2px 7px',
                borderRadius: 5,
              }}
            >
              {tag.label}
            </span>
            {sTag && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: sTag.color,
                  background: sTag.bg,
                  padding: '2px 7px',
                  borderRadius: 5,
                }}
              >
                {sTag.label}
              </span>
            )}
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 13,
          paddingTop: 12,
          borderTop: '1px solid #f1f3f6',
        }}
      >
        <span style={{ color: '#f2a83a', fontSize: 13 }}>★</span>
        <span className="mono" style={{ fontWeight: 600, fontSize: 15, color: '#1e2430' }}>
          {s.score}
        </span>
        <span style={{ fontSize: 11.5, color: '#9aa1ac' }}>累计个人分</span>
        {dup && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              fontWeight: 600,
              color: '#a86a12',
              background: '#faf1df',
              padding: '2px 6px',
              borderRadius: 5,
            }}
          >
            疑似重复
          </span>
        )}
      </div>
    </div>
  );
}

const menuItemStyle = (color: string): CSSProperties => ({
  display: 'flex',
  width: '100%',
  padding: '8px 10px',
  border: 'none',
  background: 'transparent',
  borderRadius: 7,
  fontSize: 13,
  color,
  textAlign: 'left',
  cursor: 'pointer',
});

// ===== GROUPS TAB ==========================================================
function GroupsTab({ d, reload }: { d: Detail; reload: () => Promise<void> | void }) {
  const toast = useToast();
  const byId = useMemo(() => new Map(d.students.map((s) => [s.id, s])), [d.students]);
  const [model, setModel] = useState<GroupingModel>(() => toModel(d));
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null); // group id or 'ungrouped'

  // Re-sync whenever the class detail changes (after a save or reload).
  useEffect(() => setModel(toModel(d)), [d]);

  async function persist(next: GroupingModel) {
    setModel(next); // optimistic
    try {
      await api.saveGrouping(d.id, toPayload(next));
      await reload(); // adopt server truth (real ids for new groups)
    } catch {
      toast('分组保存失败，已恢复', 'error');
      await reload();
    }
  }

  function drop(target: string | null) {
    const id = dragId;
    setDragId(null);
    setDropTarget(null);
    if (id) persist(moveStudent(model, id, target));
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1e2430' }}>默认分组方案</div>
          <div style={{ fontSize: 12.5, color: '#7a828f', marginTop: 3 }}>
            开始课堂时以此为初始分组，课中可临时调整。拖拽即保存，本班仅维护这一套默认分组。
          </div>
        </div>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '7px 13px',
            borderRadius: 9,
            background: '#f0f4f7',
            color: '#5b7387',
            fontWeight: 600,
            fontSize: 12.5,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#7c93a5"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
          </svg>
          拖拽学生卡在组间调整
        </div>
      </div>

      <div style={{ display: 'flex', gap: 13, overflowX: 'auto', paddingBottom: 6 }}>
        {model.groups.map((g) => (
          <div
            key={g.id}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget(g.id);
            }}
            onDragLeave={() => setDropTarget((t) => (t === g.id ? null : t))}
            onDrop={() => drop(g.id)}
            style={{
              width: 236,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              border: `1.5px solid ${dropTarget === g.id ? GREEN : '#e7e9ee'}`,
              background: dropTarget === g.id ? '#f2fbf5' : '#fff',
              borderRadius: 13,
              overflow: 'hidden',
              transition: 'border-color .12s, background .12s',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 11px',
                borderBottom: '1px solid #eef0f3',
                background: '#fafbfc',
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>{g.emoji}</span>
              <input
                value={g.name}
                onChange={(e) => setModel((m) => renameGroup(m, g.id, e.target.value))}
                onBlur={() => persist(model)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontWeight: 600,
                  fontSize: 14.5,
                  color: '#1e2430',
                  border: '1px solid transparent',
                  borderRadius: 6,
                  background: 'transparent',
                  padding: '3px 6px',
                }}
                onFocus={(e) => (e.currentTarget.style.border = '1px solid #d7dbe0')}
              />
              <span
                className="mono"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#7a828f',
                  background: '#eef1f5',
                  padding: '2px 8px',
                  borderRadius: 6,
                }}
              >
                {g.memberIds.length}
              </span>
              <button
                onClick={() => persist(removeGroup(model, g.id))}
                title="删除小组"
                style={{
                  width: 22,
                  height: 22,
                  border: 'none',
                  background: 'transparent',
                  borderRadius: 6,
                  color: '#c0c6cf',
                  fontSize: 17,
                  lineHeight: 1,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ×
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 96, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {g.memberIds.map((mid) => {
                const s = byId.get(mid);
                if (!s) return null;
                return (
                  <div
                    key={mid}
                    draggable
                    onDragStart={(e) => {
                      setDragId(mid);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropTarget(null);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 10,
                      background: '#fff',
                      border: '1px solid #eef0f3',
                      cursor: 'grab',
                      opacity: dragId === mid ? 0.4 : 1,
                    }}
                  >
                    <div style={avatarStyle(s.id, 32, s.hasPhoto)}>{initial(s.name)}</div>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 14,
                        color: '#1e2430',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        minWidth: 0,
                      }}
                    >
                      {s.name}
                    </span>
                    <span style={{ marginLeft: 'auto', color: '#c6ccd4', fontSize: 14 }}>⠿</span>
                  </div>
                );
              })}
              {g.memberIds.length === 0 && (
                <div style={{ margin: 'auto', color: '#b7bec8', fontSize: 12.5 }}>拖学生到这里</div>
              )}
            </div>
          </div>
        ))}
        <button
          onClick={() => persist(addGroup(model))}
          style={{
            width: 150,
            flexShrink: 0,
            alignSelf: 'flex-start',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            minHeight: 150,
            border: '1.5px dashed #d3d9df',
            background: 'transparent',
            borderRadius: 13,
            color: '#8a929e',
            fontWeight: 600,
            fontSize: 13.5,
            cursor: 'pointer',
          }}
        >
          + 新增小组
        </button>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDropTarget('ungrouped');
        }}
        onDragLeave={() => setDropTarget((t) => (t === 'ungrouped' ? null : t))}
        onDrop={() => drop(null)}
        style={{
          marginTop: 14,
          border: `1.5px dashed ${dropTarget === 'ungrouped' ? GREEN : '#d3d9df'}`,
          background: dropTarget === 'ungrouped' ? '#f2fbf5' : '#fbfcfd',
          borderRadius: 12,
          padding: '13px 15px',
          transition: 'border-color .12s, background .12s',
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: model.ungrouped.length === 0 ? 0 : 12 }}
        >
          <span style={{ fontWeight: 600, fontSize: 14, color: '#5b6472' }}>未分组</span>
          <span
            className="mono"
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: '#7a828f',
              background: '#eef1f5',
              padding: '2px 8px',
              borderRadius: 6,
            }}
          >
            {model.ungrouped.length}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#a6adb8' }}>
            留在此处的学生，开课时默认不计分，直到分入某组
          </span>
        </div>
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 9, minHeight: model.ungrouped.length === 0 ? 0 : undefined }}
        >
          {model.ungrouped.length === 0 && (
            <span style={{ color: '#b7bec8', fontSize: 13, fontWeight: 500, padding: 2 }}>全部学生已分组 ✓</span>
          )}
          {model.ungrouped.map((sid) => {
            const s = byId.get(sid);
            if (!s) return null;
            return (
              <div
                key={sid}
                draggable
                onDragStart={(e) => {
                  setDragId(sid);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setDropTarget(null);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px 6px 6px',
                  borderRadius: 10,
                  background: '#fff',
                  border: '1px solid #e2e6ea',
                  cursor: 'grab',
                  opacity: dragId === sid ? 0.4 : 1,
                }}
              >
                <div style={avatarStyle(s.id, 32, s.hasPhoto)}>{initial(s.name)}</div>
                <span style={{ fontWeight: 600, fontSize: 13.5, color: '#5b6472', whiteSpace: 'nowrap' }}>
                  {s.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ===== INVITE TAB ==========================================================
// 邀请的生成与处理都在小程序端（老师登录小程序 → 生成邀请 → 分享 → 队列关联）；
// web 端只留说明 + 只读队列。
function InviteTab({ d }: { d: Detail }) {
  const [requests, setRequests] = useState<JoinRequestItem[] | null>(null);
  const toast = useToast();

  useEffect(() => {
    api
      .getJoinRequests(d.id)
      .then(setRequests)
      .catch(() => toast('邀请队列加载失败', 'error'));
  }, [d.id]);

  return (
    <div style={{ maxWidth: 620 }}>
      <div style={{ background: '#fff', border: '1px solid #e7e9ee', borderRadius: 14, padding: 24 }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#1e2430' }}>在小程序里邀请家长</div>
        <div style={{ fontSize: 13, color: '#7a828f', marginTop: 5, lineHeight: 1.7 }}>
          邀请在微信小程序「NCE 课堂」里发起：老师登录小程序（首次用本站账号绑定一次）→ 选择本班 → 「生成邀请」→
          把卡片分享到班级群。家长点卡片填写孩子信息后会进入下方队列，由老师在小程序里 关联到「学生」页已建好的学生。
          <br />
          每个邀请 7 天有效，可随时重新生成；此页只读，处理请在小程序完成。
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e7e9ee', borderRadius: 14, padding: 24, marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#1e2430' }}>
          邀请队列{requests ? `（${requests.length}）` : ''}
        </div>
        {requests && requests.length === 0 && (
          <div style={{ fontSize: 13, color: '#98a1af', marginTop: 12 }}>暂无待确认的申请</div>
        )}
        {(requests ?? []).map((r) => (
          <div
            key={r.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 0',
              borderBottom: '1px solid #f0f2f5',
            }}
          >
            {r.photoUrl ? (
              <img
                src={r.photoUrl}
                alt=""
                style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
              />
            ) : (
              <div style={avatarStyle(r.id, 36, false)}>{initial(r.cnName)}</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#1e2430' }}>
                {r.cnName}
                {r.enName && <span style={{ color: '#98a1af', fontWeight: 400, marginLeft: 6 }}>{r.enName}</span>}
              </div>
              <div style={{ fontSize: 12, color: '#98a1af', marginTop: 2 }}>
                {r.parentPhone ? `${r.parentPhone} · ` : ''}微信：{r.nickname ?? '—'}
              </div>
            </div>
            <span
              style={{
                fontSize: 12,
                color: '#b06c22',
                background: '#fdf3e5',
                padding: '3px 10px',
                borderRadius: 999,
                flexShrink: 0,
              }}
            >
              待关联
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== SESSIONS TAB ========================================================
const fmtDur = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;

function SessionsTab({ d, reload }: { d: Detail; reload: () => Promise<void> | void }) {
  const [recap, setRecap] = useState<Recap | null>(null);
  const [recapOpen, setRecapOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function openRecap(s: Session) {
    setRecapOpen(true);
    setRecap(null);
    setLoading(true);
    try {
      setRecap(await api.getSessionRecap(s.id));
    } catch {
      toast('回顾加载失败', 'error');
      setRecapOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || busy) return;
    setBusy(true);
    try {
      await api.deleteSession(pendingDelete.id);
      await reload();
      toast('已删除该条上课记录');
      setPendingDelete(null);
    } catch {
      toast('删除失败，请重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ background: '#fff', border: '1px solid #e7e9ee', borderRadius: 13, overflow: 'hidden' }}>
        <div
          className="mono"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '11px 18px',
            background: '#fafbfc',
            borderBottom: '1px solid #eef0f3',
            fontSize: 10.5,
            letterSpacing: '.7px',
            color: '#a6adb8',
          }}
        >
          <span style={{ width: 96 }}>DATE</span>
          <span style={{ flex: 1 }}>LESSON</span>
          <span style={{ width: 118 }}>DURATION</span>
          <span style={{ width: 58 }}>GROUPS</span>
          <span style={{ width: 148, textAlign: 'right' }}>RECAP</span>
        </div>
        {d.sessions.map((s) => {
          const early = s.actualDurationMin < s.plannedDurationMin;
          const over = s.actualDurationMin > s.plannedDurationMin;
          const note = early
            ? `计划 ${fmtDur(s.plannedDurationMin)} · 提前 ${s.plannedDurationMin - s.actualDurationMin} 分`
            : over
              ? `计划 ${fmtDur(s.plannedDurationMin)} · 超时 ${s.actualDurationMin - s.plannedDurationMin} 分`
              : `计划 ${fmtDur(s.plannedDurationMin)}`;
          return (
            <div
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 18px',
                borderBottom: '1px solid #f1f3f6',
              }}
            >
              <div style={{ width: 96 }}>
                <div className="mono" style={{ fontWeight: 600, fontSize: 14, color: '#1e2430' }}>
                  {s.date}
                </div>
                <div style={{ fontSize: 11, color: '#a6adb8', marginTop: 2 }}>
                  {s.year} · {s.weekday}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14.5,
                    color: '#1e2430',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {s.lessonNumber != null ? `第${s.lessonNumber}课 · ${s.lessonTitle}` : s.lessonTitle}
                </div>
              </div>
              <div style={{ width: 118 }}>
                <div className="mono" style={{ fontWeight: 600, fontSize: 13.5, color: '#3c4451' }}>
                  {s.durationLabel}
                </div>
                <div style={{ fontSize: 11, color: early ? '#c58a1e' : '#a6adb8', marginTop: 2 }}>{note}</div>
              </div>
              <div style={{ width: 58, fontSize: 13, color: '#5b6472' }}>{s.groupCount} 组</div>
              <div style={{ width: 148, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={() => openRecap(s)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    height: 34,
                    padding: '0 13px',
                    background: '#fff',
                    color: '#3c4451',
                    border: '1px solid #e2e5ea',
                    borderRadius: 8,
                    fontWeight: 600,
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  查看 recap
                </button>
                <button
                  onClick={() => setPendingDelete(s)}
                  title="删除这条上课记录"
                  style={{
                    height: 34,
                    padding: '0 10px',
                    background: 'transparent',
                    color: '#a6adb8',
                    border: '1px solid transparent',
                    borderRadius: 8,
                    fontWeight: 600,
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: '#a6adb8', textAlign: 'center' }}>
        仅展示本班历次课堂 · recap 家长可在专属链接查看个性化版本
      </div>

      <Modal open={recapOpen} onClose={() => setRecapOpen(false)} title="课堂回顾" width={460}>
        {loading || !recap ? (
          <div style={{ padding: '30px 0', textAlign: 'center', color: '#9aa1ac', fontSize: 13.5 }}>加载中…</div>
        ) : (
          <RecapBody recap={recap} />
        )}
      </Modal>

      <Modal open={!!pendingDelete} onClose={() => setPendingDelete(null)} title="删除上课记录">
        <div style={{ fontSize: 14, color: '#3c4451', lineHeight: 1.7 }}>
          确定删除 <b>{pendingDelete?.date}</b>「
          <b>
            {pendingDelete?.lessonNumber != null
              ? `第${pendingDelete.lessonNumber}课 · ${pendingDelete.lessonTitle}`
              : pendingDelete?.lessonTitle}
          </b>
          」这条上课记录吗？该节课的得分、背书作业与出勤都会一并清除，且不可恢复。
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <button style={ghostBtn} onClick={() => setPendingDelete(null)}>
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

function RecapBody({ recap }: { recap: Recap }) {
  const max = Math.max(1, ...recap.groups.map((g) => g.score));
  return (
    <div>
      <div style={{ fontSize: 13, color: '#7a828f', marginBottom: 4 }}>
        {recap.lessonNumber != null ? `第${recap.lessonNumber}课 · ${recap.lessonTitle}` : recap.lessonTitle}
      </div>
      <div style={{ display: 'flex', gap: 14, fontSize: 12.5, color: '#8a929e', marginBottom: 18 }}>
        <span className="mono">
          {recap.date} · {recap.weekday}
        </span>
        <span>时长 {fmtDur(recap.actualDurationMin)}</span>
        <span>
          出勤 {recap.attendancePresent}/{recap.attendanceTotal}
        </span>
      </div>

      <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1e2430', marginBottom: 10 }}>小组排名</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 20 }}>
        {recap.groups.map((g, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 22, fontSize: 16 }}>{g.emoji}</span>
            <span style={{ width: 62, fontSize: 13, fontWeight: 600, color: '#3c4451' }}>{g.name}</span>
            <div style={{ flex: 1, height: 14, background: '#f0f2f5', borderRadius: 7, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${(Math.max(0, g.score) / max) * 100}%`,
                  height: '100%',
                  background: i === 0 ? GREEN : '#bcd9c6',
                  borderRadius: 7,
                  transition: 'width .3s',
                }}
              />
            </div>
            <span
              className="mono"
              style={{ width: 30, textAlign: 'right', fontWeight: 700, fontSize: 13.5, color: '#1e2430' }}
            >
              {g.score}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <RecapList
          title="🌟 表现亮眼"
          empty="本节无人 +2 及以上"
          items={recap.stars.map((s) => s.name)}
          tone="#2c7a48"
          bg="#eef7f0"
        />
        <RecapList
          title="⚠️ 被提醒"
          empty="本节无人被扣分"
          items={recap.warned.map((w) => w.name)}
          tone="#c0392b"
          bg="#fbeeee"
        />
      </div>
    </div>
  );
}

function RecapList({
  title,
  empty,
  items,
  tone,
  bg,
}: {
  title: string;
  empty: string;
  items: string[];
  tone: string;
  bg: string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 180, background: bg, borderRadius: 11, padding: '12px 13px' }}>
      <div style={{ fontWeight: 700, fontSize: 12.5, color: tone, marginBottom: 8 }}>{title}</div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: '#9aa1ac' }}>{empty}</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {items.map((n, i) => (
            <span
              key={i}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: '#3c4451',
                background: '#fff',
                padding: '3px 9px',
                borderRadius: 7,
              }}
            >
              {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
