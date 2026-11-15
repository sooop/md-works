// 서비스 워커 등록 상태 판단(순수 함수). 브라우저 API 와 분리해 테스트한다.
export type InstallKind = 'first' | 'update';

/** 새 워커가 installed 가 됐을 때: 이미 이 페이지를 조종하는 워커가 있으면 갱신, 없으면 첫 설치 */
export function classifyInstall(hadController: boolean): InstallKind { return hadController ? 'update' : 'first'; }

/** controllerchange 에서 새로 고칠지: 사용자가 '새로 고침'을 눌렀고 아직 한 번도 새로 고치지 않았을 때만.
 * 첫 설치의 clients.claim() 이나 다른 탭의 갱신으로 생기는 controllerchange 에는 화면을 바꾸지 않는다 */
export function shouldReload(requested: boolean, reloaded: boolean): boolean { return requested && !reloaded; }
