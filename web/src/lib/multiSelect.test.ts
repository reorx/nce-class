import { describe, expect, it } from 'vitest';
import { allSelected, dragTargets, someSelected, toggleAll, toggleOne } from './multiSelect';

const sel = (...ids: string[]) => new Set(ids);

describe('toggleOne', () => {
  it('adds an unselected id and removes a selected one, without mutating the input', () => {
    const before = sel('a');
    const added = toggleOne(before, 'b');
    expect([...added].sort()).toEqual(['a', 'b']);
    const removed = toggleOne(added, 'a');
    expect([...removed]).toEqual(['b']);
    expect([...before]).toEqual(['a']); // input untouched
  });
});

describe('toggleAll (栏头全选 checkbox)', () => {
  it('selects every id of the lane when not all are selected yet', () => {
    expect([...toggleAll(sel('a'), ['a', 'b', 'c'])].sort()).toEqual(['a', 'b', 'c']);
    expect([...toggleAll(sel(), ['a', 'b'])].sort()).toEqual(['a', 'b']);
  });

  it('deselects the whole lane when it is already fully selected, keeping other lanes', () => {
    // x belongs to another lane and must survive the lane-level deselect
    expect([...toggleAll(sel('a', 'b', 'x'), ['a', 'b'])]).toEqual(['x']);
  });
});

describe('allSelected / someSelected', () => {
  it('allSelected is true only for a non-empty lane fully contained in the selection', () => {
    expect(allSelected(sel('a', 'b'), ['a', 'b'])).toBe(true);
    expect(allSelected(sel('a'), ['a', 'b'])).toBe(false);
    expect(allSelected(sel('a'), [])).toBe(false); // empty lane never reads as 全选
  });

  it('someSelected flags a partial overlap (indeterminate state)', () => {
    expect(someSelected(sel('a'), ['a', 'b'])).toBe(true);
    expect(someSelected(sel('x'), ['a', 'b'])).toBe(false);
  });
});

describe('dragTargets', () => {
  it('dragging a selected student moves the whole selection', () => {
    expect(dragTargets(sel('a', 'b'), 'a').sort()).toEqual(['a', 'b']);
  });

  it('dragging an unselected student moves only itself and leaves the selection alone', () => {
    expect(dragTargets(sel('a', 'b'), 'c')).toEqual(['c']);
  });

  it('with no selection, drags the single student', () => {
    expect(dragTargets(sel(), 'a')).toEqual(['a']);
  });
});
