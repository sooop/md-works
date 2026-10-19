// 타자기 스크롤 계산 (순수 함수): 캐럿 줄을 뷰포트 세로 중앙 근처에 둔다.

export interface TypewriterInput {
  /** 캐럿 줄의 위·아래 (스크롤 컨테이너 뷰포트 상단 기준 px) */
  caretTop: number;
  caretBottom: number;
  /** 스크롤 컨테이너 가시 높이 */
  viewHeight: number;
  /** 캐럿을 둘 세로 위치 비율 (기본 0.5) */
  anchor?: number;
  /** 이 거리 이내면 움직이지 않는다(미세 흔들림 방지, px) */
  deadZone?: number;
}

/** 스크롤해야 할 양(px, 양수=아래로). 0 이면 이미 중앙 근처. */
export function typewriterDelta({ caretTop, caretBottom, viewHeight, anchor = 0.5, deadZone = 24 }: TypewriterInput): number {
  if (!(viewHeight > 0)) return 0;
  const center = (caretTop + caretBottom) / 2;
  const diff = center - viewHeight * anchor;
  return Math.abs(diff) <= deadZone ? 0 : Math.round(diff);
}

/** 스크롤 가능한 범위로 보정한 목표 scrollTop */
export function clampScrollTop(current: number, delta: number, scrollHeight: number, viewHeight: number): number {
  return Math.max(0, Math.min(Math.max(0, scrollHeight - viewHeight), current + delta));
}
