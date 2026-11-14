// PWA 아이콘(직접 그린 SVG: 노트 + 연필). maskable 은 OS 가 모서리를 잘라내므로 안전 영역(가운데 80%)에 그림을 모은다.
const NOTE = `<rect x="3" y="2" width="21" height="27" rx="3.5" fill="#4f46e5"/><g stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".9"><path d="M8.5 9.5h11M8.5 14.5h11M8.5 19.5h6"/></g><g transform="translate(21 21) rotate(45)" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"><rect x="-3" y="-12" width="6" height="3.5" rx="1" fill="#f472b6"/><rect x="-3" y="-8.5" width="6" height="12.5" fill="#fbbf24"/><path d="M-3 4h6l-3 5z" fill="#fde7c0"/></g><path d="M-.9 7.3h1.8L0 9z" transform="translate(21 21) rotate(45)" fill="#374151"/>`;

/** 크림 테마 배경색(presets.ts 의 cream light.bg) */
export const PWA_BG = '#faf9f5';

export const ICON_ANY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${NOTE}</svg>\n`;
// 배경을 가득 채우고 그림은 62% 로 줄여 가운데에 둔다
export const ICON_MASKABLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${PWA_BG}"/><g transform="translate(16 16) scale(.62) translate(-15 -16)">${NOTE}</g></svg>\n`;
