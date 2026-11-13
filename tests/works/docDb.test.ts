import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createDocDb, imageRefs, unusedImages, type DocRec } from '../../src/lib/works/docDb';

let n = 0;
/** 같은 DB 를 쓰는 두 '탭'(저장소 인스턴스 둘, 연결도 둘) */
const twoTabs = () => {
  const name = `works-docdb-${n++}`;
  return [createDocDb(name), createDocDb(name)] as const;
};
const rec = (id: string, content: string, extra: Partial<DocRec> = {}): DocRec => ({ id, name: `${id}.md`, content, updated: 1, ...extra });
const ID = (c: string) => c.repeat(36).slice(0, 36); // idb: 참조에 쓰는 36자 id 모양

describe('saveContent: 쓰기 전 검사', () => {
  it('base 가 DB 내용과 같으면 저장한다', async () => {
    const [a] = twoTabs();
    await a.create(() => rec('x', 'v1'));
    const r = await a.saveContent({ rec: rec('x', 'v2', { updated: 2 }), base: 'v1' });
    expect(r.kind).toBe('ok');
    expect((await a.get('x'))?.content).toBe('v2');
  });

  it('다른 탭이 먼저 저장했으면 충돌로 알리고 쓰지 않는다 (탭 1 편집 → 탭 2 한 글자)', async () => {
    const [t1, t2] = twoTabs();
    await t1.create(() => rec('x', 'v1'));
    // 탭 2 도 v1 을 읽어 둔 상태에서 탭 1 이 편집을 저장
    expect((await t1.saveContent({ rec: rec('x', 'v1 + 탭1', { updated: 2 }), base: 'v1' })).kind).toBe('ok');
    const r = await t2.saveContent({ rec: rec('x', 'v1a', { updated: 3 }), base: 'v1' });
    expect(r.kind).toBe('conflict');
    if (r.kind === 'conflict') expect(r.current.content).toBe('v1 + 탭1');
    expect((await t2.get('x'))?.content).toBe('v1 + 탭1'); // 덮어쓰지 않았다
  });

  it('충돌 뒤 다른 탭 내용을 기준(base)으로 다시 저장하면 통과한다 (덮어쓰기 선택)', async () => {
    const [t1, t2] = twoTabs();
    await t1.create(() => rec('x', 'v1'));
    await t1.saveContent({ rec: rec('x', 'A', { updated: 2 }), base: 'v1' });
    const c = await t2.saveContent({ rec: rec('x', 'B', { updated: 3 }), base: 'v1' });
    if (c.kind !== 'conflict') throw new Error('충돌이어야 한다');
    const again = await t2.saveContent({ rec: rec('x', 'B', { updated: 3 }), base: c.current.content });
    expect(again.kind).toBe('ok');
    expect((await t1.get('x'))?.content).toBe('B');
  });

  it('덮어쓰기를 정한 사이 또 바뀌었으면 다시 충돌이다', async () => {
    const [t1, t2] = twoTabs();
    await t1.create(() => rec('x', 'v1'));
    await t1.saveContent({ rec: rec('x', 'A', { updated: 2 }), base: 'v1' });
    await t1.saveContent({ rec: rec('x', 'A2', { updated: 3 }), base: 'A' });
    expect((await t2.saveContent({ rec: rec('x', 'B'), base: 'A' })).kind).toBe('conflict');
  });

  it('서로 다른 글은 방해 없이 저장된다', async () => {
    const [t1, t2] = twoTabs();
    await t1.create(() => rec('x', 'x1'));
    await t1.create(() => rec('y', 'y1'));
    expect((await t1.saveContent({ rec: rec('x', 'x2'), base: 'x1' })).kind).toBe('ok');
    expect((await t2.saveContent({ rec: rec('y', 'y2'), base: 'y1' })).kind).toBe('ok');
    expect((await t1.get('x'))?.content).toBe('x2');
    expect((await t1.get('y'))?.content).toBe('y2');
  });

  it('동시에 저장해도 하나만 이기고 하나는 충돌이다 (한 트랜잭션)', async () => {
    const [t1, t2] = twoTabs();
    await t1.create(() => rec('x', 'v1'));
    const [r1, r2] = await Promise.all([
      t1.saveContent({ rec: rec('x', 'A'), base: 'v1' }),
      t2.saveContent({ rec: rec('x', 'B'), base: 'v1' }),
    ]);
    expect([r1.kind, r2.kind].sort()).toEqual(['conflict', 'ok']);
    const final = (await t1.get('x'))?.content;
    expect(final).toBe(r1.kind === 'ok' ? 'A' : 'B');
  });

  it('DB 가 이미 같은 내용이면 충돌이 아니다(쓰지 않음)', async () => {
    const [t1, t2] = twoTabs();
    await t1.create(() => rec('x', 'v1'));
    await t1.saveContent({ rec: rec('x', 'same', { updated: 2 }), base: 'v1' });
    const r = await t2.saveContent({ rec: rec('x', 'same', { updated: 3 }), base: 'v1' });
    expect(r).toMatchObject({ kind: 'ok', wrote: false });
  });

  it('다른 탭이 바꾼 이름·폴더를 낡은 사본으로 되돌리지 않는다', async () => {
    const [t1, t2] = twoTabs();
    await t1.create(() => rec('x', 'v1', { name: '옛.md' }));
    await t1.patch('x', (cur) => ({ ...cur, name: '새.md', folder: 'f' }));
    const r = await t2.saveContent({ rec: rec('x', 'v2', { name: '옛.md' }), base: 'v1' });
    expect(r.kind).toBe('ok');
    expect(await t2.get('x')).toMatchObject({ name: '새.md', folder: 'f', content: 'v2' });
  });

  it('base 를 모르면(undefined) 안전하게 충돌로 본다', async () => {
    const [t1] = twoTabs();
    await t1.create(() => rec('x', 'v1'));
    expect((await t1.saveContent({ rec: rec('x', 'v2'), base: undefined })).kind).toBe('conflict');
  });
});

describe('지워진 글', () => {
  it('다른 탭이 지운 글을 저장하면 gone, recreate 면 다시 만든다', async () => {
    const [t1, t2] = twoTabs();
    await t1.create(() => rec('x', 'v1'));
    await t1.remove('x');
    expect((await t2.saveContent({ rec: rec('x', 'v2'), base: 'v1' })).kind).toBe('gone');
    expect(await t2.get('x')).toBeUndefined();
    expect((await t2.saveContent({ rec: rec('x', 'v2'), base: 'v1', recreate: true })).kind).toBe('ok');
    expect((await t1.get('x'))?.content).toBe('v2');
  });
});

describe('메타 변경(이름·폴더)', () => {
  it('내용은 DB 의 최신을 두고 이름만 바꾼다', async () => {
    const [t1, t2] = twoTabs();
    await t1.create(() => rec('x', 'v1'));
    await t1.saveContent({ rec: rec('x', 'v2', { updated: 2 }), base: 'v1' });
    const next = await t2.patch('x', (cur) => ({ ...cur, name: '바뀜.md' }));
    expect(next).toMatchObject({ name: '바뀜.md', content: 'v2' });
  });

  it('fn 이 던지면 쓰지 않고, 글이 없으면 undefined', async () => {
    const [t1] = twoTabs();
    await t1.create(() => rec('x', 'v1'));
    await expect(t1.patch('x', () => { throw new Error('겹침'); })).rejects.toThrow('겹침');
    expect((await t1.get('x'))?.name).toBe('x.md');
    expect(await t1.patch('없음', (c) => c)).toBeUndefined();
  });

  it('create 는 다른 탭이 만든 글을 보고 이름을 정한다', async () => {
    const [t1, t2] = twoTabs();
    await t1.create(() => rec('a', '', { name: '새 글.md' }));
    const made = await t2.create((all) => rec('b', '', { name: all.some((r) => r.name === '새 글.md') ? '새 글 (2).md' : '새 글.md' }));
    expect(made.name).toBe('새 글 (2).md');
  });

  it('patchMany 는 없는 글을 건너뛴다', async () => {
    const [t1] = twoTabs();
    await t1.create(() => rec('a', '1'));
    const out = await t1.patchMany(['a', '없음'], (c) => ({ ...c, folder: 'f' }));
    expect(out.map((r) => r.id)).toEqual(['a']);
  });
});

describe('폴더 목록', () => {
  it('탭마다 낡은 사본이어도 서로의 폴더를 지우지 않는다', async () => {
    const [t1, t2] = twoTabs();
    await t1.updateFolders((s) => s.add('A'));
    await t2.updateFolders((s) => s.add('B')); // 탭 2 는 A 를 모르지만 DB 의 최신에서 고친다
    expect((await t1.readFolders()).sort()).toEqual(['A', 'B']);
    await t1.updateFolders((s) => s.delete('A'));
    expect(await t2.readFolders()).toEqual(['B']);
  });
});

describe('이미지 정리(gc)', () => {
  const OLD = 0;
  const NOW = 10 * 60 * 1000;
  const GRACE = 5 * 60 * 1000;
  const putImg = (d: ReturnType<typeof createDocDb>, id: string, created: number) => d.idb('images', 'readwrite', (s) => s.put({ id, blob: new Blob(['x']), created }));
  const imgIds = async (d: ReturnType<typeof createDocDb>) => (await d.idb<{ id: string }[]>('images', 'readonly', (s) => s.getAll())).map((i) => i.id).sort();

  it('다른 탭이 방금 저장한 글이 참조하는 이미지는 (오래됐어도) 지우지 않는다', async () => {
    const [t1, t2] = twoTabs();
    const img = ID('a');
    await putImg(t1, img, OLD);
    // 탭 2 가 이미지를 넣은 글을 저장 — 탭 1 의 메모리 사본은 그것을 모른다
    await t2.create(() => rec('x', `![](idb:${img})`));
    const dead = await t1.gc({ extraContents: [], now: NOW, graceMs: GRACE });
    expect(dead).toEqual([]);
    expect(await imgIds(t1)).toEqual([img]);
  });

  it('아무도 참조하지 않는 오래된 이미지만 지운다(유예 안의 새 이미지·이력 참조는 남김)', async () => {
    const [t1] = twoTabs();
    const [orphan, fresh, inHistory] = [ID('b'), ID('c'), ID('d')];
    await putImg(t1, orphan, OLD);
    await putImg(t1, fresh, NOW - 1000);
    await putImg(t1, inHistory, OLD);
    const dead = await t1.gc({ extraContents: [`idb:${inHistory}`], now: NOW, graceMs: GRACE });
    expect(dead).toEqual([orphan]);
    expect(await imgIds(t1)).toEqual([fresh, inHistory].sort());
  });

  it('순수 함수: 참조 추출과 미참조 판정', () => {
    const a = ID('1');
    expect(imageRefs(`![](idb:${a}) 와 idb:${ID('2')}`)).toEqual([a, ID('2')]);
    expect(unusedImages([`idb:${a}`], [{ id: a, created: 0 }, { id: ID('3'), created: 0 }], NOW, GRACE)).toEqual([ID('3')]);
  });
});
