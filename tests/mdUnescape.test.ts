import { describe, it, expect } from 'vitest';
import { isEscapedMarkdown, unescapeMarkdown } from '../src/lib/mdUnescape';

describe('mdUnescape', () => {
  const src = ['\\# 제목\\', '\\- 항목1\\', '\\- 항목2\\', '\\| a \\| b \\|\\', '\\|---\\|---\\|\\', '\\| 1 \\| 2 \\|'].join('\n');
  it('이스케이프된 마크다운을 감지', () => expect(isEscapedMarkdown(src)).toBe(true));
  it('일반 글은 감지하지 않음', () => expect(isEscapedMarkdown('# 제목\n- a\n- b')).toBe(false));
  it('이스케이프와 줄끝 \\ 를 푼다', () => expect(unescapeMarkdown(src)).toBe('# 제목\n- 항목1\n- 항목2\n| a | b |\n|---|---|\n| 1 | 2 |'));
});
