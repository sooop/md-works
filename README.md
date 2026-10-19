# md-works

Milkdown(Crepe) + Svelte 5 기반 **글쓰기용 Markdown 에디터**. [md-notes](../notes) 를 포크해 글감함·이력·코멘트 스레드·번들 백업 같은 집필 기능을 얹었다. 같은 소스에서 두 가지로 빌드한다.

| | 서버 버전 | 스탠드얼론 단일 HTML |
|---|---|---|
| 빌드 | `npm run build` → `dist/` + `server.js` | `npm run build:html` → `dist-html/md-works.html` |
| 글 | 루트 폴더의 `.md` 트리(열기·생성·이름변경·삭제·저장, 하위 폴더) | IndexedDB 에 여러 개 보관(폴더 없음). 열기·드롭·붙여넣기는 항상 새 글, `.md` 내보내기 |
| 이미지 | 글 옆 `assets/<글 이름>/` 파일 또는 Base64(설정 + 글별 변환) | IndexedDB Blob(`idb:<id>` 참조), 내보낼 때 Base64 로 되돌림 |
| 부가 데이터 | 노트 폴더의 `.works/`·`.comments/` 사이드카가 정본 | IndexedDB 가 정본 |
| 저장 | Ctrl+S + 자동 저장 기본 ON(입력 0.7초 후, 최대 10초) | 항상 자동 저장(입력 400ms 후, 탭 숨김·닫힘 시 즉시) |

`__MODE__`('server' | 'html') 빌드 상수로 셸(`ServerShell`/`StandaloneShell`)을 동적 import 해 쓰지 않는 모드의 코드는 번들에서 빠진다.

## 실행

```bash
npm install
npm run build
node server.js [루트폴더] [--port 5273] [--templates 템플릿폴더]   # 또는 npm start
```

- 단일 HTML 은 `npm run build:html` 후 `dist-html/md-works.html` 을 더블클릭으로 연다(서버 불필요). 저장소 루트의 `index.html` 은 개발 서버용 진입점이다.
- 개발: `NOTES_ROOT=<폴더> npm run dev`(Vite 개발 서버에 같은 API 가 붙는다, 포트 5273, `127.0.0.1`).
- docx 변환용 pandoc 엔진은 서버가 `node_modules/pandoc-wasm` 의 wasm 을 직접 제공한다(`GET /api/pandoc.wasm`). 실행 환경에도 `node_modules` 가 필요하다.

### 환경변수 (`.env.example` 참고)

우선순위: CLI 인자 > 실제 환경변수 > 앱 폴더의 `.env.production` > `.env`(`npm run dev` 는 Vite 규칙에 따라 `.env`·`.env.development`). 상대 경로는 서버를 실행한 폴더 기준.

| 변수 | 읽는 곳 | 의미 | 기본 |
|---|---|---|---|
| `NOTES_ROOT` | `server.js`, `vite.config.ts` | 노트 루트 폴더(CLI 첫 위치 인자가 우선) | 현재 폴더 |
| `NOTES_TEMPLATES` | 같음 | docx 템플릿 폴더(`--templates` 우선) | 앱 폴더의 `templates/` |
| `PORT` | `server.js` | 포트(`--port` 우선) | 5273 |
| `VITE_BUNDLE_KEY` | `src/lib/bundle/crypto.ts` (빌드 시 주입) | 번들 암호화 키. **빌드 때 코드에 박힌다** | 없음 |
| `WORKS_ALLOWED_HOSTS` | `server/api.js` | 기본(`127.0.0.1`·`localhost`·`[::1]`) 외에 허용할 Host 이름, 쉼표 구분(포트 제외). 역프록시용 | 없음 |

`VITE_BUNDLE_KEY` 가 비면 암호화(.mwb)·텔레그램 올리기를 쓸 수 없고 평문 zip 내보내기만 된다. 키를 바꾸면 이전 키로 만든 `.mwb` 는 새 빌드에서 열 수 없다.

## 기능 개요

- **글감함(포스트잇)**: 사이드바 '글감' 탭. 글은 .md 하나이고 글감은 전역 보관함에 쌓인다. 글에는 붙이기/떼기로만 연결한다. 텍스트·이미지 붙여넣기·URL 출처(제목·발췌는 직접 입력), 색 라벨 6종, 보기 3종('이 글에 붙은 것'/'전체'/'휴지통'), 검색. 비슷한 글감 제안(한글 단어 + 문자 2-gram BM25), 본문 선택을 글감으로 보내기.
- **글감 휴지통**: 하나뿐. 소프트 삭제(`deletedAt`) 후 복구하면 붙어 있던 글에 다시 붙는다. 완전 삭제는 묘비(`purged`)를 남겨 번들 병합이 되살리지 못하게 한다.
- **버전 이력**: 압축 저장. 24시간 이내는 전부, 이후 시간당 1개, 7일 초과는 일당 1개로 솎아낸다(이름 붙인 버전·최신 버전은 보존). 버전 간 diff(문단 단위 hunk) 후 hunk 선택 복구/전체 복구, 복구 직전 자동 스냅샷, 버전 이름 붙이기. 남기는 간격은 마지막 버전 후 5분.
- **코멘트 스레드**: 본문 선택 → '코멘트'. 답글(messages 배열), 해결 표시, 위치 잃음 재부착, 스레드를 글감으로 보내기(코멘트는 글감으로 바뀐다). 원문 .md 는 바뀌지 않는다. 코드 블록 안에는 달 수 없다.
- **집필 보조**: 하단 상태 표시줄(글자 수 공백 포함/제외, 선택 글자 수, 글별 목표 분량 진행 막대), 집중 모드(타자기 스크롤). 폭 720px 이하는 사이드바가 하단 시트로 열린다.
- **편집/읽기**: 모든 글을 **편집 모드로 연다**. 읽기 모드는 상단 토글(`Ctrl+E`)로만 들어가고 글을 옮기면 편집으로 돌아온다.
- **디자인 설정**: 전역 하나(글별 없음). 본문 서체(시스템 설치 폰트 이름)·크기(12~24)·줄간격·자간, 문단 간격·첫 줄 들여쓰기·정렬(왼쪽/양쪽), 인용·코드·표·글감 인용, 제목 H1~H6 배율. 라이트/다크 팔레트 10색, 프리셋 5종(크림 기본·종이·세피아·밤·고대비) + 색별 조정, 대비 경고, JSON 내보내기/가져오기(스키마 검증). 번들에도 포함된다.
- **검색**: 문서 안(`Ctrl+F`), 파일 이름(부분 문자열 + 한글 초성), 전체 본문(`Ctrl+Shift+F`). 대소문자·정규식 옵션 공유. 서버는 인덱스 없이 워커 스레드에서 읽는다(8초, 전체 500건/파일당 50건/파일 2MB 이하). 바꾸기·이력 검색·이미지 검색 없음.
- **가져오기·내보내기**: .md/.txt 붙여넣기, .md/.txt/.docx 드롭(서버는 선택 폴더에 생성, 같은 이름은 `이름 (2).md`), docx 내보내기(pandoc-wasm 워커, 템플릿 선택). 스탠드얼론은 docx 를 처음 쓸 때 pandoc 엔진(약 16MB)을 unpkg 에서 받아 IndexedDB 에 캐시한다(유일한 외부 요청, 단 텔레그램 올리기 제외).
- **번들 백업·동기화**: 상단바 '백업'. 아래 참조.

### 번들 백업·동기화·텔레그램·서버 폴더 백업

- **번들** = 글·이미지·이력·글감·스레드·디자인을 담은 zip. 가져오기는 미리보기(추가/갱신/충돌 건수) 후 '병합 적용'. 같은 id 는 `updatedAt` 최신 우선, 이력·휴지통은 합집합, 글 본문이 양쪽에서 달라졌으면 진 쪽을 '병합 전' 이름의 버전으로 이력에 남긴다.
- **암호화**: `VITE_BUNDLE_KEY` → SHA-256 → AES-256-GCM. `.mwb` = `MWB1` + iv 12바이트 + 암호문·태그.
- **알림**: 마지막 백업이 N일(기본 7, 3/7/14/끔) 넘었고 이후 변경이 있으면 버튼 점 배지 + 시작 시 토스트.
- **텔레그램**: Bot API `getMe`/`sendMessage`/`sendDocument` 로 **올리기만** 자동(기본 30분, 최소 5분, 변경이 있을 때만). 파일명 `md-works-YYYYMMDD-HHmm.mwb`, 50MB 초과는 거부(분할 업로드 없음). 가져오기는 받은 파일을 앱에 끌어다 놓는 수동 방식. 토큰·chat_id 는 localStorage `works.telegram` 에만 있고 번들에 들어가지 않는다. **브라우저에서 api.telegram.org 직접 호출(CORS)은 실서버로 미검증**(코드는 fetch 를 주입한 모의 테스트만).
- **서버 폴더 백업**: `POST /api/backup`(200MB 상한)이 `<루트>/.works-backup/md-works-YYYYMMDD-HHmmss[-n].<mwb|zip>` 로 저장, 최근 10개 유지. `GET /api/backups`(목록), `GET /api/backup/file?name=`. 자동 백업 기본 켬·15분, 변경이 있을 때만.

## 저장 구조

### 스탠드얼론 (브라우저 IndexedDB)

| DB | 스토어 | 내용 |
|---|---|---|
| `works-standalone` (v3) | `kv`, `docs`, `images`, `comments` | 글, 이미지 Blob, 설정. `comments` 는 이전 방식 코멘트(글을 열 때 스레드로 이관) |
| `works-data` (v1) | `versions`, `snippets`, `threads` (keyPath `id`, 인덱스 `part`) | 이력·글감·스레드. 파티션 = 글 id(글감은 `_`) |
| `works-pandoc` (v1) | wasm 캐시 | docx 내보내기용 pandoc 엔진 |

### 서버 (노트 루트 아래, 모두 숨김 폴더라 트리·검색에서 제외)

```
.works/versions/<글 경로(%XX 이스케이프)>/<id>.json   이력
.works/snippets/_/<id>.json                          글감(휴지통 포함)
.works/threads/<글 경로>/<id>.json                    코멘트 스레드
.works-backup/md-works-YYYYMMDD-HHmmss.<mwb|zip>     폴더 백업(최근 10개)
.comments/<글 경로>.json                              이전 방식 코멘트(읽어서 스레드로 이관)
assets/<글 이름>/                                      글 옆 이미지
```

레코드는 한 건당 JSON 파일 하나, 공통 머리 `id`·`updatedAt`·`deletedAt?`. 쓸 때는 임시 파일 후 rename.

### localStorage 키

| 키 | 내용 |
|---|---|
| `notes.settings` | 앱 설정(자동 저장·이미지 방식 등). 옛 타이포 값은 디자인으로 1회 이관 |
| `notes.lastDoc` | 마지막으로 연 글 |
| `notes.searchOpts` | 검색 옵션(대소문자·정규식) |
| `works.design` | 디자인 설정(JSON) |
| `works.goal.<docKey>` | 글별 목표 분량 |
| `works.countSpaces` | 글자 수에 공백 포함 여부 |
| `works.backup` | 마지막 변경·백업 시각, 알림 일수, 폴더 백업 설정 |
| `works.telegram` | 텔레그램 토큰·chat_id·자동 올리기(번들 제외) |

(`notes.*` 접두는 md-notes 에서 물려받은 이름. DB 이름은 md-notes 와 충돌하지 않게 `works-*` 로 바꿨다.)

## 번들 형식 (`src/lib/bundle/api.ts`)

서버 노트 폴더 구조의 상위 집합이라 풀면 그대로 노트 폴더가 된다. 글 식별은 이름(서버는 경로).

```
manifest.json                       {schema:'md-works-bundle', version:1, createdAt, mode, app}
<경로>.md, assets/<문서명>/<n>.<ext>  글과 이미지
.works/docs.json                    {<글 이름>: {updatedAt}}
.works/versions/<글 이름>/<id>.json
.works/snippets/_/<id>.json
.works/threads/<글 이름>/<id>.json
.works/design.json                  serializeDesign() 결과
.works/tombstones.json              {docs:{<이름>:deletedAt}}  (현재 내보낼 때 항상 빈 값)
```

공개 함수: `buildBundle()`, `previewBundle(bytes)`, `applyBundle(bytes, {applyDesign?})`. 암호화는 호출자(`crypto.ts`)가 한다.

## 단축키 (코드에서 확인된 것만)

| 키 | 동작 | 위치 |
|---|---|---|
| `Ctrl+S` | 저장(스탠드얼론은 즉시 저장) | 두 셸 |
| `Ctrl+O` | 파일 가져오기(스탠드얼론만) | `StandaloneShell` |
| `Ctrl+P` | 인쇄(글이 열려 있을 때) | 두 셸 |
| `Ctrl+E` | 읽기/편집 전환 | `WritingLayer` |
| `Ctrl+F` / `Ctrl+Shift+F` | 문서 안 찾기 / 전체 검색(사이드바·대화상자 안에서는 브라우저 기본) | `search/state` |
| `Enter` / `Shift+Enter` | 찾기 다음/이전 | `FindBar` |
| `Ctrl+Alt+Enter` / `Esc` | 집중 모드 진입 / 해제 | `WritingLayer` |
| `Ctrl+Alt+M` | 선택 영역에 코멘트 | `CommentLayer` |
| `Ctrl+Alt+S` | 선택한 본문을 글감으로 | `SnippetPanel` |
| `Ctrl+Alt+G` | 선택한 본문으로 비슷한 글감 찾기 | `SnippetPanel` |
| `Ctrl+Enter` | 코멘트·글감 편집 저장, 붙여넣기 모달에서 만들기 | 각 컴포넌트 |
| `Esc` | 대화상자·패널·이미지 확대 닫기 | 각 컴포넌트 |
| 이미지 확대에서 `+`/`-`/`0` | 확대/축소/원래 크기 | `Lightbox` |

(`Ctrl` 은 macOS 의 `Cmd` 도 같이 받는 것이 많다. `Ctrl+Alt+*` 계열은 `e.code`/`e.key` 로만 확인했고 OS·IME 별 충돌은 미검증.) `Ctrl+N` 은 구현되어 있지 않다.

## 보안 메모

- 서버는 `127.0.0.1` 에만 바인딩한다.
- `/api/*` 는 Host 헤더가 허용 목록(로컬 3종 + `WORKS_ALLOWED_HOSTS`)에 없으면 403(DNS rebinding 방어). Origin 이 있으면 Host 와 같아야 한다.
- 루트 밖 경로는 symlink 해석까지 거부, 글은 `.md`·이미지 확장자만. 사이드카 파티션은 이스케이프 + 컬렉션 폴더 바로 아래 한 단계 검사. 깨진 퍼센트 인코딩 URL 은 400/500 으로 끝내고 서버는 죽지 않는다.
- 번들 암호화 키는 단일 HTML·번들 JS 에 포함되므로 **보안이 아니라 난독화 수준**이다. `.env` 는 gitignore 대상이다.
- 텔레그램 토큰은 localStorage 평문 저장이다. 외부 CDN·폰트 요청은 없다(pandoc 엔진 내려받기 예외).
- 서버 버전을 역프록시로 노출하는 구성의 안전성은 미검증이다(인증이 없다).

## 개발·테스트

```bash
npm test          # vitest run (tests/**/*.test.ts: 번들·이력·글감·스레드·디자인·집필·서버 보안)
npm run check     # svelte-check
```

IndexedDB 구현은 `fake-indexeddb` 로, 사이드카 구현은 같은 계약 테스트(`tests/works/contract.ts`)로 검증한다.

## 알려진 한계

- 글 삭제는 번들로 전파되지 않는다(`tombstones.json` 은 항상 비어 있다). 한쪽에서 지운 글은 동기화하면 되살아날 수 있다.
- 텔레그램: 50MB 초과 번들은 올릴 수 없다(분할 업로드 없음). 봇 다운로드 한도(20MB) 때문에 가져오기는 수동. CORS 동작 미검증.
- 비어 있는 새 origin 에서의 복원 제안은 코드에서 확인하지 못했다(미검증).
- 이력은 서버 모드에서 앱 밖에서 바꾼 파일 이름을 따라가지 못한다.
- 서버 버전은 외부 수정 충돌(mtime)을 검사하지 않는다.
- AI 연관 검색·claude-ex 동기화는 범위 밖이다(`SuggestProvider` 인터페이스만 둠).
- 검색 이동 위치는 마크다운 문법(링크 주소 등)만 일치한 항목이 있으면 한두 칸 어긋날 수 있다.
- 폰트는 시스템에 설치된 것만 쓴다(번들·호스팅 없음). 기본 `Pretendard Variable`, 없으면 시스템 폰트.
