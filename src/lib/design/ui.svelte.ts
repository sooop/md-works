// 디자인 편집 화면의 공유 상태: 편집·미리보기 대상 팔레트(라이트/다크). 편집기와 따로 떠 있는 미리보기 섬이 함께 쓴다.
export const dui = $state<{ mode: 'light' | 'dark' }>({
  mode: typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
});
