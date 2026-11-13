import { describe, expect, it } from 'vitest';
import { mergeRecs, planRemoteDoc } from '../../src/lib/works/remoteDoc';
import type { DocRec } from '../../src/lib/works/docDb';

const rec = (id: string, content: string, extra: Partial<DocRec> = {}): DocRec => ({ id, name: `${id}.md`, content, updated: 1, ...extra });

describe('planRemoteDoc', () => {
  const open = { docName: 'a.md', docContent: 'v1' };
  it('편집 중이 아니고 내용이 같으면 아무것도 하지 않는다', () => {
    expect(planRemoteDoc({ ...open, editing: false, db: { name: 'a.md', content: 'v1' } })).toEqual({ kind: 'none' });
  });
  it('편집 중이 아니고 내용이 다르면 조용히 다시 읽는다', () => {
    expect(planRemoteDoc({ ...open, editing: false, db: { name: 'a.md', content: 'v2' } })).toEqual({ kind: 'reload', name: 'a.md', content: 'v2' });
  });
  it('편집 중이면 내용을 건드리지 않는다(저장 때 충돌로 가린다)', () => {
    expect(planRemoteDoc({ ...open, editing: true, db: { name: 'a.md', content: 'v2' } })).toEqual({ kind: 'none' });
  });
  it('이름만 바뀌면 편집 여부와 무관하게 이름만 따른다', () => {
    expect(planRemoteDoc({ ...open, editing: true, db: { name: 'b.md', content: 'v1' } })).toEqual({ kind: 'rename', name: 'b.md' });
    expect(planRemoteDoc({ ...open, editing: false, db: { name: 'b.md', content: 'v1' } })).toEqual({ kind: 'rename', name: 'b.md' });
  });
  it('지워졌으면 편집 중이 아니면 닫고, 편집 중이면 묻는다', () => {
    expect(planRemoteDoc({ ...open, editing: false, db: undefined })).toEqual({ kind: 'closed' });
    expect(planRemoteDoc({ ...open, editing: true, db: undefined })).toEqual({ kind: 'gone-editing' });
  });
});

describe('mergeRecs', () => {
  it('DB 의 글로 사본과 base 를 갱신하고 사라진 글은 걷어 낸다', () => {
    const mem = new Map([['a', rec('a', 'old')], ['gone', rec('gone', 'g')]]);
    const base = new Map([['a', 'old'], ['gone', 'g']]);
    mergeRecs(mem, base, [rec('a', 'new'), rec('b', 'b1')], new Set());
    expect(mem.get('a')?.content).toBe('new');
    expect(base.get('a')).toBe('new');
    expect(mem.has('b')).toBe(true);
    expect(mem.has('gone')).toBe(false);
    expect(base.has('gone')).toBe(false);
  });

  it('저장하지 않은 글은 내용·base 를 지키고 이름·폴더만 따른다', () => {
    const mine = rec('a', '내 편집', { name: '옛.md' });
    const mem = new Map([['a', mine]]);
    const base = new Map([['a', 'old']]);
    mergeRecs(mem, base, [rec('a', '다른 탭', { name: '새.md', folder: 'f' })], new Set(['a']));
    expect(mem.get('a')).toMatchObject({ content: '내 편집', name: '새.md', folder: 'f' });
    expect(base.get('a')).toBe('old'); // 저장 때 DB 와 비교하려면 base 는 그대로여야 한다
  });

  it('저장하지 않은 글이 DB 에서 지워졌어도 남겨 둔다(저장 때 알리고 이력에 남기도록)', () => {
    const mem = new Map([['a', rec('a', '내 편집')]]);
    const base = new Map([['a', 'old']]);
    mergeRecs(mem, base, [], new Set(['a']));
    expect(mem.has('a')).toBe(true);
  });
});
