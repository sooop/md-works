// 이력에 이름 붙은 버전으로 내용을 남긴다(충돌·삭제 같은 위험한 선택 전에 내용을 잃지 않게).
import { snapshot, listVersions, setVersionName } from './history';

/** 내용이 비어 있으면 아무것도 하지 않는다(이력은 빈 내용을 저장하지 않는다). 실패하면 예외를 던진다 */
export async function saveNamedVersion(docKey: string, content: string, name: string): Promise<void> {
  if (!content.trim()) return;
  await snapshot(docKey, content, true);
  const v = (await listVersions(docKey)).find((x) => x.content === content); // 최신순이라 방금 남긴(또는 같은 내용의 직전) 버전
  if (v) await setVersionName(docKey, v.id, v.name ? `${v.name} · ${name}` : name);
}
