import { nanoid } from 'nanoid';
import { hashPassword } from '../auth/password.js';
import { db, sqlite } from './client.js';
import { DDL } from './ddl.js';
import * as t from './schema.js';

// ---------------------------------------------------------------------------
// Mock data mirrors the M1 design mockups (nce-class-v1-design) so the seeded
// app renders the same pages as the goal screenshots.
// ---------------------------------------------------------------------------

const ORG_ID = 'org-chenguang';
const token = () => nanoid(24);

const TEACHERS = [
  { id: 't-wangli', name: '王莉', username: 'wangli', role: 'owner' },
  { id: 't-chenxiao', name: '陈晓', username: 'chenxiao', role: 'teacher' },
  { id: 't-limei', name: '李梅', username: 'limei', role: 'teacher' },
  { id: 't-zhangwei', name: '张伟', username: 'zhangwei', role: 'teacher' },
];

// 三年级A班 (c1) — the detailed class shown across the class-detail screenshots.
const C1_STUDENTS = [
  { key: 1, name: '小明', source: 'parent', score: 17, photo: true, group: 'g1' },
  { key: 2, name: '小红', source: 'teacher', score: 12, photo: true, group: 'g1' },
  { key: 3, name: '小刚', source: 'teacher', score: 4, photo: false, group: 'g1' },
  { key: 4, name: '乐乐', source: 'parent', score: 23, photo: true, group: 'g1' },
  { key: 5, name: '丽丽', source: 'parent', score: 9, photo: true, group: 'g2' },
  { key: 6, name: '大壮', source: 'teacher', score: 6, photo: false, group: 'g2' },
  { key: 7, name: '欣欣', source: 'parent', score: 16, photo: true, group: 'g2' },
  { key: 8, name: '明明', source: 'teacher', score: 5, photo: false, group: 'g2' },
  { key: 9, name: '军军', source: 'parent', score: 21, photo: true, group: 'g3' },
  { key: 10, name: '悦悦', source: 'parent', score: 8, photo: true, group: 'g3' },
  { key: 11, name: '婷婷', source: 'teacher', score: 14, photo: true, group: 'g3' },
  { key: 12, name: '浩浩', source: 'teacher', score: 11, photo: false, group: 'g3' },
  { key: 13, name: '浩浩', source: 'parent', score: 0, photo: true, group: null }, // ungrouped duplicate
];
const C1_GROUPS = [
  { id: 'g1', name: '第1组', emoji: '🦁' },
  { id: 'g2', name: '第2组', emoji: '🐯' },
  { id: 'g3', name: '第3组', emoji: '🐻' },
];
const C1_SESSIONS = [
  { n: 7, title: 'Too late', date: '2026-06-26', plan: 120, actual: 118 },
  { n: 6, title: 'Percy Buttons', date: '2026-06-19', plan: 120, actual: 126 },
  { n: 5, title: 'No wrong numbers', date: '2026-06-12', plan: 120, actual: 96 },
  { n: 4, title: 'An exciting trip', date: '2026-06-05', plan: 120, actual: 121 },
  { n: 3, title: 'Please send me a card', date: '2026-05-29', plan: 120, actual: 122 },
  { n: 2, title: 'Breakfast or lunch?', date: '2026-05-22', plan: 120, actual: 119 },
  { n: 1, title: 'A private conversation', date: '2026-05-15', plan: 120, actual: 131 },
];

// Other classes — only counts, roster preview & last-session date are shown.
const FILLER = [
  '浩宇',
  '梓涵',
  '雨泽',
  '思琪',
  '嘉豪',
  '欣妍',
  '宇涵',
  '子睿',
  '梦琪',
  '俊杰',
  '雅婷',
  '天佑',
  '若萱',
  '昊然',
  '梓豪',
  '欣悦',
  '子轩',
  '铭泽',
  '雅雯',
  '思涵',
  '嘉怡',
  '浩轩',
  '梓晴',
  '雨萱',
  '俊豪',
  '欣然',
  '子墨',
  '诗雨',
  '宇航',
  '梦洁',
];
const OTHER_CLASSES = [
  {
    id: 'c3',
    name: '四年级A班',
    teacher: 't-chenxiao',
    count: 18,
    last: '2026-06-30',
    roster: ['航航', '诗涵', '子墨', '一诺', '雨桐', '思远', '子豪'],
  },
  {
    id: 'c2',
    name: '三年级B班',
    teacher: 't-wangli',
    count: 15,
    last: '2026-06-26',
    roster: ['佳佳', '梓萱', '昊天', '嘉怡', '雨轩', '梦洁'],
  },
  {
    id: 'c5',
    name: '新概念一册 · 周末班',
    teacher: 't-limei',
    count: 16,
    last: '2026-06-28',
    roster: ['子涵', '欣怡', '浩然', '诗琪', '宇轩', '静怡'],
  },
  {
    id: 'c4',
    name: '五年级提高班',
    teacher: 't-wangli',
    count: 10,
    last: '2026-06-28',
    roster: ['天翊', '若曦', '铭轩', '语桐', '俊哲'],
  },
  {
    id: 'c6',
    name: '新概念二册 · 晚间班',
    teacher: 't-zhangwei',
    count: 14,
    last: '2026-06-29',
    roster: ['奕辰', '沐辰', '可欣', '梓睿', '馨月', '子晴'],
  },
];

// createdAt sequence controls list order (matches the mockup's ordering).
let seq = 0;
const ts = () => `2026-06-01 08:00:${String(seq++).padStart(2, '0')}`;

function run() {
  sqlite.exec(DDL);
  // wipe (idempotent reseed)
  for (const table of [
    'check_records',
    'score_events',
    'session_memberships',
    'session_groups',
    'class_sessions',
    'class_group_memberships',
    'class_groups',
    'join_requests',
    'student_wechat_bindings',
    'class_invites',
    'students',
    'classes',
    'credentials',
    'wechat_accounts',
    'teachers',
    'organizations',
  ])
    sqlite.exec(`DELETE FROM ${table}`);

  db.insert(t.organizations).values({ id: ORG_ID, name: '晨光英语' }).run();

  for (const te of TEACHERS) {
    db.insert(t.teachers)
      .values({ id: te.id, orgId: ORG_ID, name: te.name, username: te.username, role: te.role })
      .run();
    db.insert(t.credentials)
      .values({ id: nanoid(), teacherId: te.id, provider: 'password', secret: hashPassword('demo1234') })
      .run();
  }

  // ---- 四年级A班 goes first in the list; classes ordered like the mockup ----
  // Insert 四年级A班 (c3) first, then 三年级A班 (c1), then the rest.
  const ordered = [
    OTHER_CLASSES[0], // c3 四年级A班
    { detail: true },
    ...OTHER_CLASSES.slice(1),
  ];

  for (const item of ordered) {
    if ('detail' in item) {
      seedC1();
      continue;
    }
    seedOtherClass(item as (typeof OTHER_CLASSES)[number]);
  }

  seedMockWechatAccounts();

  console.log('✅ seed complete →', sqlite.name);
}

// Three deterministic accounts for the WX_MOCK login stub (code `mock:<name>`
// maps to openid `mock-openid-<name>`), covering the three miniapp roles:
// a bound teacher, a bound parent, and a brand-new visitor.
function seedMockWechatAccounts() {
  const account = (name: string, nickname: string) => {
    const id = `wa-${name}`;
    db.insert(t.wechatAccounts)
      .values({ id, openid: `mock-openid-${name}`, nickname })
      .run();
    return id;
  };
  const teacherWa = account('dev-teacher', '王老师(dev)');
  const parentWa = account('dev-parent', '小明爸爸(dev)');
  account('dev-new', '新家长(dev)');

  db.insert(t.credentials)
    .values({ id: nanoid(), teacherId: 't-wangli', provider: 'wechat', wechatAccountId: teacherWa })
    .run();
  db.insert(t.studentWechatBindings)
    .values({ id: nanoid(), studentId: 's-c1-1', wechatAccountId: parentWa, createdBy: 't-wangli' })
    .run();
}

function seedC1() {
  const cls = { id: 'c1', name: '三年级A班', teacher: 't-wangli' };
  db.insert(t.classes)
    .values({
      id: cls.id,
      orgId: ORG_ID,
      name: cls.name,
      notes: [
        '# 班级资源',
        '',
        '## 教材',
        '',
        '- 《新概念英语》第二册（外研社版）',
        '- 配套练习册 Lesson 1–48',
        '',
        '## 常用链接',
        '',
        '- [单词表在线版](https://example.com/nce2/words)',
        '- [课文录音](https://example.com/nce2/audio)',
        '',
        '## 备注',
        '',
        '每节课前 10 分钟听写上节课单词，**周五**统一检查练习册。',
      ].join('\n'),
      teacherId: cls.teacher,
      textbook: 2,
      homeworkTemplate: ['- L{lesson_number} 三英一汉，听写三遍', '- 练字三面', '- 背L{lesson_number}'].join('\n'),
      createdAt: ts(),
    })
    .run();

  // groups
  C1_GROUPS.forEach((g, i) =>
    db
      .insert(t.classGroups)
      .values({ id: `${cls.id}-${g.id}`, classId: cls.id, name: g.name, emoji: g.emoji, orderIndex: i })
      .run(),
  );

  // students + default-group memberships
  const studentIdByKey: Record<number, string> = {};
  C1_STUDENTS.forEach((s, i) => {
    const sid = `s-c1-${s.key}`;
    studentIdByKey[s.key] = sid;
    db.insert(t.students)
      .values({
        id: sid,
        classId: cls.id,
        name: s.name,
        source: s.source,
        photoUrl: s.photo ? `seed://photo/${s.key}` : null,
        recapToken: token(),
        createdAt: `2026-05-01 08:00:${String(i).padStart(2, '0')}`,
      })
      .run();
    if (s.group)
      db.insert(t.classGroupMemberships)
        .values({ id: nanoid(), classGroupId: `${cls.id}-${s.group}`, studentId: sid })
        .run();
  });

  // sessions (+ per-session group snapshots) newest-first n=7..1
  const sessionGroupId: Record<string, Record<string, string>> = {}; // sessId -> classGroupKey -> sessionGroupId
  for (const se of C1_SESSIONS) {
    const sid = `sess-c1-${se.n}`;
    const startedAt = `${se.date} 19:00:00`;
    const ended = new Date(`${se.date}T19:00:00Z`).getTime() + se.actual * 60000;
    const endedAt = new Date(ended).toISOString().slice(0, 19).replace('T', ' ');
    db.insert(t.classSessions)
      .values({
        id: sid,
        classId: cls.id,
        teacherId: cls.teacher,
        date: se.date,
        lessonNumber: se.n,
        lessonTitle: se.title,
        status: 'ended',
        plannedDurationMin: se.plan,
        startedAt,
        endedAt,
      })
      .run();
    sessionGroupId[sid] = {};
    C1_GROUPS.forEach((g, i) => {
      const sgid = `${sid}-${g.id}`;
      sessionGroupId[sid][g.id] = sgid;
      db.insert(t.sessionGroups)
        .values({ id: sgid, sessionId: sid, name: g.name, emoji: g.emoji, orderIndex: i })
        .run();
    });
    // membership snapshot
    C1_STUDENTS.forEach((s) => {
      db.insert(t.sessionMemberships)
        .values({
          id: nanoid(),
          sessionId: sid,
          studentId: studentIdByKey[s.key],
          sessionGroupId: s.group ? sessionGroupId[sid][s.group] : null,
          attendance: 'present',
        })
        .run();
    });
  }

  // score events — cumulative individual score derived from the ledger.
  // Spread each student's +1 events round-robin across the 7 sessions so
  // per-session group tallies (for recap) are non-trivial too.
  const sessionIds = C1_SESSIONS.map((s) => `sess-c1-${s.n}`);
  C1_STUDENTS.forEach((s) => {
    for (let k = 0; k < s.score; k++) {
      const sid = sessionIds[k % sessionIds.length];
      db.insert(t.scoreEvents)
        .values({
          id: nanoid(),
          sessionId: sid,
          targetType: 'student',
          targetId: studentIdByKey[s.key],
          sessionGroupId: s.group ? sessionGroupId[sid][s.group] : null,
          delta: 1,
          createdBy: 't-wangli',
        })
        .run();
    }
  });
}

function seedOtherClass(c: (typeof OTHER_CLASSES)[number]) {
  db.insert(t.classes)
    .values({
      id: c.id,
      orgId: ORG_ID,
      name: c.name,
      teacherId: c.teacher,
      createdAt: ts(),
    })
    .run();

  const names = [...c.roster];
  let fi = 0;
  while (names.length < c.count) names.push(FILLER[fi++ % FILLER.length]);

  names.slice(0, c.count).forEach((name, i) => {
    db.insert(t.students)
      .values({
        id: `s-${c.id}-${i + 1}`,
        classId: c.id,
        name,
        source: i % 3 === 0 ? 'teacher' : 'parent',
        photoUrl: `seed://photo/${c.id}/${i}`,
        recapToken: token(),
        createdAt: `2026-05-01 08:00:${String(i).padStart(2, '0')}`,
      })
      .run();
  });

  // one prior session so "上次上课" shows the right date
  db.insert(t.classSessions)
    .values({
      id: `sess-${c.id}-1`,
      classId: c.id,
      teacherId: c.teacher,
      date: c.last,
      status: 'ended',
      plannedDurationMin: 120,
      startedAt: `${c.last} 19:00:00`,
      endedAt: `${c.last} 21:00:00`,
    })
    .run();
}

run();
sqlite.close();
