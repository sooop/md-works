import { describe, it, expect } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import type { DecorationSet } from '@milkdown/kit/prose/view';
import { createWikiLinkPlugin, collectSpans, key } from '../../src/lib/wikilink/plugin';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    code_block: { group: 'block', content: 'text*', code: true },
    image: { group: 'inline', inline: true, atom: true },
    text: { group: 'inline' },
  },
  marks: { inlineCode: { code: true } },
});
const n = schema.nodes;
const p = (...c: (string | ReturnType<typeof schema.text>)[]) => n.paragraph.create(null, c.map((x) => (typeof x === 'string' ? schema.text(x) : x)));
const code = (t: string) => schema.text(t, [schema.marks.inlineCode.create()]);

const handlers = { onOpen() {} };
const docs = [{ path: '회의록' }, { path: 'a/기획' }, { path: 'b/기획' }];
const mk = (doc: ReturnType<typeof n.doc.create>, d = docs) => {
  const plugin = createWikiLinkPlugin(handlers, d);
  return { plugin, state: EditorState.create({ doc, plugins: [plugin] }) };
};
const decos = (plugin: ReturnType<typeof createWikiLinkPlugin>, s: EditorState) => plugin.props.decorations!.call(plugin, s) as DecorationSet;
const classes = (plugin: ReturnType<typeof createWikiLinkPlugin>, s: EditorState) =>
  decos(plugin, s)!.find().map((d) => (d as unknown as { type: { attrs: { class: string } } }).type.attrs.class);

describe('collectSpans', () => {
  it('문단의 링크 범위를 문서 위치로 돌려준다', () => {
    const doc = n.doc.create(null, [p('앞 [[회의록]] 뒤')]);
    const [s] = collectSpans(doc);
    expect(doc.textBetween(s.from, s.to)).toBe('[[회의록]]');
    expect(s.target).toBe('회의록');
  });
  it('인라인 코드·코드 블록·이미지 뒤의 위치도 맞고, 코드 안은 링크가 아니다', () => {
    const doc = n.doc.create(null, [
      p(code('[[코드]]'), ' ', n.image.create(), ' [[진짜]]'),
      n.code_block.create(null, schema.text('[[블록]]')),
    ]);
    const spans = collectSpans(doc);
    expect(spans.map((s) => s.target)).toEqual(['진짜']);
    expect(doc.textBetween(spans[0].from, spans[0].to)).toBe('[[진짜]]');
  });
});

describe('링크 표시 데코레이션', () => {
  it('있는 글·없는 글·모호한 글을 구분해 칠한다', () => {
    const { plugin, state } = mk(n.doc.create(null, [p('[[회의록]] [[없는글]] [[기획]]')]));
    expect(classes(plugin, state)).toEqual(['wl wl-ok', 'wl wl-missing', 'wl wl-ambiguous']);
  });

  it('문서가 안 바뀌면(선택만 움직여도) 같은 DecorationSet 참조', () => {
    const doc = n.doc.create(null, [p('앞 [[회의록]] 뒤'), p('끝')]);
    const { plugin, state: s0 } = mk(doc);
    const s1 = s0.apply(s0.tr.setSelection(TextSelection.create(doc, 2)));
    const s2 = s1.apply(s1.tr.setSelection(TextSelection.create(doc, 5)));
    expect(decos(plugin, s1)).toBe(decos(plugin, s0));
    expect(decos(plugin, s2)).toBe(decos(plugin, s0));
  });

  it('문서가 바뀌면 다시 계산한다', () => {
    const { plugin, state: s0 } = mk(n.doc.create(null, [p('앞 [[회의록]] 뒤')]));
    const s1 = s0.apply(s0.tr.insertText('가', 1));
    expect(decos(plugin, s1)).not.toBe(decos(plugin, s0));
    expect(decos(plugin, s1)!.find().length).toBe(1);
  });

  it('링크가 없는 글을 편집하는 동안은 상태 객체가 그대로다', () => {
    const { plugin, state: s0 } = mk(n.doc.create(null, [p('그냥 글')]));
    const s1 = s0.apply(s0.tr.insertText('가', 1));
    expect(key.getState(s1)).toBe(key.getState(s0));
  });

  it('글 목록이 바뀌면 같은 범위를 다시 해석한다(없는 글 → 있는 글)', () => {
    const { plugin, state: s0 } = mk(n.doc.create(null, [p('[[새 글]]')]));
    expect(classes(plugin, s0)).toEqual(['wl wl-missing']);
    const s1 = s0.apply(s0.tr.setMeta(key, { docs: [...docs, { path: 'x/새 글' }] }));
    expect(classes(plugin, s1)).toEqual(['wl wl-ok']);
    expect(key.getState(s1)!.spans).toBe(key.getState(s0)!.spans); // 문서가 같으니 범위는 다시 뽑지 않는다
  });

  it('글 목록 경로가 같으면 다시 만들지 않는다', () => {
    const { plugin, state: s0 } = mk(n.doc.create(null, [p('[[회의록]]')]));
    const s1 = s0.apply(s0.tr.setMeta(key, { docs: docs.map((d) => ({ ...d })) }));
    expect(decos(plugin, s1)).toBe(decos(plugin, s0));
  });
});
