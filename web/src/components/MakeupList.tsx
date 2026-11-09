import { useState } from 'react';
import type { ClassAttendance, MakeupRecord } from '../api/attendance';
import { dateParts, weekdayCN } from '../lib/attendance';
import { formatMakeupSessions, makeupListRows } from '../lib/makeup';
import './makeup.css';

export function MakeupList({
  data,
  onCreate,
  onEdit,
}: {
  data: ClassAttendance;
  onCreate: () => void;
  onEdit: (record: MakeupRecord) => void;
}) {
  const [studentFilter, setStudentFilter] = useState('');
  const { records, students } = makeupListRows(data, studentFilter);
  return (
    <section className="makeup-list" aria-label="补课记录列表">
      <div className="makeup-toolbar">
        <label>
          学生筛选{' '}
          <select aria-label="学生筛选" value={studentFilter} onChange={(e) => setStudentFilter(e.target.value)}>
            <option value="">全部学生</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.status === 'archived' ? '（已归档）' : ''}
              </option>
            ))}
          </select>
        </label>
        <button className="makeup-primary" onClick={onCreate}>
          + 登记补课
        </button>
      </div>
      {records.length === 0 ? (
        <div className="makeup-empty">
          <h2>{studentFilter ? '该学生还没有补课记录' : '还没有补课记录'}</h2>
          <p>记录补课日期、时长和抵扣的课，出勤表会同步更新。</p>
          <button className="makeup-primary" onClick={onCreate}>
            登记补课
          </button>
        </div>
      ) : (
        <div className="makeup-table-scroll">
          <table className="makeup-table">
            <thead>
              <tr>
                <th>补课日期</th>
                <th>学生</th>
                <th>时长</th>
                <th>抵扣的课</th>
                <th>备注</th>
                <th>登记老师</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const { mm, dd } = dateParts(record.date);
                return (
                  <tr key={record.id} onClick={() => onEdit(record)}>
                    <td>
                      <button
                        className="makeup-row-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(record);
                        }}
                      >
                        {mm}/{dd} <span>{weekdayCN(record.date)}</span>
                      </button>
                    </td>
                    <td>{record.studentName}</td>
                    <td>{record.durationMinutes == null ? '未记录时长' : `${record.durationMinutes} 分钟`}</td>
                    <td>
                      <span className={record.sessionIds.length ? '' : 'makeup-warning'}>
                        {formatMakeupSessions(record, data.sessions)}
                      </span>
                      {record.sessionIds.length > 0 && <small>共 {record.sessionIds.length} 节</small>}
                    </td>
                    <td className="makeup-note">{record.note}</td>
                    <td>{record.createdByName ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
