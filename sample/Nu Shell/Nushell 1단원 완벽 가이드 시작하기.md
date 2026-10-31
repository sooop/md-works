# Nushell 1단원 완벽 가이드: 시작하기

Oct 28, 2026 · @KWON BONG SOO

이 가이드를 마치면 Nushell을 설치해 실행하고, `ls`와 `ps`의 결과를 정렬하고 걸러 내며, 막힐 때 `help`, `describe`, `explore`로 스스로 답을 찾을 수 있습니다. 대상은 터미널에서 `cd`와 `ls`를 써 본 정도의 초급자이고, 프로그래밍 경험은 필요 없습니다. 기준 버전은 0.116.x이며, 작성일(2026-10-28)에 GitHub 릴리스 페이지에서 확인한 최신 버전은 0.116.1(2026-10-04 공개)입니다.

## 왜 Nushell인가

기존 셸의 파이프는 종이에 인쇄된 표를 팩스로 넘기는 것과 같습니다. 받는 쪽은 글자를 다시 눈으로 읽고, 몇 번째 칸이 크기인지 세어 `awk`나 `cut`으로 잘라 내야 합니다. 이 방식이 취약한 이유는 `ls`의 출력이 사람이 읽으라고 만든 텍스트일 뿐, 열이라는 구조는 어디에도 기록되어 있지 않기 때문입니다.

Nushell은 엑셀 파일을 통째로 넘기는 쪽입니다. `ls`는 `name`, `type`, `size`, `modified` 열을 가진 테이블 값을 돌려주고, 파이프(`|`)는 그 값을 다음 명령에 그대로 전달합니다. 다음 명령은 칸을 세는 대신 열 이름으로 접근합니다. 화면에 보이는 격자는 마지막에 값을 그려 준 결과일 뿐입니다.

값에 타입이 있다는 점이 핵심 이점입니다. 공식 Quick Tour의 예에서 `size` 열은 문자열이 아니라 `filesize` 타입이어서, Nushell은 `1.1 kB`가 `812 B`보다 크다는 것을 압니다. 글자 순서로 정렬하지 않고 실제 크기로 정렬한다는 뜻입니다.

**흔한 오해.** Nushell은 "출력을 예쁜 표로 꾸며 주는 셸"이 아닙니다. 표는 겉모습이고 본질은 타입이 있는 값이 흐른다는 점입니다. 또 Nushell은 bash의 문법 호환 버전이 아니라 별도의 셸 겸 프로그래밍 언어이며, 공식 문서도 POSIX 호환을 목표로 하지 않는다고 밝힙니다. bash 스크립트를 그대로 붙여 넣어 실행하는 용도가 아닙니다.

**판단 기준(작성자 정리).** 하려는 일이 "열 단위로 고르고, 정렬하고, 걸러 내는 것"이면 Nushell의 장점이 크게 나타납니다. 외부 프로그램을 이어 붙이는 것이 전부라면 기존 셸과 차이가 작습니다.

## 설치와 실행

설치 방법은 많지만 결과는 같습니다. 실행 파일 이름이 `nu`(Windows는 `nu.exe`)인 프로그램이 PATH에 놓이면 끝입니다. 가장 간단한 경로부터 고르세요.

| 환경                       | 설치 명령                                                  | 비고                       |
| :----------------------- | :----------------------------------------------------- | :----------------------- |
| macOS, Linux (Homebrew)  | brew install nushell                                   | 가장 무난한 선택                |
| Windows (winget)         | winget install Nushell.Nushell                         | 기본은 현재 사용자 범위            |
| Windows (winget, 모든 사용자) | winget install Nushell.Nushell --override 'ALLUSERS=1' | --scope 플래그는 지원되지 않음     |
| Windows (Scoop)          | scoop install nu                                       | 패키지 이름이 nu임에 주의          |
| 모든 OS (npm)              | npm install -g nushell                                 | 플러그인이 포함되지 않음            |
| Rust가 있는 환경              | cargo install nu --locked                              | 기본 플러그인은 따로 설치           |
| 직접 내려받기                  | GitHub 릴리스의 압축 파일을 풀어 PATH 위치에 복사                      | Linux, macOS, Windows 제공 |

Debian과 Ubuntu는 공식 저장소를 등록한 뒤 설치합니다.

```sh
wget -qO- https://apt.fury.io/nushell/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/fury-nushell.gpg
echo "deb [signed-by=/etc/apt/keyrings/fury-nushell.gpg] https://apt.fury.io/nushell/ /" | sudo tee /etc/apt/sources.list.d/fury-nushell.list
sudo apt update
sudo apt install nushell
```

앞의 두 줄은 서명 키를 받아 저장하고 저장소 주소를 등록하는 단계이고, `apt update`로 목록을 갱신한 뒤 `apt install`로 설치합니다. RedHat 계열과 Alpine, Docker 이미지(`ghcr.io/nushell/nushell`)도 공식 설치 문서에 절차가 있습니다.

### 실행하고 버전 확인하기

설치 후 기존 셸에서 `nu`를 입력하면 Nushell이 열리고 프롬프트가 바뀝니다. 기존 셸 위에 또 하나의 셸이 실행된 것이므로, 나갈 때는 `exit`를 입력하면 원래 셸로 돌아갑니다.

```nu
nu --version
version
version | get version
version check
```

* `nu --version`은 기존 셸에서 실행해도 되는 방법으로, 버전 번호만 출력하고 끝납니다.
* `version`은 Nushell 안에서 쓰는 내장 명령입니다. 버전과 빌드 구성을 담은 **레코드**(이름이 붙은 칸들의 묶음)를 반환합니다.
* `version | get version`은 그 레코드에서 `version` 칸의 값만 꺼냅니다. `get`은 4단원에서 자세히 다루므로 지금은 "이름으로 칸을 꺼낸다"만 기억하세요.
* `version check`는 현재 버전이 최신인지 확인하는 하위 명령입니다. 네트워크가 필요합니다.

**주의.** 이 과정은 0.116.x 기준입니다. 플러그인을 쓰는 12단원 이후에는 플러그인 버전을 Nushell과 맞춰야 하므로, 지금 `version`으로 설치 버전을 적어 두는 습관을 들이세요.

## 기본 셸로 지정하기

"기본 셸"에는 두 층위가 있고 위험도가 다릅니다. 첫째는 터미널 프로그램이 새 창을 열 때 `nu`를 띄우도록 하는 것이고, 둘째는 운영체제의 로그인 셸 자체를 바꾸는 것입니다. 처음에는 첫째만 하세요. 첫째는 설정을 되돌리기 쉽고 시스템의 다른 프로그램에 영향을 주지 않습니다.

### 터미널 프로필에 지정하기

| 터미널                  | 설정 위치                                                   |
| -------------------- | ------------------------------------------------------- |
| GNOME Terminal       | 편집 > 환경설정 > 명령 탭에서 "내 셸 대신 사용자 지정 명령 실행"을 켜고 `nu` 경로 입력 |
| Kitty                | `kitty.conf`의 `shell` 항목에 `nu` 경로 입력                    |
| Konsole              | 설정 > 현재 프로필 편집 > 명령에 `nu` 경로 입력                         |
| Terminal.app (macOS) | 환경설정 > 프로파일 > 셸 탭에서 "명령 실행"에 경로를 넣고 "셸 내에서 실행"은 해제      |
| iTerm2               | 프로파일 > 명령을 "사용자 설정 셸"로 바꾸고 경로 입력                        |
| Windows Terminal     | 설정 > 새 빈 프로필 추가 후 "명령줄"에 `nu` 경로 입력, 시작 항목에서 기본 프로필로 선택 |

`nu`의 정확한 경로는 기존 셸에서 `which nu`로 확인합니다.

### 로그인 셸로 바꾸기 (Linux, BSD, macOS)

로그인 셸은 `chsh` 명령으로 바꿉니다. 일부 배포판은 `/etc/shells`에 등록된 셸만 허용하므로, 등록하지 않았다면 다음과 비슷한 오류가 납니다.

```sh
chsh: /home/username/.cargo/bin/nu is an invalid shell
```

이 경우 `which nu`로 나온 경로를 `/etc/shells` 파일 끝에 한 줄로 추가한 뒤 다시 `chsh`를 실행합니다.

**주의.** Nushell은 POSIX 호환을 목표로 하지 않습니다. 시스템의 일부 프로그램과 그 문서는 로그인 셸이 POSIX 호환이라고 가정하므로, 로그인 셸을 바꾸면 예기치 않은 문제가 생길 수 있습니다. 이것이 터미널 프로필 방식을 먼저 권하는 이유입니다(작성자 권고). 문제가 생기면 `chsh`로 원래 셸로 되돌릴 수 있으니 기존 셸 경로를 미리 메모해 두세요.

## 첫 명령 읽기: ls, sort-by, where, ps

이 절의 예제는 모두 공식 Quick Tour의 흐름을 따릅니다. 먼저 쳐 보고, 그다음 한 토막씩 읽어 보세요. 아래 출력의 파일 이름과 값은 설명용 예시이며 여러분의 화면과 다릅니다.

### 1. ls: 문자열이 아니라 테이블이 나온다

```nu
ls
```

```text
╭───┬───────────┬──────┬─────────┬──────────────╮
│ # │   name    │ type │  size   │   modified   │
├───┼───────────┼──────┼─────────┼──────────────┤
│ 0 │ notes.md  │ file │ 12.2 kB │ 2 days ago   │
│ 1 │ photos    │ dir  │  4.1 kB │ 3 weeks ago  │
│ 2 │ todo.txt  │ file │   812 B │ 5 hours ago  │
╰───┴───────────┴──────┴─────────┴──────────────╯
```

| #  | name     | type | size    | modified    |
| :- | :------- | :--- | :------ | :---------- |
| 0  | notes.md | file | 12.2 kB | 2 days ago  |
| 1  | photos   | dir  | 4.1 kB  | 3 weeks ago |
| 2  | todo.txt | file | 812 B   | 5 hours ago |

* 맨 왼쪽 `#` 열은 행 번호(0부터)이며 데이터가 아니라 표시용입니다.
* `name`, `type`, `size`, `modified`가 열 이름입니다. 앞으로 모든 명령은 이 이름으로 열을 가리킵니다.
* `size`는 문자열이 아닌 `filesize` 타입이고, `modified`는 날짜 타입이어서 "2 days ago"처럼 읽기 쉽게 표시됩니다.

### 2. sort-by와 reverse: 출력을 가공한다

```nu
ls | sort-by size | reverse
```

`ls`에는 정렬 옵션을 주지 않았습니다. 대신 `ls`의 **출력**을 파이프(`|`)로 `sort-by`에 넘깁니다. `sort-by size`는 `size` 열의 값 기준으로 오름차순 정렬하고, `reverse`는 행 순서를 뒤집어 큰 파일이 위로 오게 합니다. `filesize` 타입이라 `1.1 kB`가 `812 B`보다 크다는 것을 알기 때문에 숫자 크기대로 정렬됩니다. 같은 결과를 `ls | sort-by size --reverse`로도 얻을 수 있습니다.

이것이 Nushell의 기본 작법입니다. 명령 하나가 모든 옵션을 갖는 대신, 작은 명령들을 파이프로 이어 붙입니다.

### 3. where: 조건에 맞는 행만 남긴다

```nu
ls | where size > 10kb
```

`where`는 뒤에 오는 조건이 참인 행만 통과시키는 필터입니다. `size > 10kb`에서 `>`는 파일 저장이 아니라 **비교 연산자**입니다(bash와 다른 점, 다음 절 참고). `10kb`처럼 숫자 바로 뒤에 단위를 붙이면 `filesize` 값이 되므로, 크기 열과 단위까지 포함해 정확히 비교됩니다. `kb`는 1000바이트, `kib`는 1024바이트입니다.

### 4. ps: 같은 방식이 프로세스에도 통한다

```nu
ps
ps | where status == Running
ps | describe
```

`ps`도 Nushell에 내장된 크로스 플랫폼 명령으로, 실행 중인 프로세스를 `pid`, `ppid`, `name`, `status`, `cpu`, `mem`, `virtual` 열의 테이블로 돌려줍니다. 전통적인 Unix `ps`가 기본으로 현재 터미널의 프로세스만 보여 주는 것과 달리, Nushell의 `ps`는 기본으로 시스템의 모든 프로세스를 보여 줍니다. `ls`에서 익힌 `sort-by`와 `where`를 그대로 쓸 수 있다는 점이 요점입니다. `status`는 평범한 문자열이므로 `==`로 비교합니다.

### 5. 파이프 입력을 인자로 쓰기: \$in

```nu
ls
| sort-by size
| reverse
| first
| get name
| cp $in ~
```

명령이 길면 줄을 나눠 써도 한 줄로 쓴 것과 같습니다. 한 줄씩 읽어 보겠습니다.

1. `ls | sort-by size | reverse`: 큰 파일이 맨 위인 테이블.
2. `first`: 맨 위 한 행을 꺼냅니다. 결과는 한 행짜리 **레코드**(`name`, `type`, `size`, `modified` 칸을 가진 묶음)입니다.
3. `get name`: 그 레코드에서 `name` 칸의 값, 즉 파일 이름 문자열만 꺼냅니다.
4. `cp $in ~`: `cp`는 복사할 대상과 복사될 위치라는 두 인자가 필요합니다. 파이프로 들어온 값(앞 단계의 파일 이름)을 `$in`이라는 변수로 받아 첫 번째 인자로 쓰고, `~`(홈 디렉터리)를 두 번째 인자로 줍니다.

**주의.** 이 예제는 가장 큰 파일을 홈 디렉터리로 복사합니다. 홈에 같은 이름의 파일이 있으면 덮어쓸 수 있으니, 연습은 실제로 아무 파일이나 복사해도 괜찮은 폴더에서 하세요. `get`과 `select`의 차이는 4단원에서 다룹니다.

## bash와 달라지는 점

Nushell은 bash와 비슷해 보이는 문법이 많아서, 습관대로 쓰다가 막히는 지점이 정해져 있습니다. 1단원에서 꼭 알아야 할 네 가지만 다룹니다.

| 하고 싶은 일         | bash                     | Nushell                   |
| --------------- | ------------------------ | ------------------------- |
| 문자열을 파일에 저장     | `echo "hello" > out.txt` | `"hello" \| save out.txt` |
| 값 비교            | `test 4 -gt 7`           | `4 > 7` (결과 `false`)      |
| 값 출력            | `echo "hi"`              | `"hi"` 라고만 써도 됨           |
| 시스템의 외부 `ps` 실행 | `ps aux`                 | `^ps aux`                 |

### 1. `>`는 비교 연산자다

bash에서 `>`는 "출력을 파일로 보내라"는 뜻이었지만, Nushell에서는 현대 프로그래밍 언어처럼 "크다"는 비교입니다. 그래서 `ls | where size > 10kb`가 성립합니다. 파일 저장은 저장 전용 명령인 `save`를 파이프 끝에 붙입니다.

```nu
"hello" | save output.txt
```

### 2. echo는 출력이 아니라 값을 돌려준다

`echo "Hello, World"`는 화면에 같은 글자를 보여 주지만, 동작은 다릅니다. bash의 `echo`는 표준 출력에 글자를 쓰고, Nushell의 `echo`는 **값을 반환**하며 셸이 그 반환값을 화면에 그려 줍니다. 그래서 다음 비교가 참입니다.

```nu
"Hello, World" == (echo "Hello, World")
```

```text
true
```

문자열 자체가 이미 값이므로, `echo`를 쓸 자리에는 값만 써도 됩니다. 식이 값을 암묵적으로 돌려준다는 이 성질(암묵적 반환)은 6단원 이후 커스텀 명령에서 중요해집니다.

### 3. 한 식은 마지막 값만 돌려준다

세미콜론은 줄바꿈과 같은 역할을 합니다. 아래를 실행하면 40과 50은 평가되고 버려지며 마지막 60만 화면에 나옵니다.

```nu
40; 50; 60
```

중간 값을 화면에 꼭 보여야 할 때는 `print`를 씁니다. 지금은 "여러 값을 늘어놓아도 마지막 것만 남는다"만 기억하세요. 나중에 스크립트의 결과가 예상과 다를 때 가장 먼저 의심할 지점입니다.

### 4. 이름이 같으면 내장 명령이 먼저다: ^

`ls`, `ps`처럼 Nushell에 내장된 명령은 시스템의 같은 이름 프로그램보다 우선합니다. 시스템의 `ps`를 쓰고 싶으면 이름 앞에 캐럿 `^`을 붙입니다.

```nu
^ps aux
```

`^`가 붙으면 Nushell은 내장 명령이 아니라 외부 프로그램으로 실행합니다. 이 경우 출력은 테이블이 아니라 일반 텍스트입니다. 외부 명령의 종료 코드와 출력 처리는 9단원에서 자세히 다룹니다.

**미리 보기.** 이런 차이 덕분에 bash에서 `curl`과 `jq`를 이어 붙이던 일을 Nushell에서는 내장 명령 `http get` 하나와 `select`로 처리할 수 있습니다. JSON도 문자열이 아니라 테이블과 레코드로 바로 들어옵니다.

## 스스로 찾는 습관: help와 describe

Nushell은 명령이 많고 버전마다 바뀝니다. 외우는 것보다 막혔을 때 셸에게 묻는 습관이 더 오래 갑니다. 질문은 두 종류입니다. "이 명령은 어떻게 쓰나"는 `help`에게, "지금 파이프에 무엇이 흐르고 있나"는 `describe`에게 묻습니다.

### help: 명령 사용법 찾기

```nu
help ls
ls --help
help str join
help operators
help escapes
help --find filesize
help commands
```

| 입력                               | 하는 일                                        |
| -------------------------------- | ------------------------------------------- |
| `help ls` 또는 `ls --help`         | `ls`의 설명, 시그니처, 플래그, 예제 표시 (두 형태는 같은 도움말)   |
| `help str join`                  | 하위 명령(`str join`)의 도움말. 이름이 두 단어여도 그대로 붙여 씀 |
| `help operators`, `help escapes` | 연산자 목록, 문자열 이스케이프 목록                        |
| `help --find filesize` (`-f`)    | 명령 이름, 설명, 검색어에서 `filesize`가 들어간 항목 찾기      |
| `help commands`                  | 모든 내장 명령을 하나의 큰 테이블로 표시                     |

`help 단어`는 명령, 별칭(alias), 모듈 순서로 찾아 줍니다. 별칭, 외부 명령 선언, 모듈, 파이프와 리다이렉트도 각각 `help aliases`, `help externs`, `help modules`, `help pipe-and-redirect`로 볼 수 있습니다. 명령 이름을 모를 때는 `help --find 키워드`가 출발점입니다.

입력줄에서 `F1` 키를 누르면 도움말 메뉴가 열립니다. 명령(예: `ps`)을 검색한 뒤 Enter를 누르기 **전에** 아래 화살표로 예제 항목을 고르고 Enter를 치면, 그 예제가 입력줄에 채워져 바로 실행해 볼 수 있습니다.

### 도움말 읽는 법

도움말은 항상 같은 틀입니다. `help ls`에서 핵심만 옮기면 다음과 같습니다.

```text
Signature
> ls {flags} ...rest

Flags
  --all, -a: Show hidden files.
  --long, -l: Get all available columns for each entry ...
  --short-names, -s: Only print the file names, and not the path.
  --full-paths, -f: Display paths as absolute paths.

Parameters
  ...rest: The glob pattern to use.

Input/output types
  input: nothing   output: table
```

* `Signature`의 `{flags}`는 옵션을 받을 수 있다는 뜻이고, `...rest`는 같은 종류의 인자를 여러 개 받을 수 있다는 뜻입니다. `ls`는 경로나 글롭 패턴을 여러 개 줄 수 있습니다.
* `Flags`에서 `--all, -a`는 같은 옵션의 긴 이름과 짧은 이름입니다. 둘 중 아무거나 씁니다.
* `Input/output types`가 파이프 설계의 열쇠입니다. `ls`는 입력 `nothing`(파이프로 받을 값이 없음), 출력 `table`입니다. 그래서 `ls`는 파이프의 **맨 앞**에 오고, 뒤에 테이블을 받는 `where`나 `sort-by`가 이어집니다.

### describe: 흐르는 값의 타입 확인

```nu
'hello' | describe
ps | describe
ps | describe --detailed
```

```text
string
table<pid: int, ppid: int, name: string, status: string, cpu: float, mem: filesize, virtual: filesize> (stream)
```

`describe`는 파이프로 들어온 값의 타입과 구조를 알려 줍니다. 두 번째 결과는 `ps`가 열마다 타입이 다른 테이블이며, `mem`과 `virtual`은 `filesize`, `cpu`는 `float`임을 보여 줍니다. 끝의 `(stream)`은 이 값이 한 번에 만들어진 목록이 아니라 흘러오는 스트림이라는 표시로, 12단원에서 다시 만납니다. 플래그는 두 개입니다.

* `--detailed`(`-d`): 값의 세부 타입과 내용까지 중첩된 구조로 보여 줍니다. 레코드 안의 레코드, 리스트까지 한 칸씩 펼쳐 볼 때 씁니다.
* `--no-collect`(`-n`): 스트림을 미리 모으지 않고 타입을 봅니다.

**판단 기준(작성자 정리).** 예상과 다른 결과가 나오면 이 순서로 묻습니다. 첫째, 파이프 중간에 `| describe`를 끼워 어느 단계에서 타입이 어긋나는지 찾습니다. 둘째, 의심되는 명령의 `help`에서 `Input/output types`가 내 입력을 받는지 확인합니다. 셋째, 명령 이름을 모르면 `help --find`로 찾습니다.

## explore 맛보기

`explore`는 텍스트용 `less`의 테이블 버전입니다. 긴 출력이나 칸 안에 또 다른 테이블이 들어 있는 중첩 데이터를 화면 안에서 스크롤하고, 칸을 골라 안으로 파고들 수 있습니다. `help commands`의 결과에는 `params`, `input_output`처럼 칸 안에 표가 들어 있는 열이 있어서 연습 재료로 알맞습니다.

```nu
help commands | explore
ls | explore --index
$env.config | explore
```

### 따라 해 보기

1. `help commands | explore`를 실행합니다. 처음에는 **보기 모드**로 열립니다.
2. `Enter`(또는 `i`)를 눌러 **커서 모드**로 들어갑니다. 이제 방향키로 칸을 고를 수 있습니다.
3. 방향키로 `cp` 명령의 행까지 내려가고, 오른쪽으로 `params` 열로 이동합니다.
4. `Enter`를 한 번 더 누르면 그 칸 안의 표, 즉 `cp`가 받는 모든 인자 목록으로 들어갑니다.
5. `Esc`를 한 번 누르면 커서 모드에서 보기 모드로, 한 번 더 누르면 이전 화면으로 돌아가며, 맨 위 화면이면 `explore`를 종료합니다.

### 조작과 옵션

| 조작          | 키                                                     |
| ----------- | ----------------------------------------------------- |
| 이동          | 방향키, Vim 방식 `h` `j` `k` `l`, 페이지 이동 `Ctrl-f` `Ctrl-b` |
| Emacs 방식 이동 | `Ctrl-v` `Alt-v` `Ctrl-p` `Ctrl-n`                    |
| 칸 안으로 들어가기  | `Enter` 또는 `i`                                        |
| 내부 명령 실행    | `:` 입력 후 명령 이름. 전체 목록은 `:help`                        |

이 밖에 `Home`/`End`(또는 `g`/`G`)로 처음과 끝 행으로 이동하고, `/`와 `?`로 앞뒤 방향 검색을 하며 `n`/`N`으로 다음과 이전 결과로 넘어갑니다. 커서 모드에서 `t`는 표를 뒤집고 `e`는 중첩 데이터를 펼칩니다. `:` 뒤에는 `:help`(도움말), `:try`(현재 데이터에 대한 대화형 입력), `:nu 명령`(현재 데이터에 Nushell 명령 실행), `:q`(종료)를 쓸 수 있습니다. 종료는 `Esc`나 `q`로 화면 깊이만큼 빠져나와도 됩니다.

| 플래그             | 의미                          |
| --------------- | --------------------------- |
| `--index`, `-i` | 리스트를 볼 때 행 번호를 표시           |
| `--head false`  | 열 이름 줄을 숨김 (기본값은 `true`)    |
| `--tail`, `-t`  | 맨 아래로 스크롤한 상태에서 시작          |
| `--peek`, `-p`  | 종료할 때 커서가 있던 칸의 값을 출력으로 내보냄 |

`--peek`는 `explore`를 **눈으로 고르는 필터**로 바꿔 줍니다. 예를 들어 `$nu | explore --peek`로 열어 원하는 칸에서 종료하면 그 값이 다음 명령으로 흘러갑니다. 구조가 복잡한 JSON을 `open`으로 열어 이 방식으로 필요한 부분만 골라 저장하는 활용은 7단원에서 만나게 됩니다.

**참고.** `explore`는 터미널 화면을 점유하는 대화형 도구이므로 스크립트에 넣어 자동화하는 용도가 아닙니다. 사람이 데이터를 처음 훑어볼 때 씁니다.

## 실습 과제 풀이

과제는 두 부분입니다. `ls`와 `ps`의 출력을 `describe`로 비교하고, `help ls`에서 플래그 3개를 찾아 실제로 써 봅니다. 먼저 직접 해 본 뒤 아래와 비교하세요.

### A. describe로 두 출력 비교하기

```nu
ls | describe
ps | describe
```

두 결과 모두 `table<...>`로 시작합니다. 즉 `ls`와 `ps`는 같은 종류(테이블)의 값을 돌려줍니다. 차이는 괄호 안의 열 구성입니다.

| 비교 항목    | `ls`                               | `ps`                                                               |
| -------- | ---------------------------------- | ------------------------------------------------------------------ |
| 열        | `name`, `type`, `size`, `modified` | `pid`, `ppid`, `name`, `status`, `cpu`, `mem`, `virtual`           |
| 숫자 열의 타입 | `size`가 `filesize`                 | `pid`, `ppid`는 `int`, `cpu`는 `float`, `mem`과 `virtual`은 `filesize` |
| 날짜 열     | `modified`(날짜 타입)                  | 없음                                                                 |
| 공통점      | `name` 열이 문자열                      | `name` 열이 문자열                                                      |

열의 정확한 타입 표기는 운영체제와 버전에 따라 조금 다를 수 있으므로 실제 출력으로 확인하세요. 핵심 관찰은 두 가지입니다. 같은 `filesize` 타입이 `ls`의 `size`와 `ps`의 `mem`에 쓰이므로 두 곳 모두 `> 10kb` 같은 비교가 통한다는 것, 그리고 서로 다른 명령의 결과도 모두 "열이 있는 테이블"이라서 `where`와 `sort-by`를 똑같이 쓸 수 있다는 것입니다.

### B. help ls에서 플래그 3개 써 보기

`help ls`의 Flags 목록에서 세 개를 골라 실행합니다. 아래는 하나의 예입니다.

```nu
ls -a
ls -f
ls -as ~
ls -l | first
```

| 플래그                   | 의미             | 눈으로 확인할 것                          |
| --------------------- | -------------- | ---------------------------------- |
| `--all`, `-a`         | 숨김 파일까지 표시     | `.`으로 시작하는 파일이 목록에 추가됨             |
| `--full-paths`, `-f`  | 경로를 절대 경로로 표시  | `name` 열이 전체 경로로 바뀜                |
| `--short-names`, `-s` | 경로 없이 이름만 표시   | 위치를 지정해도 `name`이 이름만 남음            |
| `--long`, `-l`        | 사용 가능한 모든 열 표시 | 열이 크게 늘어남. 열 구성은 플랫폼마다 다르고 속도는 느려짐 |

짧은 플래그는 `-as`처럼 묶어 쓸 수 있습니다. `ls -as ~`는 숨김 파일을 포함해 홈 디렉터리의 이름만 보여 줍니다. `ls -l | first`는 `first`로 첫 행(레코드) 하나만 꺼내 `-l`이 만든 열을 한눈에 살피는 방법입니다. 그 밖에 `--du`(`-d`), `--directory`(`-D`), `--mime-type`(`-m`), `--threads`(`-t`)가 있습니다.

### 스스로 점검하기

1. `ls | sort-by size`가 글자 순서가 아니라 크기 순서로 정렬하는 이유는? `size`가 문자열이 아니라 `filesize` 타입이기 때문입니다.
2. `ps | where status == Running`에서 `status`는 무슨 타입인가? 문자열이므로 일반 문자열 비교 `==`를 씁니다.
3. `help ls`에서 입력이 `nothing`이라는 것은 무슨 뜻인가? 파이프로 받는 값이 없다는 뜻이므로 `ls`는 파이프라인의 맨 앞에 옵니다.
4. 도전: 홈 디렉터리에서 폴더만 골라 보세요. 힌트는 `ls -a ~ | where type == dir`입니다.

## 흔한 오해와 문제 해결

| 증상                              | 원인                                       | 해결                                              |
| ------------------------------- | ---------------------------------------- | ----------------------------------------------- |
| `nu`를 쳤더니 명령을 찾을 수 없다고 나옴       | 설치 위치가 PATH에 없거나, 설치 후 터미널을 다시 열지 않음     | 터미널을 새로 열고, 안 되면 설치 방법의 안내대로 실행 파일을 PATH 위치에 복사 |
| `cargo`나 `npm`으로 설치했는데 플러그인이 없음 | 이 두 방법은 플러그인을 함께 설치하지 않음                 | 1단원에서는 영향 없음. 플러그인을 쓰는 12단원에서 별도 설치             |
| `ls > files.txt`가 의도대로 동작하지 않음  | `>`는 파일 저장이 아니라 비교 연산자                   | `ls \| save files.txt`처럼 `save`를 파이프 끝에 사용      |
| `ps`나 `ls` 결과가 표가 아닌 일반 글자로 나옴  | 앞에 `^`를 붙여 시스템의 외부 프로그램을 실행함             | `^`를 빼고 내장 명령을 사용                               |
| 도움말에 있는 명령이 내 셸에 없거나 옵션이 다름     | 설치한 버전과 문서 버전이 다름                        | `version`으로 설치 버전을 확인하고, 해당 버전의 문서를 기준으로 읽기     |
| 인터넷의 옛 예제가 동작하지 않음              | Nushell은 버전 변화가 빨라 명령 이름이나 동작이 바뀐 경우가 있음 | 예제를 쓰기 전 `help 명령이름`으로 현재 시그니처를 확인              |
| `explore`에서 빠져나오지 못함            | 중첩 화면으로 들어간 상태                           | `Esc`를 화면 깊이만큼 반복. 맨 위 화면에서 한 번 더 누르면 종료        |
| 로그인 셸을 바꾼 뒤 일부 프로그램이 이상하게 동작    | 일부 프로그램이 POSIX 호환 셸을 가정함                 | `chsh`로 원래 셸로 복구하고 터미널 프로필 방식을 사용               |

어떤 문제든 가장 먼저 할 일은 같습니다. 지금 어느 셸 안에 있는지(`nu` 안인지 기존 셸인지) 확인하는 것입니다. `nu`를 실행하면 기존 셸 위에 새 셸이 열리므로, 프롬프트 모양이 달라졌는지 보고 필요하면 `exit`로 한 겹씩 나옵니다.

설정 파일의 위치가 궁금하면 Nushell 안에서 `$nu.config-path`를 입력해 보세요. 설정은 10단원에서 본격적으로 다룹니다.

## 명령 요약표와 정리

이 가이드에 나온 명령과 기호를 한곳에 모았습니다. 입력과 출력 타입은 공식 명령 문서의 표기를 따랐고, 표기가 없는 것은 공란으로 두었습니다.

| 명령 또는 기호    | 하는 일                                | 입력 → 출력          | 이 가이드의 예                        |
| ----------- | ----------------------------------- | ---------------- | ------------------------------- |
| `nu`        | Nushell 실행 (`--version`은 버전 출력)     |                  | `nu --version`                  |
| `exit`      | 현재 셸에서 나감                           |                  |                                 |
| `version`   | 버전과 빌드 구성 표시                        | nothing → record | `version \| get version`        |
| `ls`        | 디렉터리 항목을 테이블로 나열                    | nothing → table  | `ls -as ~`                      |
| `ps`        | 프로세스를 테이블로 나열                       | nothing → table  | `ps \| where status == Running` |
| `sort-by 열` | 열 값 기준 정렬 (`--reverse`로 내림차순)       |                  | `ls \| sort-by size`            |
| `reverse`   | 행 순서 뒤집기                            |                  | `ls \| sort-by size \| reverse` |
| `where 조건`  | 조건이 참인 행만 남김                        |                  | `ls \| where size > 10kb`       |
| `first`     | 첫 행 하나를 레코드로 꺼냄                     |                  | `ls \| first`                   |
| `get 열`     | 이름으로 칸의 값을 꺼냄                       |                  | `version \| get version`        |
| `cp 원본 대상`  | 복사. 인자 두 개                          |                  | `cp $in ~`                      |
| `save 파일`   | 입력 값을 파일에 저장                        |                  | `"hello" \| save output.txt`    |
| `print`     | 값을 즉시 화면에 출력                        |                  |                                 |
| `describe`  | 파이프 값의 타입 표시 (`-d` 상세, `-n` 수집 안 함) | any → any        | `ps \| describe`                |
| `help`      | 명령, 별칭, 모듈의 도움말 (`-f`로 검색)          | nothing → any    | `help --find filesize`          |
| `explore`   | 테이블용 대화형 페이저                        | any → any        | `help commands \| explore`      |
| `\|`        | 앞 명령의 출력을 뒤 명령의 입력으로                |                  | 전체                              |
| `$in`       | 파이프로 들어온 값을 담은 변수                   |                  | `cp $in ~`                      |
| `^명령`       | 내장 명령 대신 시스템의 외부 프로그램 실행            |                  | `^ps aux`                       |
| `>`         | 비교 연산자 (리다이렉션이 아님)                  |                  | `4 > 10`                        |

### 정리

핵심은 한 문장입니다. Nushell의 파이프에는 글자가 아니라 타입이 있는 값(테이블, 레코드, 문자열, `filesize` 등)이 흐르고, 화면의 표는 그 값을 그려 준 결과입니다. 그래서 칸을 세지 않고 열 이름으로 정렬하고 거르며, 막히면 `describe`로 값의 타입을, `help`로 명령의 입력과 출력 타입을, `explore`로 중첩된 내용을 직접 들여다볼 수 있습니다.

새로운 상황에서 스스로 판단하는 기준은 세 가지입니다. 첫째, 이 명령은 파이프에서 어떤 타입을 받아 어떤 타입을 내놓는가(`help`의 Input/output types). 둘째, 지금 파이프 중간에 흐르는 값은 무엇인가(`| describe`). 셋째, 내가 하려는 일은 행 거르기(`where`), 정렬(`sort-by`), 칸 꺼내기(`get`) 중 어느 것인가.

### 다음 단계

2단원에서는 이 가이드에서 `describe`로 곁눈질한 타입(string, int, float, bool, list, record, table)을 직접 만들어 보며 정식으로 익힙니다. 3단원부터는 파일을 읽고 쓰는 일상 작업으로 넘어갑니다. 다음 단원 전에 `help commands | explore`로 10분만 구경해 두면 이후 단원의 명령 이름이 훨씬 낯익게 느껴질 것입니다.

## 출처

아래 페이지는 2026-10-28에 직접 열어 확인했습니다. 명령 옵션과 키 조작은 공식 문서를 따랐고, 비유와 "판단 기준"으로 표시한 부분은 작성자의 정리입니다. 본문의 예제 출력(파일 이름, 크기 등)은 설명용으로 만든 값입니다.

* [Installing Nu](https://www.nushell.sh/book/installation.html): 설치 명령, `nu` 실행 파일 이름, 플러그인 관련 주의
* [Default Shell](https://www.nushell.sh/book/default_shell.html): 터미널별 설정, `chsh`와 `/etc/shells`, POSIX 비호환 경고
* [Quick Tour](https://www.nushell.sh/book/quick_tour.html): `ls`, `sort-by`, `where`, `ps`, `$in`, 도움말, `explore`
* [Thinking in Nu](https://www.nushell.sh/book/thinking_in_nu.html): `>`와 `save`, `echo`의 반환, 단일 반환값
* [Types of Data](https://www.nushell.sh/book/types_of_data.html): 레코드, 테이블, 파일 크기 단위
* [explore](https://www.nushell.sh/book/explore.html): 플래그, 키 조작, `:` 명령
* 명령 레퍼런스: [ls](https://www.nushell.sh/commands/docs/ls.html), [ps](https://www.nushell.sh/commands/docs/ps.html), [help](https://www.nushell.sh/commands/docs/help.html), [describe](https://www.nushell.sh/commands/docs/describe.html), [version](https://www.nushell.sh/commands/docs/version.html)
* [Nushell 릴리스 목록 (GitHub)](https://github.com/nushell/nushell/releases): 최신 릴리스 0.116.1(2026-10-04) 확인

**확인하지 못한 것.** 이 가이드의 명령은 실행 환경에서 `nu`를 직접 돌려 검증하지 못했고, 공식 문서의 설명과 예제에 맞춰 작성했습니다. `ls`와 `ps`의 열별 타입 표기, 도움말 출력의 줄 모양은 버전과 운영체제에 따라 조금 다를 수 있으니 실제 화면과 대조해 보세요.
