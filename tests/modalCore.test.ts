import { describe, expect, it } from 'vitest';
import { ModalStack, trapTarget, createBackdropGuard, shouldRestoreFocus } from '../src/lib/modalCore';

describe('ModalStack', () => {
  it('push 한 순서대로 쌓이고 맨 끝이 최상단이다', () => {
    const s = new ModalStack<string>();
    expect(s.top).toBeUndefined();
    s.push('settings'); s.push('dialog');
    expect(s.top).toBe('dialog');
    expect(s.isTop('dialog')).toBe(true);
    expect(s.isTop('settings')).toBe(false);
    expect(s.size).toBe(2);
  });

  it('최상단을 빼면 아래 모달이 최상단이 된다', () => {
    const s = new ModalStack<string>();
    s.push('a'); s.push('b');
    expect(s.remove('b')).toBe(true);
    expect(s.top).toBe('a');
    expect(s.remove('a')).toBe(true);
    expect(s.top).toBeUndefined();
    expect(s.isTop('a')).toBe(false);
  });

  it('중간 모달을 먼저 빼도 최상단은 그대로다', () => {
    const s = new ModalStack<string>();
    s.push('a'); s.push('b'); s.push('c');
    s.remove('b');
    expect(s.top).toBe('c');
    expect(s.list()).toEqual(['a', 'c']);
  });

  it('같은 모달을 두 번 올리지 않고, 없는 것을 빼면 false 다', () => {
    const s = new ModalStack<string>();
    s.push('a'); s.push('a');
    expect(s.size).toBe(1);
    expect(s.remove('x')).toBe(false);
    expect(s.remove('a')).toBe(true);
    expect(s.remove('a')).toBe(false);
  });

  it('list 는 복사본이라 바꿔도 스택에 영향이 없다', () => {
    const s = new ModalStack<string>();
    s.push('a');
    s.list().push('z');
    expect(s.size).toBe(1);
  });
});

describe('trapTarget (Tab 순환)', () => {
  it('중간에서는 기본 동작에 맡긴다', () => {
    expect(trapTarget(4, 1, false)).toBeNull();
    expect(trapTarget(4, 2, true)).toBeNull();
  });
  it('마지막에서 Tab 은 처음으로, 처음에서 Shift+Tab 은 마지막으로', () => {
    expect(trapTarget(4, 3, false)).toBe(0);
    expect(trapTarget(4, 0, true)).toBe(3);
  });
  it('요소가 하나면 Tab 도 Shift+Tab 도 제자리로 돈다', () => {
    expect(trapTarget(1, 0, false)).toBe(0);
    expect(trapTarget(1, 0, true)).toBe(0);
  });
  it('포커스가 모달 밖·컨테이너(-1)에 있으면 방향에 맞는 끝으로 끌어들인다', () => {
    expect(trapTarget(3, -1, false)).toBe(0);
    expect(trapTarget(3, -1, true)).toBe(2);
    expect(trapTarget(3, 9, false)).toBe(0);
  });
  it('포커스 가능 요소가 없으면 -1(컨테이너에 머문다)', () => {
    expect(trapTarget(0, -1, false)).toBe(-1);
    expect(trapTarget(0, 0, true)).toBe(-1);
  });
});

describe('createBackdropGuard (백드롭 닫기)', () => {
  it('pointerdown 과 click 이 둘 다 백드롭이면 닫는다', () => {
    const g = createBackdropGuard();
    g.down(true);
    expect(g.click(true)).toBe(true);
  });
  it('모달 안에서 누르고 밖(백드롭)에서 놓으면 닫지 않는다 — 입력창 글자 끌기', () => {
    const g = createBackdropGuard();
    g.down(false);
    expect(g.click(true)).toBe(false);
  });
  it('백드롭에서 누르고 모달 안에서 놓아도 닫지 않는다', () => {
    const g = createBackdropGuard();
    g.down(true);
    expect(g.click(false)).toBe(false);
  });
  it('pointerdown 없는 click(키보드 등)은 닫지 않고, 판정 뒤 상태가 비워진다', () => {
    const g = createBackdropGuard();
    expect(g.click(true)).toBe(false);
    g.down(true);
    expect(g.click(true)).toBe(true);
    expect(g.click(true)).toBe(false);
  });
  it('reset 은 대기 중인 pointerdown 을 버린다', () => {
    const g = createBackdropGuard();
    g.down(true);
    g.reset();
    expect(g.click(true)).toBe(false);
  });
});

describe('shouldRestoreFocus (포커스 복귀)', () => {
  const base = { wasTop: true, focusNowhere: true, focusInsideClosed: false, openerAlive: true };
  it('최상단이 닫히고 포커스가 비었으면 돌려준다', () => {
    expect(shouldRestoreFocus(base)).toBe(true);
    expect(shouldRestoreFocus({ ...base, focusNowhere: false, focusInsideClosed: true })).toBe(true);
  });
  it('열기 직전 요소가 사라졌으면 무시한다', () => {
    expect(shouldRestoreFocus({ ...base, openerAlive: false })).toBe(false);
  });
  it('아래 모달이 닫히는 경우는 건드리지 않는다', () => {
    expect(shouldRestoreFocus({ ...base, wasTop: false })).toBe(false);
  });
  it('그사이 다른 곳이 포커스를 가져갔으면 건드리지 않는다', () => {
    expect(shouldRestoreFocus({ ...base, focusNowhere: false, focusInsideClosed: false })).toBe(false);
  });
});
