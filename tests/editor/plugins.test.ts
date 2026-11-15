import { describe, it, expect } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { createTableHeaderlessPlugin } from '../../src/lib/tableHeaderless';
import { createFootnotePlugin, refLabels } from '../../src/lib/footnotes';
import { makePlugin as makeComments, key as commentsKey } from '../../src/lib/comments/pmComments';
import { collect, PARTIAL_NOTICE } from '../../src/lib/search/pmSearch';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    table: { group: 'block', content: 'table_header_row table_row*' },
    table_header_row: { content: 'table_cell+' },
    table_row: { content: 'table_cell+' },
    table_cell: { content: 'paragraph' },
    footnote_definition: { group: 'block', content: 'paragraph', attrs: { label: { default: '' } } },
    footnote_reference: { group: 'inline', inline: true, atom: true, attrs: { label: { default: '' } } },
    text: { group: 'inline' },
  },
});
const n = schema.nodes;
const p = (t = '') => n.paragraph.create(null, t ? schema.text(t) : null);
const cell = (t = '') => n.table_cell.create(null, p(t));
const table = (head: string[], body: string[][] = []) => n.table.create(null, [
  n.table_header_row.create(null, head.map(cell)),
  ...body.map((r) => n.table_row.create(null, r.map(cell))),
]);
const mk = (docNode: ReturnType<typeof n.doc.create>, plugins: never[]) => EditorState.create({ doc: docNode, plugins });

describe('tableHeaderless 캐시', () => {
  const plugin = createTableHeaderlessPlugin();
  const decos = (s: EditorState) => plugin.props.decorations!.call(plugin, s);

  it('선택만 움직이면(활성 여부 그대로) 같은 DecorationSet 참조', () => {
    const doc = n.doc.create(null, [table(['', ''], [['a', 'b']]), p('끝'), p('뒤')]);
    const s0 = mk(doc, [plugin] as never);
    const d0 = decos(s0);
    expect(d0).not.toBeNull();
    const endPos = doc.content.size - 2;
    const s1 = s0.apply(s0.tr.setSelection(TextSelection.create(doc, endPos)));
    const s2 = s1.apply(s1.tr.setSelection(TextSelection.create(doc, endPos - 1)));
    expect(decos(s1)).toBe(decos(s2));
  });

  it('표 안으로 들어가 활성 여부가 바뀌면 새로 만든다', () => {
    const doc = n.doc.create(null, [table(['', ''], [['a', 'b']]), p('끝')]);
    const a = mk(doc, [plugin] as never);
    const s0 = a.apply(a.tr.setSelection(TextSelection.create(doc, doc.content.size - 1))); // 표 밖
    const s1 = s0.apply(s0.tr.setSelection(TextSelection.create(doc, 3))); // 표 안
    expect(decos(s1)).not.toBe(decos(s0));
  });

  it('문서가 바뀌면 다시 계산하고, 헤더가 비지 않으면 표식이 없다', () => {
    const doc = n.doc.create(null, [table(['제목', ''], [['a', 'b']]), p('끝')]);
    const s0 = mk(doc, [plugin] as never);
    expect(decos(s0)).toBeNull();
    const doc2 = n.doc.create(null, [table(['', ''], [['a', 'b']])]);
    const s1 = mk(doc2, [plugin] as never);
    expect(decos(s1)).not.toBeNull();
  });
});

describe('footnotes 캐시', () => {
  const plugin = createFootnotePlugin();
  const decos = (s: EditorState) => plugin.props.decorations!.call(plugin, s);
  const ref = (l: string) => n.footnote_reference.create({ label: l });
  const def = (l: string) => n.footnote_definition.create({ label: l }, p(l));

  it('선택만 바뀌면 같은 참조, 문서가 바뀌면 다시 계산', () => {
    const doc = n.doc.create(null, [n.paragraph.create(null, [schema.text('a'), ref('1')]), def('1')]);
    const s0 = mk(doc, [plugin] as never);
    const s1 = s0.apply(s0.tr.setSelection(TextSelection.create(doc, 1)));
    expect(decos(s1)).toBe(decos(s0));
    const s2 = s1.apply(s1.tr.insertText('x', 1));
    expect(decos(s2)).not.toBe(decos(s1));
  });

  it('각주가 없는 문서는 표식 없음, refLabels 는 처음 순서로 중복 제거', () => {
    expect(decos(mk(n.doc.create(null, [p('a')]), [plugin] as never))).toBeNull();
    const doc = n.doc.create(null, [n.paragraph.create(null, [ref('b'), ref('a'), ref('b')])]);
    expect(refLabels(doc)).toEqual(['b', 'a']);
  });
});

describe('pmComments entries 참조 유지', () => {
  const h = { onRanges() {}, onSelect() {}, onPick() {} };
  it('코멘트가 없으면 편집해도 같은 entries 배열', () => {
    const plugin = makeComments(h);
    const s0 = mk(n.doc.create(null, [p('abc')]), [plugin] as never);
    const s1 = s0.apply(s0.tr.insertText('x', 1));
    expect(commentsKey.getState(s1)!.entries).toBe(commentsKey.getState(s0)!.entries);
  });
  it('위치가 안 바뀌면 같은 배열, 바뀌면 새 배열', () => {
    const plugin = makeComments(h);
    const s0 = mk(n.doc.create(null, [p('abcdef')]), [plugin] as never);
    const s1 = s0.apply(s0.tr.setMeta(commentsKey, { entries: [{ id: 'c', from: 2, to: 4, resolved: false }] }));
    const e1 = commentsKey.getState(s1)!.entries;
    const s2 = s1.apply(s1.tr.insertText('x', 6)); // 코멘트 뒤에 입력
    expect(commentsKey.getState(s2)!.entries).toBe(e1);
    const s3 = s2.apply(s2.tr.insertText('y', 1)); // 앞에 입력
    const e3 = commentsKey.getState(s3)!.entries;
    expect(e3).not.toBe(e1);
    expect([e3[0].from, e3[0].to]).toEqual([3, 5]);
  });
});

describe('pmSearch collect 시간 예산', () => {
  const doc = n.doc.create(null, Array.from({ length: 50 }, () => p('foo bar foo')));
  it('예산 안이면 전부 찾고 truncated=false', () => {
    const r = collect(doc, 'foo', {});
    expect(r.hits.length).toBe(100);
    expect(r.truncated).toBe(false);
  });
  it('예산을 넘기면 그때까지만 쓰고 truncated=true', () => {
    let t = 0;
    const r = collect(doc, 'foo', { regex: true }, 200, () => (t += 100));
    expect(r.truncated).toBe(true);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.length).toBeLessThan(100);
  });
  it('안내 문구 상수', () => expect(PARTIAL_NOTICE).toContain('일부만'));
});
