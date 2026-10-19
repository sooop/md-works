// 스탠드얼론 문서의 수정 시각 판단(순수 함수). 번들 병합이 updatedAt 으로 '더 최신'을 가리므로,
// 내용이 실제로 바뀌지 않았는데 시각만 새로 찍으면 낡은 내용이 최신으로 분류돼 상대 기기의 더 새 편집을 덮는다.

/** 저장 직전 문서의 수정 시각. 내용이 같으면 이전 값을 그대로, 달라졌을 때만 now */
export function updatedAfterEdit(prev: { content: string; updated: number }, nextContent: string, now: number): number {
  return prev.content === nextContent ? prev.updated : now;
}
