// 디자인 설정 공개 API (번들 백업 등 다른 모듈이 쓴다)
export { applyDesign, buildDesignCss } from './apply';
export { serializeDesign, parseDesign, loadDesign, defaultDesign } from './io';
export { contrastRatio, contrastWarnings } from './colors';
export { buildFontFamily } from './fontStack';
export type { Design, Palette, Typography } from './schema';
