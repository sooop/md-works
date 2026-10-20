// 명령 팔레트(Ctrl+K · Ctrl+Space)의 공용 타입과 열림 상태. 명령 목록은 각 셸이 자기 모드에 맞게 만들어 팔레트에 넘긴다.
export interface Command {
  id: string;
  title: string;
  /** 목록에서 묶는 이름(파일·문서·찾기·보기·서식 …) */
  group: string;
  /** 단축키 표시(예: 'Ctrl+Alt+E'). 실행과는 무관한 안내다 */
  shortcut?: string;
  /** 검색에만 쓰는 낱말(영문 이름·별칭) */
  keywords?: string;
  /** false 를 돌려주면 목록에서 숨긴다(열린 문서가 있어야 하는 명령 등) */
  when?: () => boolean;
  run: () => void | Promise<void>;
}

export const palette = $state({ open: false });
export const openPalette = () => { palette.open = true; };
export const closePalette = () => { palette.open = false; };
export const togglePalette = () => { palette.open = !palette.open; };
