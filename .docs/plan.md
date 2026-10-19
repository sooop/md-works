# md-works 구현 계획 (초안)

## 0. 전제 (인터뷰 확정)
- 글 = .md 파일 1개. 글감은 전역 글감함(포스트잇)에 쌓이고 글에는 '붙이기/떼기'로만 연결한다. 글감끼리 수동 링크는 없다.
- 부가 데이터(이력·글감·코멘트·휴지통): 스탠드얼론은 IndexedDB, 서버 버전은 노트 폴더의 `.works/` 사이드카가 정본.
- 동기화 = 번들(zip) 통째 주고받기. 텔레그램은 올리기만 자동, 가져오기는 수동 드롭. 키 하드코딩 암호화(난독화 수준).
- 기본 편집 모드, 집필 보조는 글자 수/목표 분량 + 집중 모드. 폰은 글감 캡처·열람 위주.
- AI 연관 검색·claude-ex 동기화는 이번 범위 밖(어댑터 인터페이스만 남김).
- md-notes 현황: 약 5.6k 줄(Svelte5 + Milkdown Crepe). 이력(`history.ts`, 20개/IDB), 코멘트(`comments/`, 답글 없음), 백업(`archive.ts`), 두 셸(`ServerShell`/`StandaloneShell`)과 모드 모듈(`server-mode`/`standalone-mode`)이 이미 있다.

## 1. 단계

### P0. 포크 (직렬, 파일 복사는 cp 사용)
- `node_modules`, `dist*`, `bash.exe.stackdump` 를 제외하고 md-notes 를 D:\project\md-works 로 `cp` 복사 → `fd` 로 누락 검증.
- 이름 변경: package name, 빌드 산출물 `dist-html/md-works.html`, IDB DB 이름(`notes-*` → `works-*`: md-notes 와 같은 origin 에서 충돌 방지), 기본 포트 5273, 제목·README.
- 완료 조건: `npm i` 후 `npx svelte-check` 통과, 기존 기능 그대로.

### P1. 저장 계층 + 데이터 스키마 (직렬, 이후 전 단계의 기반)
- `WorksStore` 인터페이스: `versions / snippets / threads / trash / bundle` 5개 영역. 구현 2벌 — `idbStore`(스탠드얼론), `sidecarStore`(서버: `.works/…` JSON + `server/api.js` 라우트, 경로 탈출 방어 유지).
- 스키마(번들 병합이 id·updatedAt 으로 가능하도록 모든 레코드에 `id(uuid)`, `updatedAt`, `deletedAt?`):
  - Snippet {id, body(md), source{url,title,excerpt}?, color, createdAt, updatedAt, attachedDocs[], deletedAt?}
  - Thread {id, docId, anchor{quote,prefix,suffix}, messages[{id,text,ts}], resolved}
  - Version {id, docId, ts, content(압축), name?(고정)}
  - TrashEntry(글감 전용) = deletedAt 이 있는 Snippet, 복구 시 attachedDocs 로 재부착.
- 문서 식별: 스탠드얼론은 id, 서버는 경로(이름 변경 시 사이드카 이동).
- 완료 조건: 두 구현이 같은 단위 테스트 스위트(IDB 는 fake-indexeddb)를 통과.

### 병렬 구간 (P1 이후, 서로 다른 파일을 건드리므로 서브 에이전트 fan-out 가능)
- **A. 이력 v2**: `history.ts` 대체. 스냅샷 압축 저장(fflate), 솎아내기 정책(최근 1일 5분 간격 / 1주 시간당 / 이후 일 1개 / 이름 붙인 버전 영구), 버전 diff 화면(문단 단위 hunk), hunk 선택 복구와 전체 복구, 복구 직전 자동 스냅샷. 컴포넌트 `HistoryPanel` 확장.
- **B. 글감함**: 사이드바 '글감' 탭, 빠른 입력(텍스트·이미지 붙여넣기·URL → 원전 자동 채움은 제목 입력만), 색 라벨, 전문 검색, 글에 붙이기/떼기, 휴지통(검색·복구), 비슷한 글감 자동 제안(한글 n-gram + BM25, `search/` 코드 재사용), 본문 문구 선택 → '관련 글감 찾기' 패널. AI 연동용 `SuggestProvider` 인터페이스만 정의.
- **C. 코멘트 스레드**: `comments/` 를 messages 배열로 확장(기존 코멘트는 첫 메시지로 마이그레이션), 팝오버·사이드바에 답글 입력, '글감으로 보내기'(스레드를 Q&A 텍스트로 변환해 글감 생성, 코멘트는 삭제 = 이동). B 의 글감 생성 API 를 호출하므로 B 의 `createSnippet` 시그니처만 P1 에서 먼저 고정.
- **E. 집필 UI**: 편집 기본 모드(가져온 파일 읽기 규칙 삭제 여부는 확인 필요), 글자 수/목표 분량 표시, 집중 모드, 폰 레이아웃(사이드바 하단 시트, 글감 빠른 캡처 화면).

### P2. 번들 백업·동기화 (A·B·C 스키마가 굳은 뒤)
- 번들 포맷: `manifest.json` + `docs/*.md` + `.works/{versions,snippets,threads}.json` + `assets/`. md-notes `archive.ts` 확장.
- 가져오기 병합: 같은 id 는 updatedAt 최신 우선, 이력·휴지통은 합집합, 글 본문 충돌 시 양쪽 보존(이력에 상대 버전을 남기고 최신으로 교체). 가져오기 전 미리보기(추가/갱신/충돌 건수).
- 백업 알림(N일 무백업), 서버 버전은 종료·주기 시 `.works-backup/` 에 번들 기록, 비어 있는 새 origin 에서 복원 제안.
- 텔레그램 올리기: Bot API `sendDocument`(토큰·chat_id 는 localStorage 만), AES-GCM 하드코딩 키 암호화, 50MB 초과 시 이미지 분리 업로드. **CORS·한도는 PoC 로 먼저 검증.**
- 가져오기: 수동 드롭(복호화 후 같은 병합 경로).

### P3. 마감
- 문서(README·REQUIREMENTS), 두 모드 빌드(`npm run build`, `build:html`)·`svelte-check`, 병합·솎아내기·복구 회귀 테스트.

## 2. 병렬 위임 방침 (agent-routing 기준)
- P0 파일 복사 검증·이름 일괄 치환·스키마 단위 테스트 작성 = builder(haiku 5.5). A·B·C·E 구현 = worker(sonnet), 각자 소유 파일을 분리해 충돌 방지. P2 병합 로직과 완료 후 검수 = verifier(sonnet high).
- 개발 서버는 띄우지 않고 `svelte-check` 와 단위 테스트로 검증. 필요하면 다른 포트에서 격리.

## 3. 결정이 필요한 위험·회귀
1. **암호화 키(확정)**: 빌드 시 `.env`(예: `VITE_BUNDLE_KEY`)로 주입, 저장소에는 남기지 않는다. `.env.example` 에는 자리표시자만 둔다. 단일 HTML 에는 키가 포함되므로 파일을 가진 사람은 복호화 가능(난독화 수준).
2. **IDB 이름 변경(P0)**: md-notes 와 같은 origin 에서 쓰면 데이터를 읽지 못함. 기존 md-notes 글을 옮기려면 md-notes 의 zip 내보내기 → md-works 가져오기 경로 사용.
3. **읽기 모드 폐지(확정)**: 가져온 파일도 편집 모드로 연다. 이력이 우발 수정의 안전망.
4. **서버·스탠드얼론 이원화**: 저장 어댑터 2벌이라 테스트가 두 배. P1 의 공용 테스트 스위트로 완화.
5. **텔레그램 한도**: 업로드 50MB, 봇 다운로드 20MB → 가져오기를 수동으로 둔 이유. 번들이 50MB 를 넘으면 분할.

## 4. 추가 요구: 편집기 디자인 설정 (병렬 작업 F, 확정)
- 범위: 전역 설정 하나(글별 설정 없음). 서체는 시스템 설치 폰트 이름만 지정(폰트 파일 번들·외부 요청 금지 유지).
- 조절 항목: 본문 서체·크기·줄간격·자간 / 문단 간격·첫 줄 들여쓰기·정렬(양쪽/왼쪽) / 인용·코드·표·글감 인용 스타일 / 제목(H1~H6) 단계별 크기 배율·여백.
- 컬러 팔레트: 라이트·다크 각각 핵심 8~10색(CSS 변수와 매핑), 내장 프리셋(크림 기본, 종이 흰색, 세피아, 야간 등) 선택 후 색별 미세 조정, 대비(가독성) 경고.
- 이식: 디자인 설정 전체를 JSON 으로 내보내기·가져오기(스키마 검증 후 적용). 번들 백업에도 디자인 JSON 을 포함해 기기 간 이동.
- 구현 위치: `src/lib/design/*`(스키마·프리셋·적용), `Settings`/`DesignPanel` 컴포넌트, `app.css` 의 하드코딩 값을 변수로 치환.
