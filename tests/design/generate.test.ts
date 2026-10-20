import { describe, it, expect } from 'vitest';
import { mulberry32, hexToHsl, hslToHex, hexToHsv, hsvToHex, varyPalette, randomTheme, blendOver } from '../../src/lib/design/generate';
import { PRESETS } from '../../src/lib/design/presets';
import { PALETTE_KEYS } from '../../src/lib/design/schema';
import { contrastWarnings, contrastRatio, normalizeHex, hexToRgb } from '../../src/lib/design/colors';

describe('색 변환', () => {
  it('HSL·HSV 왕복이 거의 같은 색으로 돌아온다', () => {
    for (const hex of ['#b45434', '#2e3440', '#fafafa', '#000000', '#ffffff', '#12ab9f']) {
      const a = hexToRgb(hslToHex(hexToHsl(hex)));
      const b = hexToRgb(hsvToHex(hexToHsv(hex)));
      const o = hexToRgb(hex);
      for (let i = 0; i < 3; i++) { expect(Math.abs(a[i] - o[i])).toBeLessThanOrEqual(1); expect(Math.abs(b[i] - o[i])).toBeLessThanOrEqual(1); }
    }
  });
  it('blendOver: 0% 는 바탕, 100% 는 그 색', () => {
    expect(blendOver('#ffffff', '#000000', 0)).toBe('#ffffff');
    expect(blendOver('#ffffff', '#000000', 100)).toBe('#000000');
    expect(blendOver('#ffffff', '#000000', 50)).toBe('#808080');
  });
});

describe('mulberry32', () => {
  it('같은 시드는 같은 수열, 값은 [0,1)', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 20; i++) { const x = a(); expect(x).toBe(b()); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });
});

describe('randomTheme', () => {
  it('여러 시드에서 모든 색이 올바르고 가독성 기준을 지킨다', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const t = randomTheme(mulberry32(seed));
      for (const mode of ['light', 'dark'] as const) {
        const p = t[mode];
        for (const k of PALETTE_KEYS) expect(normalizeHex(p[k]), `seed ${seed} ${mode} ${k}`).toBe(p[k]);
        expect(contrastWarnings(p), `seed ${seed} ${mode}`).toEqual([]);
        expect(contrastRatio(p.text, p.bg), `seed ${seed} ${mode} text`).toBeGreaterThanOrEqual(6.9);
        expect(contrastRatio(p.text, p.surface), `seed ${seed} ${mode} surface`).toBeGreaterThanOrEqual(5.9);
        expect(contrastRatio(p.muted, p.bg), `seed ${seed} ${mode} muted`).toBeGreaterThanOrEqual(4.4);
        expect(contrastRatio(p.primary, p.bg), `seed ${seed} ${mode} primary`).toBeGreaterThanOrEqual(3.1);
      }
    }
  });
  it('바탕은 채도가 낮다(눈이 편한 범위)', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const t = randomTheme(mulberry32(seed));
      expect(hexToHsl(t.light.bg)[1], `seed ${seed}`).toBeLessThanOrEqual(20);
      expect(hexToHsl(t.dark.bg)[1], `seed ${seed}`).toBeLessThanOrEqual(20);
    }
  });
  it('시드가 같으면 같은 테마, 다르면 다른 테마', () => {
    expect(randomTheme(mulberry32(7))).toEqual(randomTheme(mulberry32(7)));
    expect(randomTheme(mulberry32(7)).light.bg).not.toBe(randomTheme(mulberry32(8)).light.bg);
  });
});

describe('varyPalette', () => {
  it('모든 프리셋을 변주해도 가독성 기준을 지키고, 색이 조금 바뀐다', () => {
    let changed = 0, total = 0;
    for (const pr of PRESETS) {
      for (const mode of ['light', 'dark'] as const) {
        if (pr.id === 'contrast') continue; // 고대비는 변주 대상이 아니다(이미 한계 대비)
        for (const strength of ['low', 'mid', 'high'] as const) {
          const v = varyPalette(pr[mode], mode, mulberry32(11), strength);
          expect(contrastWarnings(v), `${pr.id} ${mode} ${strength}`).toEqual([]);
          expect(contrastRatio(v.text, v.bg), `${pr.id} ${mode} ${strength} text`).toBeGreaterThanOrEqual(6.9);
          for (const k of PALETTE_KEYS) { total++; if (v[k] !== pr[mode][k]) changed++; }
        }
      }
    }
    expect(changed / total).toBeGreaterThan(0.6);
  });
  it('약한 변주는 강한 변주보다 원래 색에 가깝다(평균)', () => {
    const base = PRESETS.find((p) => p.id === 'moss')!.light;
    const dist = (a: string, b: string) => { const x = hexToRgb(a), y = hexToRgb(b); return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]); };
    const avg = (s: 'low' | 'high') => {
      let sum = 0, n = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const v = varyPalette(base, 'light', mulberry32(seed), s);
        for (const k of ['bg', 'surface', 'primary', 'accent'] as const) { sum += dist(v[k], base[k]); n++; }
      }
      return sum / n;
    };
    expect(avg('low')).toBeLessThan(avg('high'));
  });
});
