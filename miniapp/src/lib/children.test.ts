import { describe, expect, it } from 'vitest';
import { addChild, currentChild, emptyState, parseState, removeChild, setCurrent, type Child } from './children';

const kid = (token: string, name = '小明'): Child => ({ token, studentId: `s-${token}`, name, className: '三年级A班' });

describe('parseState', () => {
  it('坏数据回退空状态', () => {
    expect(parseState(undefined)).toEqual(emptyState());
    expect(parseState('')).toEqual(emptyState());
    expect(parseState('not json')).toEqual(emptyState());
    expect(parseState('{"children":1}')).toEqual(emptyState());
  });

  it('currentToken 失效时回退第一个孩子', () => {
    const raw = JSON.stringify({ children: [kid('a'), kid('b')], currentToken: 'gone' });
    expect(parseState(raw).currentToken).toBe('a');
  });

  it('往返序列化保持', () => {
    const st = addChild(addChild(emptyState(), kid('a')), kid('b', '朵朵'));
    expect(parseState(JSON.stringify(st))).toEqual(st);
  });
});

describe('add / remove / setCurrent', () => {
  it('addChild 设为当前；同 token 覆盖', () => {
    let st = addChild(emptyState(), kid('a'));
    st = addChild(st, kid('b'));
    expect(st.currentToken).toBe('b');
    st = addChild(st, kid('a', '改名'));
    expect(st.children).toHaveLength(2);
    expect(currentChild(st)?.name).toBe('改名');
  });

  it('removeChild 删当前时回退到剩余第一个', () => {
    let st = addChild(addChild(emptyState(), kid('a')), kid('b'));
    st = removeChild(st, 'b');
    expect(st.currentToken).toBe('a');
    st = removeChild(st, 'a');
    expect(st).toEqual(emptyState());
  });

  it('setCurrent 只认已存在的 token', () => {
    const st = addChild(addChild(emptyState(), kid('a')), kid('b'));
    expect(setCurrent(st, 'a').currentToken).toBe('a');
    expect(setCurrent(st, 'ghost').currentToken).toBe('b');
  });
});
