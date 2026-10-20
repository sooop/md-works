import { describe, it, expect } from 'vitest';
import { PRESETS } from '../../src/lib/design/presets';
import { PALETTE_KEYS } from '../../src/lib/design/schema';
import { normalizeHex, contrastWarnings, contrastRatio } from '../../src/lib/design/colors';

describe('모든 프리셋', () => {
  it('id 가 겹치지 않는다', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });
  for (const pr of PRESETS) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${pr.name} ${mode}: 올바른 색이고 가독성 기준을 넘는다`, () => {
        const pal = pr[mode];
        for (const k of PALETTE_KEYS) expect(normalizeHex(pal[k]), `${k}=${pal[k]}`).toBe(pal[k]);
        expect(contrastWarnings(pal), JSON.stringify(contrastWarnings(pal))).toEqual([]);
        expect(contrastRatio(pal.text, pal.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(pal.primary, pal.bg)).toBeGreaterThanOrEqual(3);
      });
    }
  }
  it('눈이 편한 라이트 바탕은 지나치게 밝지 않다(상대휘도 0.85 이하)', async () => {
    const { luminance } = await import('../../src/lib/design/colors');
    for (const id of ['sepia', 'gruvbox', 'moss', 'mist', 'graphite']) {
      const pr = PRESETS.find((p) => p.id === id)!;
      expect(luminance(pr.light.bg), id).toBeLessThanOrEqual(0.85);
    }
  });
});
