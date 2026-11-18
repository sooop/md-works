import { describe, it, expect } from 'vitest';
import { DEFAULT_VIEW, newLibraryState, libraryList, canReorderIn, neighborId } from '../../src/lib/snippets/library';
import type { Snippet } from '../../src/lib/works/types';

const mk = (id: string, docs: string[] = [], color: Snippet['color'] = 'yellow', body = id): Snippet =>
  ({ id, body, color, attachedDocs: docs, createdAt: 1, updatedAt: 1 }) as unknown as Snippet;

describe('보관함 상태', () => {
  it('기본 보기는 all', () => {
    expect(DEFAULT_VIEW).toBe('all');
    expect(newLibraryState()).toMatchObject({ open: false, view: 'all', color: '', query: '', selectedId: '' });
  });
  it('인스턴스마다 독립이다(모달 상태가 사이드바 상태와 공유되지 않는다)', () => {
    const a = newLibraryState(), b = newLibraryState();
    a.view = 'trash'; a.query = 'x';
    expect(b.view).toBe('all');
    expect(b.query).toBe('');
  });
});

describe('libraryList', () => {
  const active = [mk('a', ['d1']), mk('b', []), mk('c', ['d1'], 'blue')];
  const trashed = [mk('t')];
  it('all / doc / trash 보기', () => {
    expect(libraryList(active, trashed, { view: 'all', color: '', query: '' }, 'd1').map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(libraryList(active, trashed, { view: 'doc', color: '', query: '' }, 'd1').map((s) => s.id).sort()).toEqual(['a', 'c']);
    expect(libraryList(active, trashed, { view: 'trash', color: '', query: '' }, 'd1').map((s) => s.id)).toEqual(['t']);
  });
  it('색·검색어 필터', () => {
    expect(libraryList(active, trashed, { view: 'all', color: 'blue', query: '' }, '').map((s) => s.id)).toEqual(['c']);
    expect(libraryList(active, trashed, { view: 'all', color: '', query: 'b' }, '').map((s) => s.id)).toEqual(['b']);
  });
  it('열린 글이 없으면 doc 보기는 비어 있다', () => {
    expect(libraryList(active, trashed, { view: 'doc', color: '', query: '' }, '')).toEqual([]);
  });
});

describe('canReorderIn (사이드바 기준)', () => {
  const side = { view: 'doc' as const, phrase: '', query: '', color: '' };
  it('doc 보기이고 필터가 없을 때만', () => {
    expect(canReorderIn(side, 'd1')).toBe(true);
    expect(canReorderIn({ ...side, view: 'all' }, 'd1')).toBe(false);
    expect(canReorderIn(side, '')).toBe(false);
    expect(canReorderIn({ ...side, query: 'x' }, 'd1')).toBe(false);
    expect(canReorderIn({ ...side, phrase: ' x ' }, 'd1')).toBe(false);
    expect(canReorderIn({ ...side, color: 'red' }, 'd1')).toBe(false);
  });
  it('모달의 보기는 입력이 아니다: 사이드바 보기만 본다', () => {
    const modal = newLibraryState();
    modal.view = 'trash';
    expect(canReorderIn(side, 'd1')).toBe(true);
  });
});

describe('neighborId', () => {
  const l = [mk('a'), mk('b'), mk('c')];
  it('남아 있으면 그대로', () => expect(neighborId(l, l, 'b')).toBe('b'));
  it('사라지면 아래 이웃, 없으면 위 이웃', () => {
    expect(neighborId(l, [l[0], l[2]], 'b')).toBe('c');
    expect(neighborId(l, [l[0], l[1]], 'c')).toBe('b');
    expect(neighborId(l, [], 'a')).toBe('');
  });
});
