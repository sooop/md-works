import { describe, it, expect } from 'vitest';
import { updatedAfterEdit } from '../../src/lib/docUpdated';

describe('updatedAfterEdit (H5)', () => {
  it('내용이 같으면 updated 를 그대로 둔다(열어 보기·내보내기 직전 저장으로 오염되지 않는다)', () => {
    expect(updatedAfterEdit({ content: '본문', updated: 100 }, '본문', 999)).toBe(100);
  });
  it('내용이 바뀌었을 때만 now 로 갱신한다', () => {
    expect(updatedAfterEdit({ content: '본문', updated: 100 }, '수정', 999)).toBe(999);
  });
});
