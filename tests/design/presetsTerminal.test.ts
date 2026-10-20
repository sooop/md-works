import { describe, it, expect } from 'vitest';
import { TERMINAL_PRESETS } from '../../src/lib/design/presetsTerminal';
import { PALETTE_KEYS } from '../../src/lib/design/schema';
import { normalizeHex, contrastWarnings, contrastRatio } from '../../src/lib/design/colors';

describe('터미널 테마 프리셋', () => {
  for (const pr of TERMINAL_PRESETS) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${pr.name} ${mode}: 모든 색이 올바른 16진수이고 가독성 기준을 넘는다`, () => {
        const pal = pr[mode];
        for (const k of PALETTE_KEYS) expect(normalizeHex(pal[k]), `${k}=${pal[k]}`).toBe(pal[k]);
        expect(contrastWarnings(pal), JSON.stringify(contrastWarnings(pal))).toEqual([]);
        expect(contrastRatio(pal.text, pal.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(pal.primary, pal.bg)).toBeGreaterThanOrEqual(3);
      });
    }
  }
});
