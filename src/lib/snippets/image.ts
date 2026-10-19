// 글감에 넣을 이미지를 줄여 data URL 로 만든다 (브라우저 전용: 캔버스 사용)
import { fileToDataUrl } from '../utils';

export const MAX_SIDE = 1600;
/** data URL 문자열 길이 상한. 글감은 본문에 이미지를 그대로 담으므로 보관함이 비대해지지 않게 한다. */
export const MAX_DATA_URL = 1_500_000;

/** 축소 후 크기 (비율 유지, 확대 없음) */
export function fitSize(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** 최대 1600px 로 줄여 webp 로 인코딩한다. webp 를 못 만들면 원본 형식(없으면 png/jpeg)으로. 상한을 넘으면 오류. */
export async function imageToDataUrl(file: Blob): Promise<string> {
  let url: string | undefined;
  try {
    const bmp = await createImageBitmap(file);
    const { w, h } = fitSize(bmp.width, bmp.height);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    cv.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    for (const q of [0.85, 0.7, 0.5]) {
      const u = cv.toDataURL('image/webp', q);
      if (u.startsWith('data:image/webp')) { url = u; if (u.length <= MAX_DATA_URL) return u; }
      else break; // webp 미지원: 아래에서 원본 형식으로
    }
    if (!url) {
      const mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      url = cv.toDataURL(mime, 0.85);
    }
  } catch {
    url = await fileToDataUrl(file); // 디코딩 불가(예: svg) → 원본 그대로
  }
  if (url.length > MAX_DATA_URL) throw new Error(`이미지가 너무 큽니다 (줄인 뒤에도 ${(MAX_DATA_URL / 1_000_000).toFixed(1)}MB 초과)`);
  return url;
}
