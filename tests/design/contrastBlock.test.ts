import { describe, it, expect } from 'vitest';
import { contrastBlock, minTextContrast, MIN_APPLY_CONTRAST } from '../../src/lib/design/colors';
import { PRESETS } from '../../src/lib/design/presets';

const base = () => ({ ...PRESETS[0].light });

describe('색 편집 대비 하한(2.0:1)', () => {
  it('기준값은 2.0', () => {
    expect(MIN_APPLY_CONTRAST).toBe(2);
  });
  it('글자색=배경색(1.0:1)이 되는 편집은 막는다', () => {
    const p = base();
    const r = contrastBlock(p, 'text', p.bg);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(1, 1);
  });
  it('3.0 이상 4.5 미만은 막지 않는다(경고만)', () => {
    const p = { ...base(), bg: '#ffffff', surface: '#ffffff', muted: '#777777' };
    expect(contrastBlock(p, 'text', '#767676')).toBeNull();
  });
  it('2.0 이상 3.0 미만도 막지 않는다', () => {
    const p = { ...base(), bg: '#ffffff', surface: '#ffffff', muted: '#000000' };
    expect(contrastBlock(p, 'text', '#949494')).toBeNull(); // 약 3.0
    expect(contrastBlock(p, 'text', '#aaaaaa')).toBeNull(); // 약 2.3
  });
  it('2.0 미만이면 막는다', () => {
    const p = { ...base(), bg: '#ffffff', surface: '#ffffff', muted: '#000000' };
    expect(contrastBlock(p, 'text', '#cccccc')).not.toBeNull(); // 약 1.6
  });
  it('배경을 바꿔 본문과 같아지는 경우도 막는다', () => {
    const p = base();
    expect(contrastBlock(p, 'bg', p.text)).not.toBeNull();
  });
  it('이미 낮은 팔레트에서 대비를 개선하거나 무관한 색을 바꾸는 것은 허용한다', () => {
    const bad = { ...base(), text: base().bg };
    expect(minTextContrast(bad)).toBeLessThan(2);
    expect(contrastBlock(bad, 'text', '#000000')).toBeNull();
    expect(contrastBlock(bad, 'accent', '#ff0000')).toBeNull();
  });
  it('형식이 틀린 값은 판단하지 않는다', () => {
    expect(contrastBlock(base(), 'text', 'zzz')).toBeNull();
  });
  it('프리셋은 모두 하한을 넘는다', () => {
    for (const pr of PRESETS) {
      expect(minTextContrast(pr.light)).toBeGreaterThanOrEqual(2);
      expect(minTextContrast(pr.dark)).toBeGreaterThanOrEqual(2);
    }
  });
});
