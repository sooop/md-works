# Nushell 3단원 완벽 가이드: 파일과 디렉터리 다루기

Oct 29, 2026 · @KWON BONG SOO

## 이 가이드의 목표

이 글을 읽고 나면 Nushell로 파일과 디렉터리를 조회하고, 이동하고, 읽고, 저장하고, 복사하고, 삭제할 수 있으며, 글롭 패턴과 `path` 명령으로 여러 파일을 한 번에 다룰 수 있습니다. 핵심은 이 모든 명령이 문자열이 아니라 테이블이나 값을 돌려준다는 점입니다. 그래서 4단원에서 배울 `where`, `sort-by`, `select`를 그대로 이어 붙일 수 있습니다.

가정한 독자는 터미널에서 `cd`, `ls`를 써 본 정도이며 프로그래밍 경험은 필요 없습니다. 1~2단원에서 `help`, `describe`, 리스트와 레코드, 파이프(`|`)를 익혔다고 가정합니다. 기준 버전은 Nushell 0.116.x 계열이고 학습 시간은 약 1~1.5시간입니다.

### 실습 준비

모든 예제는 홈 디렉터리 아래의 연습용 디렉터리 `nu-lab`에서 실행합니다. 실제 파일을 건드리지 않도록 아래 명령으로 먼저 만듭니다. 각 명령의 의미는 본문에서 하나씩 설명하므로, 지금은 그대로 붙여 넣기만 하면 됩니다.

```nu
cd ~
mkdir nu-lab
cd nu-lab
mkdir docs images data logs
"# 프로젝트 소개\n\nNushell 연습용 노트입니다.\n" | save docs/intro.md
"# 할 일\n\n- 3단원 읽기\n" | save docs/todo.md
"name,age,city\nkim,30,seoul\nlee,25,busan\npark,41,daegu\n" | save data/people.csv
'{"name": "nu-lab", "version": "0.1.0"}' | save data/config.json
touch images/a.png images/b.png logs/app.log
```

끝나면 아래 명령으로 파일 7개가 만들어졌는지 확인합니다. 결과가 7이면 준비가 끝났습니다.

```nu
ls **/* | where type == file | length
```

## 1. 핵심 개념: 파일 명령은 문자열이 아니라 테이블을 돌려준다

`ls`는 파일 이름을 줄바꿈으로 이어 붙인 글자가 아니라, `name`, `type`, `size`, `modified` 열을 가진 테이블을 돌려줍니다. 이 차이가 3단원 전체를 관통합니다. bash에서는 `ls -l | sort -k5 -n`처럼 "몇 번째 칸이 크기인지"를 사람이 세어서 글자를 잘라야 했지만, Nushell에서는 열 이름으로 바로 부르면 됩니다.

연습 디렉터리에서 직접 확인해 봅니다.

```nu
cd ~/nu-lab
ls
```

출력은 다음과 같은 모양입니다. 디렉터리의 크기와 시각은 운영체제와 실행 시점에 따라 달라지므로 값 자체보다 열 구성을 보세요.

| #  | name   | type | size   | modified  |
| :- | :----- | :--- | :----- | :-------- |
| 0  | data   | dir  | 4.1 kB | 2 min ago |
| 1  | docs   | dir  | 4.1 kB | 2 min ago |
| 2  | images | dir  | 4.1 kB | 2 min ago |
| 3  | logs   | dir  | 4.1 kB | 2 min ago |

### 왜 이 방식이 유리한가

파일 시스템 명령이 구조화된 값을 내면 "조회, 선별, 가공"이 하나의 파이프라인으로 이어집니다. 아래 한 줄은 `docs` 안의 파일을 크기 큰 순으로 정렬해 이름과 크기만 보여 줍니다. 문자열을 자르는 명령은 하나도 쓰지 않았습니다.

```nu
ls docs | sort-by size --reverse | select name size
```

이 줄의 각 부분은 다음과 같이 읽습니다.

|                          |                            |                            |
| ------------------------ | -------------------------- | -------------------------- |
| 부분                       | 역할                         | 비고                         |
| `ls docs`                | `docs` 디렉터리의 내용을 테이블로 돌려준다 | 입력이 없는 명령(nothing → table) |
| `sort-by size --reverse` | `size` 열을 기준으로 내림차순 정렬한다   | `--reverse` 없이는 오름차순       |
| `select name size`       | 두 열만 남긴다                   | 4단원에서 자세히 다룬다              |

### 값에도 타입이 있다

`size` 열의 값은 숫자가 아니라 파일 크기(filesize) 타입이고, `modified`는 날짜(datetime) 타입입니다. 그래서 `1MB` 같은 리터럴과 직접 비교할 수 있고, `where modified > ((date now) - 7day)`처럼 날짜 계산도 됩니다.

```nu
ls **/* | where size > 50b
ls **/* | where modified > ((date now) - 1day)
```

첫 줄은 50바이트를 넘는 항목을, 둘째 줄은 최근 하루 안에 수정된 항목을 고릅니다. 실습 파일은 방금 만들었으므로 둘째 줄은 전부 나옵니다.

### 흔한 오해

* `ls`의 출력을 글자로 보고 `grep`으로 거르려는 습관은 버려도 됩니다. `where name =~ "md"`처럼 열을 조건으로 거르는 편이 정확합니다.
* 화면에 표로 그려졌다고 해서 표 모양의 글자가 아닙니다. 표는 그냥 출력 방식이고, 파이프로 넘어가는 것은 값입니다. `ls | describe`를 실행해 `table<name: string, type: string, size: filesize, modified: datetime>` 같은 타입이 나오는지 확인해 보세요.
* 열 구성은 플랫폼과 플래그에 따라 달라질 수 있습니다. `ls --long`은 플랫폼에서 얻을 수 있는 열을 모두 보여 주며, 그 열은 운영체제에 따라 다릅니다.

## 2. 이동과 조회: ls, cd, mkdir

탐색의 기본은 세 명령입니다. `ls`는 보고, `cd`는 옮겨 가고, `mkdir`는 만듭니다. 이 세 명령만으로 연습 디렉터리의 어디든 오갈 수 있습니다.

### 2.1 현재 위치 알아보기

Nushell은 현재 디렉터리를 환경 변수 `PWD`에 보관합니다. 프롬프트에서 위치가 안 보일 때는 이 값을 읽습니다.

```nu
$env.PWD
```

`$env.PWD`는 `cd`가 바뀔 때마다 갱신되고, 직전 위치는 `$env.OLDPWD`에 남습니다. 뒤에서 볼 `cd -`가 바로 이 `OLDPWD`를 사용합니다.

### 2.2 ls: 조회

`ls`의 시그니처는 `ls {flags} ...rest`입니다. `...rest`는 글롭 패턴을 0개 이상 받는다는 뜻이고, 인수가 없으면 현재 디렉터리를 봅니다.

```nu
ls                 # 현재 디렉터리
ls docs            # 하위 디렉터리
ls docs images     # 두 경로를 한꺼번에
ls *.md            # 현재 디렉터리의 .md 파일 (글롭, 5절 참고)
```

자주 쓰는 플래그는 다음과 같습니다. 모두 공식 문서의 `ls` 페이지 기준입니다.

| 플래그             | 짧은 형태 | 효과                                    | 예              |
| --------------- | ----- | ------------------------------------- | -------------- |
| `--all`         | `-a`  | 숨김 파일을 포함한다                           | `ls -a ~`      |
| `--short-names` | `-s`  | 경로 없이 이름만 보여 준다                       | `ls -s docs`   |
| `--full-paths`  | `-f`  | 절대 경로로 보여 준다                          | `ls -f docs`   |
| `--directory`   | `-D`  | 디렉터리의 내용이 아니라 디렉터리 자체를 보여 준다          | `ls -D docs`   |
| `--du`          | `-d`  | 디렉터리 크기를 내용물 합계(apparent size)로 계산한다  | `ls -d`        |
| `--long`        | `-l`  | 플랫폼이 제공하는 모든 열을 보여 준다(느림)             | `ls -l docs`   |
| `--mime-type`   | `-m`  | `type` 열에 MIME 형식을 보여 준다(파일 이름만으로 판단) | `ls -m images` |
| `--threads`     | `-t`  | 여러 스레드로 읽는다. 출력 순서가 일정하지 않다           | `ls -t **/*`   |

플래그를 묶는 것도 됩니다. `ls -as ~`는 숨김 파일을 포함하고 이름만 보여 줍니다.

```nu
ls -f docs                         # name 열이 절대 경로가 된다
ls -D docs                         # docs 자체 한 줄
ls -d | where type == dir          # 디렉터리 크기를 내용물 합계로 보기
ls -m images                       # type 열이 image/png 같은 값이 된다
```

`-D`와 `-d`는 대소문자만 다르지만 의미가 전혀 다릅니다. 유닉스 ls의 습관 때문에 `ls -d`를 디렉터리 자체 조회용으로 착각하기 쉽습니다. 현재 문서 기준으로 디렉터리 자체는 대문자 `-D`입니다. 글을 따라 하다 결과가 이상하면 `help ls`로 자신의 버전을 확인하세요.

**조회 결과를 가공하는 예.** `type` 열로 디렉터리와 파일을 나눌 수 있습니다.

```nu
ls | where type == dir                  # 디렉터리만
ls **/* | where type == file            # 하위 전체에서 파일만
ls **/* | where type == file | length   # 파일 개수
ls -s | get name                        # 이름만 리스트로 (list<string>)
```

마지막 줄의 `get name`은 테이블에서 한 열을 꺼내 리스트로 만듭니다. 이 리스트는 `each`나 `path` 명령에 바로 넘길 수 있어 뒤에서 자주 쓰입니다.

### 2.3 cd: 이동

`cd`는 디렉터리를 바꿉니다. 시그니처는 `cd {flags} (path)`이고, 플래그는 `--physical (-P)` 하나뿐입니다. 이 플래그는 `..`을 처리하기 전에 심볼릭 링크를 먼저 풀어서 실제 경로 기준으로 움직이게 합니다.

```nu
cd ~/nu-lab        # 홈 기준 경로
cd docs            # 하위 디렉터리
cd ..              # 한 단계 위
cd ...             # 두 단계 위 (점 하나가 한 단계씩 늘어난다)
cd ../images       # 형제 디렉터리
cd -               # 직전 디렉터리로 (cd $env.OLDPWD와 같다)
cd ~               # 홈 디렉터리
```

`cd` 없이 경로만 입력해도 이동합니다. 공식 문서도 "cd 자체는 종종 생략할 수 있다"고 설명합니다.

```nu
~/nu-lab/docs      # cd ~/nu-lab/docs 와 같다
..                 # cd .. 와 같다
```

**scope 규칙을 알아 두세요.** `cd`로 바뀐 위치는 현재 scope 안에서만 유지됩니다. 중괄호 블록이나 함수 안에서 `cd`를 하면 블록을 빠져나올 때 원래 위치로 돌아옵니다. 함수가 호출한 쪽의 위치를 바꾸려면 `def --env`를 써야 하는데, 이는 8단원에서 다룹니다.

```nu
do { cd docs; ls }      # docs를 보여 준 뒤
$env.PWD                 # 위치는 그대로 nu-lab이다
```

공식 문서의 `cd` 페이지에는 인수 없이 `cd`만 쓴 경우의 동작이 나와 있지 않으므로, 홈으로 갈 때는 `cd ~`를 명시하는 것이 안전합니다.

### 2.4 mkdir: 디렉터리 만들기

`mkdir`는 하위 경로까지 한꺼번에 만들고, 이미 있어도 오류를 내지 않습니다. bash의 `mkdir -p`와 같은 동작이 기본값입니다.

```nu
mkdir reports                      # 한 개
mkdir reports/2026/q4              # 중간 단계까지 한 번에
mkdir reports/2026/q4              # 이미 있어도 오류가 없다
mkdir a b c                        # 여러 개를 한 번에
mkdir -v out1 out2                 # 만들어진 경로를 절대 경로로 출력
mkdir --fail-if-exists reports     # 이미 있으면 오류
```

공식 책에는 Nushell의 `mkdir`에 `-p`를 붙이면 `Unknown Flag` 오류가 난다고 적혀 있습니다. bash 습관으로 `-p`를 붙이지 않도록 주의하세요. 이미 있을 때 오류가 필요하다면 `--fail-if-exists`를 씁니다.

**확인 질문.** `mkdir x/y/z`를 두 번 실행하면 두 번째에 무슨 일이 생길까요? 답은 "아무 일도 없다"입니다. 반대로 스크립트에서 중복 생성을 막고 싶다면 어떤 플래그가 필요할까요? `--fail-if-exists`입니다.

## 3. 파일 읽기와 저장: open, save

`open`은 확장자를 보고 알맞은 형식으로 해석해 값으로 돌려주고, `save`는 값을 확장자에 맞는 형식으로 바꿔 파일에 씁니다. 둘은 서로 반대 방향이므로 CSV를 읽어 JSON으로 저장하는 변환이 한 줄로 끝납니다.

### 3.1 open: 읽기

시그니처는 `open {flags} ...rest`이고 플래그는 `--raw (-r)` 하나입니다. 파일 경로를 인수로 주거나 파이프로 넘길 수 있습니다.

```nu
open data/people.csv          # 인수로 경로 지정
'data/people.csv' | open      # 파이프로 경로 전달 (같은 결과)
```

**어떻게 해석할지는 확장자가 정합니다.** `open`은 확장자에 맞는 `from <확장자>` 명령을 찾아 적용합니다. 그래서 `.csv`는 `from csv`, `.json`은 `from json`이 자동으로 쓰입니다. 공식 책은 구조화된 데이터로 바뀌는 형식으로 csv, json, toml, yaml(yml), tsv, xml, xlsx, nuon, SQLite 데이터베이스 등을 꼽으며, SQLite는 확장자가 아니라 파일 내용으로 판별한다고 설명합니다.

```nu
open data/people.csv
```

```text
╭───┬──────┬─────┬────────╮
│ # │ name │ age │  city  │
├───┼──────┼─────┼────────┤
│ 0 │ kim  │  30 │ seoul  │
│ 1 │ lee  │  25 │ busan  │
│ 2 │ park │  41 │ daegu  │
╰───┴──────┴─────┴────────╯
```

CSV가 곧바로 테이블이 되었으므로 4단원의 필터를 바로 이을 수 있고, `age`는 숫자로 해석되어 비교가 됩니다.

```nu
open data/people.csv | where age > 28            # kim, park
open data/people.csv | get name                  # [kim lee park]
open data/people.csv | sort-by age --reverse     # 나이 많은 순
```

JSON은 객체이면 레코드, 배열이면 리스트나 테이블이 됩니다. 필드는 `get`이나 점 표기로 꺼냅니다.

```nu
open data/config.json                    # record: name, version
open data/config.json | get version      # 0.1.0
open data/config.json | describe         # record<name: string, version: string>
```

**주의: 마크다운은 구조화 데이터로 열립니다.** 공식 책에 따르면 `.md` 파일도 문자열이 아니라 구조화된 값으로 해석되어, 제목, 문단, 목록 항목이 행으로 나뉩니다. 텍스트 그대로 읽고 싶다면 `--raw`를 붙이세요. 해석 결과의 정확한 열 구성은 버전에 따라 다를 수 있으니 `open docs/intro.md | describe`로 직접 확인해 보는 것이 좋습니다.

```
open docs/intro.md                 # 구조화된 값 (제목/문단 단위)
open --raw docs/intro.md           # 파일 내용 그대로
open docs/intro.md --raw           # 플래그 위치는 앞뒤
```

확장자를 모르는 파일(예: `.txt`, `.log`)은 해석 없이 내용이 하나의 큰 문자열로 돌아옵니다. 이 문자열은 `lines`로 줄 단위 리스트로 쪼갤 수 있습니다.

```nu
open --raw data/people.csv | lines                  # 4줄짜리 list<string>
open --raw data/people.csv | lines | length         # 4
open --raw data/people.csv | lines | first 2        # 헤더와 첫 데이터 행
```

`--raw`의 결과가 바이트로 보이면 문자열로 바꾸는 `decode utf-8`을 이어 붙입니다.

```nu
open --raw docs/intro.md | decode utf-8
```

확장자와 내용이 다른 파일은 `--raw`로 읽은 뒤 `from`으로 직접 해석합니다. 확장자가 `.conf`인 JSON 파일이라면 다음처럼 합니다.

```nu
open --raw app.conf | from json
```

여러 파일을 읽어 가공하는 예입니다. `insert`는 새 열을 추가하고, 중괄호 안의 `{|row| ...}`는 각 행을 `$row`로 받는 클로저입니다(6단원에서 자세히 배웁니다).

```nu
ls docs
| insert lines {|row| open --raw $row.name | lines | length }
| select name lines
```

```text
╭───┬───────────────┬───────╮
│ # │     name      │ lines │
├───┼───────────────┼───────┤
│ 0 │ docs/intro.md │     3 │
│ 1 │ docs/todo.md  │     3 │
╰───┴───────────────┴───────╯
```

행 순서는 파일 시스템에 따라 다를 수 있습니다.

### 3.2 save: 저장

시그니처는 `save {flags} (filename)`입니다. 입력으로 들어온 값을 파일에 씁니다.

| 플래그          | 짧은 형태 | 효과                                      |
| ------------ | ----- | --------------------------------------- |
| `--force`    | `-f`  | 이미 있는 파일을 덮어쓴다. 없는 상위 디렉터리도 만든다         |
| `--append`   | `-a`  | 파일 끝에 덧붙인다                              |
| `--raw`      | `-r`  | 변환 없이 원본 바이트 그대로 저장한다                   |
| `--progress` | `-p`  | 진행 막대를 보여 준다                            |
| `--stderr`   | `-e`  | 표준 오류를 별도 파일에 저장한다(`--raw`와 함께 쓸 때만 동작) |

**문자열은 그대로, 구조화된 값은 확장자에 맞춰 변환해서 씁니다.**

```nu
'save me' | save note.txt                         # 문자열은 글자 그대로
{ a: 1, b: 2 } | save sample.json                  # record -> to json
ls docs | select name size | save docs-list.csv    # table -> to csv
ls docs | select name size | save docs-list.nuon   # table -> to nuon
```

읽기와 쓰기를 이으면 형식 변환이 한 줄입니다.

```nu
open data/people.csv | save data/people.json
open data/people.json | get 0.name        # kim
```

첫 줄에서 `open`이 CSV를 테이블로 읽고, `save`가 확장자 `.json`을 보고 JSON으로 바꿔 씁니다.

**덮어쓰기는 `--force`를 줘야 합니다.** `save`는 이미 있는 파일을 기본적으로 덮어쓰지 않고 오류를 냅니다. 실수로 데이터를 잃지 않게 하는 안전장치입니다. 그래서 실습 준비 명령을 두 번 실행하면 두 번째에 오류가 납니다. 처음부터 다시 만들고 싶다면 `--force`를 붙입니다.

```nu
'new text' | save --force note.txt             # 덮어쓰기
'line 2'   | save --append note.txt            # 끝에 덧붙이기
open --raw note.txt                            # 덧붙인 결과 확인
'x' | save --force out/deep/dir/file.txt       # 상위 디렉터리까지 자동 생성
```

`--force`는 "덮어쓰기"와 "상위 디렉터리 생성"을 함께 허용한다는 점에 주의하세요. 경로의 오타 때문에 엉뚱한 곳에 디렉터리가 생길 수 있습니다.

**파일을 수정해 저장하는 전형적인 패턴**은 읽기, 가공, 저장을 파이프로 잇는 것입니다.

```nu
open data/config.json | upsert version "0.2.0" | save --force data/config.json
open data/config.json | get version              # 0.2.0
```

`upsert`는 필드가 있으면 값을 바꾸고 없으면 추가합니다. `open`이 파일 전체를 값으로 읽은 뒤 가공하므로, 같은 파일에 덮어써도 안전합니다. 반면 `open --raw`로 스트림을 읽으면서 같은 파일에 쓰는 것은 내용이 사라질 위험이 있으니 피하고, 새 이름으로 저장한 뒤 `mv`로 바꾸세요.

**원본 그대로 복사하려면 `--raw`.** 읽을 때와 저장할 때 모두 변환을 건너뜁니다.

```nu
open --raw data/people.csv | save --raw data/people-copy.csv
```

단순 복사는 `cp`가 더 간단합니다. 다만 "읽은 내용을 가공해서 저장"하는 흐름에서는 `save --raw`가 자연스럽습니다.

### 3.3 흔한 실수와 판단 기준

* 확장자가 `.txt`나 `.log`처럼 변환 규칙이 없는 파일에 테이블이나 레코드를 저장하면 오류가 날 수 있습니다. 이때는 `to json`, `to text`처럼 문자열로 먼저 바꿔서 저장하세요.
* `open`의 결과가 예상과 다르면 `| describe`로 타입부터 확인합니다. 구조화되었다고 생각했는데 문자열이거나, 그 반대인 경우가 대부분입니다.
* 판단 기준: 파일의 내용을 "데이터"로 다루고 싶다면 `--raw` 없이 `open`을, "글자"로 다루고 싶다면 `open --raw`를 씁니다.

## 4. 파일 조작: touch, mv, cp, rm

이 네 명령은 모두 Nushell에 내장된 명령이라 운영체제와 관계없이 같은 방식으로 동작하고, `help mv`처럼 내장 도움말로 문서를 볼 수 있습니다. 공통 규칙은 둘입니다. 대상은 글롭으로 여러 개를 줄 수 있고, 마지막 인수가 목적지인 명령(`mv`, `cp`)은 소스가 여러 개이면 목적지가 반드시 디렉터리여야 합니다.

### 4.1 touch: 빈 파일 만들기와 시각 갱신

`touch`는 파일이 없으면 빈 파일을 만들고, 있으면 수정 시각만 지금으로 바꿉니다. 내용은 건드리지 않습니다.

```nu
touch notes.txt                  # 새 빈 파일
touch a.txt b.txt c.txt         # 한 번에 세 개
touch -c maybe.txt               # 없으면 만들지 않는다 (--no-create)
touch -m notes.txt               # 수정 시각만 갱신 (--modified)
touch -d "yesterday" notes.txt   # 시각을 어제로 (--date)
touch -r docs/intro.md notes.txt # intro.md의 시각을 복사 (--reference)
```

| 플래그                                | 효과                                           |
| ---------------------------------- | -------------------------------------------- |
| `--no-create (-c)`                 | 파일이 없으면 만들지 않는다                              |
| `--modified (-m)`, `--access (-a)` | 수정 시각 또는 접근 시각만 바꾼다                          |
| `--date (-d)`                      | `"yesterday"`, `"-1 month"` 같은 문자열로 시각을 지정한다 |
| `--timestamp (-t)`                 | datetime 값으로 시각을 지정한다                        |
| `--reference (-r)`                 | 다른 파일의 시각을 복사한다                              |

시각을 조작하는 기능은 "최근 N일 안에 바뀐 파일" 같은 필터를 연습할 때 유용합니다.

```nu
touch -d "-3 days" old.txt
ls | where modified < ((date now) - 2day) | get name
```

### 4.2 mv: 이동과 이름 바꾸기

`mv`는 이동과 이름 바꾸기를 하나로 처리합니다. 마지막 인수가 이미 있는 디렉터리이면 그 안으로 이동하고, 아니면 그 이름으로 바뀝니다.

```nu
mv notes.txt docs/                 # docs 디렉터리 안으로 이동
mv docs/notes.txt docs/memo.txt    # 같은 디렉터리 안에서 이름 바꾸기
mv -v docs/memo.txt docs/note.txt  # 무엇을 했는지 표로 출력
```

`-v`를 붙이면 `source`, `destination`, `message` 열을 가진 테이블로 결과가 나옵니다. 이름 바꾸기에서는 `message`가 `renamed`로 표시됩니다.

여러 파일을 한꺼번에 옮길 때는 글롭을 씁니다. 목적지는 반드시 디렉터리입니다.

```nu
touch c.png d.png
mv *.png images/                   # 현재 디렉터리의 png를 images로
ls images | get name               # a.png b.png c.png d.png
```

플래그는 안전과 관련된 것이 중심입니다.

| 플래그                  | 효과                        |
| -------------------- | ------------------------- |
| `--no-clobber (-n)`  | 이미 있는 파일은 덮어쓰지 않는다        |
| `--interactive (-i)` | 덮어쓰기 전에 묻는다               |
| `--update (-u)`      | 소스가 더 새롭거나 목적지가 없을 때만 옮긴다 |
| `--force (-f)`       | 묻지 않고 덮어쓴다                |
| `--verbose (-v)`     | 수행한 작업을 표로 보여 준다          |
| `--all (-a)`         | `*`를 쓸 때 숨김 파일도 포함한다      |

### 4.3 cp: 복사

`cp`는 마지막 인수를 목적지로 보고 앞의 모든 인수를 복사합니다. 디렉터리를 복사하려면 `--recursive (-r)`가 필요합니다. 이 플래그를 빼먹으면 디렉터리 복사는 오류가 납니다.

```nu
cp docs/intro.md docs/intro-copy.md   # 파일 복사 (새 이름)
cp docs/intro.md images/              # 디렉터리 안으로 복사
cp *.txt docs/                        # 글롭으로 여러 개
cp -r docs docs-backup                # 디렉터리 통째로 복사
cp -r -v docs docs-backup2            # 복사하는 내용을 출력
cp -u data/people.csv backup.csv      # 새것이거나 없을 때만 복사
cp -n data/people.csv backup.csv      # 이미 있으면 덮어쓰지 않음
```

| 플래그                     | 효과                                                             |
| ----------------------- | -------------------------------------------------------------- |
| `--recursive (-r)`      | 디렉터리와 그 내용을 복사한다                                               |
| `--update (-u)`         | 소스가 더 새롭거나 목적지가 없을 때만 복사한다                                     |
| `--no-clobber (-n)`     | 이미 있는 파일은 덮어쓰지 않는다                                             |
| `--interactive (-i)`    | 덮어쓰기 전에 묻는다                                                    |
| `--preserve [목록]`       | 보존할 속성을 지정한다. 예: `--preserve [mode timestamps]` (기본은 mode만 보존) |
| `--progress (-p)`       | 진행 막대를 보여 준다                                                   |
| `--no-dereference (-P)` | 심볼릭 링크를 대상이 아니라 링크 자체로 복사한다                                    |
| `--all (-a)`            | `*`를 쓸 때 숨김 파일도 포함한다                                           |

`cp`는 기본적으로 모드(권한)만 보존합니다. 수정 시각까지 유지하고 싶다면 `--preserve [mode timestamps]`처럼 명시하세요.

### 4.4 rm: 삭제

`rm`은 되돌리기 어려운 명령이므로 플래그를 자세히 알아 두는 편이 좋습니다.

```nu
rm docs/intro-copy.md          # 파일 삭제
rm -r docs-backup docs-backup2 # 디렉터리는 -r이 필요
rm --trash old.txt             # 휴지통으로 (복구 가능)
rm --permanent old.txt         # 영구 삭제 (always_trash 설정을 무시)
rm -f ghost.txt                # 없는 파일이어도 오류를 내지 않음
rm -v old.txt                  # 처리한 경로를 표로 출력
```

| 플래그                       | 효과                                 |
| ------------------------- | ---------------------------------- |
| `--trash (-t)`            | 플랫폼의 휴지통으로 보낸다(Android, iOS 제외)    |
| `--permanent (-p)`        | 영구 삭제한다. 설정의 `always_trash`보다 우선한다 |
| `--recursive (-r)`        | 하위 디렉터리와 내용까지 지운다                  |
| `--force (-f)`            | 없는 파일에 대한 오류를 억제한다                 |
| `--interactive (-i)`      | 항목마다 확인한다                          |
| `--interactive-once (-I)` | 한 번만 확인한다                          |
| `--verbose (-v)`          | 처리한 경로를 표로 돌려준다                    |

`rm`이 휴지통으로 가는지 영구 삭제인지는 설정 `always_trash`에 따라 달라집니다. 삭제가 복구 가능한지는 설치마다 다를 수 있으므로, 의도를 분명히 하려면 매번 `--trash`나 `--permanent`를 직접 쓰세요.

**삭제 전에 미리 보기.** 글롭으로 지울 때는 먼저 같은 글롭으로 `ls`를 실행해 대상을 눈으로 확인합니다. 두 명령이 같은 글롭 규칙을 쓰기 때문에 `ls`에 나온 항목이 곧 `rm`의 대상입니다.

```nu
ls **/*.log          # 먼저 대상을 본다
rm --trash **/*.log  # 확인한 뒤에 지운다
```

조건에 맞는 파일을 지우는 패턴은 "조회, 선택, 이름 꺼내기, 삭제" 순서입니다. 아래는 크기가 0인 파일을 찾아 지우는 예입니다. 먼저 파이프 끝의 `each`를 빼고 결과를 확인한 뒤 붙이세요.

```nu
ls **/* | where type == file and size == 0b | get name          # 먼저 확인
ls **/* | where type == file and size == 0b | get name | each {|f| rm --trash $f }
```

마지막 줄에서 `each`는 이름 리스트의 각 항목을 `$f`로 받아 `rm`을 실행합니다. `each`는 6단원에서 자세히 배웁니다.

### 4.5 판단 기준

* 소스와 목적지를 구분해야 하는 명령(`mv`, `cp`)은 마지막 인수가 목적지라는 규칙만 기억하면 됩니다.
* 덮어쓰기가 걱정되면 `-n`(덮어쓰지 않기)이나 `-i`(묻기)를 습관으로 붙입니다.
* 지우기 전에는 항상 `ls`로 대상을 먼저 보고, 되돌릴 가능성이 조금이라도 있으면 `--trash`를 선택합니다.

## 5. 글롭 패턴: 여러 파일을 한 번에 고르기

글롭(glob)은 `*.md`처럼 와일드카드가 들어간 경로 패턴으로, 파일 이름 여러 개를 한 번에 가리키는 약식 표기입니다. `ls`, `cp`, `mv`, `rm`, `open`처럼 경로를 받는 명령은 이 패턴을 알아듣습니다. 이 절에서 가장 중요한 것은 와일드카드 문법 자체보다 따옴표를 쓰느냐 마느냐에 따라 의미가 달라진다는 점입니다.

### 5.1 기본 와일드카드

패턴 자체는 대부분의 셸과 같습니다. 이 표는 `ls`, `cp`, `mv`, `rm` 같은 명령에서 쓸 수 있는 기본 문법입니다.

| 패턴       | 의미                           | 예                     | 연습 디렉터리에서의 결과                      |
| -------- | ---------------------------- | --------------------- | ---------------------------------- |
| `*`      | 0개 이상의 아무 글자(디렉터리 경계는 넘지 않음) | `ls docs/*.md`        | `intro.md`, `todo.md`              |
| `**`     | 하위 디렉터리를 모두 내려가며 탐색          | `ls **/*.png`         | `images/` 안의 png 전부                |
| `?`      | 글자 정확히 한 개                   | `ls images/?.png`     | `a.png`, `b.png`, `c.png`, `d.png` |
| `[...]`  | 대괄호 안의 글자 중 하나               | `ls images/[ab].png`  | `a.png`, `b.png`                   |
| `[a-c]`  | 글자 범위                        | `ls images/[a-c].png` | `a.png`, `b.png`, `c.png`          |
| `[!...]` | 대괄호 안의 글자를 제외한 하나            | `ls images/[!a].png`  | `b.png`, `c.png`, `d.png`          |

표의 마지막 열처럼 결과를 예상한 뒤 실행해서 맞는지 비교해 보세요. 글롭은 예상과 결과를 맞춰 보는 연습이 가장 빠릅니다.

```nu
ls docs/*.md                       # docs 안의 마크다운
ls **/*.md                         # 어디에 있든 모든 마크다운
ls **/*                            # 숨김이 아닌 모든 항목 (하위 포함)
ls -a **/*                         # 숨김 항목까지 포함
ls **/*.md | length                # 개수만
ls images/?.png | get name         # 이름 리스트
```

두 가지 특성을 기억하세요.

* `*`는 디렉터리 경계(`/`)를 넘지 않습니다. `docs/*.md`는 `docs`의 바로 아래 파일만 가리키고, 더 깊은 곳까지 보려면 `**`를 씁니다.
* 숨김 파일은 기본적으로 `*`에 걸리지 않습니다. 포함하려면 `ls -a`처럼 `--all`을 줍니다. `cp`, `mv`, `rm`에도 `*`를 쓸 때 숨김 파일을 포함시키는 `--all (-a)` 플래그가 있습니다.

### 5.2 따옴표가 의미를 바꾼다

Nushell은 셸이 아니라 명령 자체가 글롭을 해석합니다. 이때 인수를 어떻게 쓰느냐에 따라 글롭으로 취급할지 글자 그대로 취급할지가 갈립니다. 공식 책의 `rm` 예제가 가장 선명합니다.

```nu
rm *myfile*      # 따옴표 없음: 글롭. 이름에 myfile이 들어간 파일을 모두 지운다
rm "*myfile*"    # 큰따옴표: 글자 그대로. 이름이 정확히 *myfile*인 파일만 지운다
rm `*myfile*`    # 백틱: 글롭. 첫 줄과 같다
```

정리하면 "맨 문자열과 백틱은 글롭, 작은따옴표와 큰따옴표는 리터럴"입니다. 이 규칙은 반대로도 쓸 수 있습니다. 이름에 `[`나 `*`가 실제로 들어간 파일을 다룰 때는 따옴표로 감싸 글롭 해석을 끕니다.

```nu
ls "[slug]"      # 이름이 [slug]인 디렉터리를 그대로 조회
ls '[slug]'      # 작은따옴표도 같다
```

**변수에 담긴 패턴은 글롭이 아닙니다.** 변수에 문자열을 넣어 `ls $pattern`으로 쓰면 리터럴로 취급됩니다. 변수로 글롭을 만들려면 다음 세 방법 중 하나를 씁니다(공식 책이 제시하는 방법입니다).

```nu
let month = (date now | format date '%Y-%m')

# 1. into glob으로 변환
ls ($"*($month)*" | into glob)

# 2. glob 명령의 결과를 펼쳐서(...) 전달
ls ...(glob $"*($month)*")

# 3. 타입 어노테이션으로 glob 타입 지정
let pattern: glob = $"*($month)*"
ls $pattern
```

`$"...(...)"`는 문자열 보간으로, 5단원에서 자세히 배웁니다. 지금은 "변수 값을 문자열 안에 끼워 넣는 문법"으로만 이해하면 됩니다. 변수에 담긴 패턴으로 지우는 `rm`은 특히 위험하니, 의도치 않은 리터럴 매칭이나 과도한 매칭이 없는지 먼저 `ls`로 확인하세요.

### 5.3 glob 명령: 더 강력한 선택

`ls` 계열 명령이 쓰는 기본 문법에는 `{a,b}` 같은 중괄호 선택은 ls 쪽에서 보장된 문법이 아닙니다. 공식 문서에서 이 문법이 설명된 곳은 glob 명령입니다. 이런 고급 패턴이 필요할 때는 `glob` 명령으로 경로 리스트를 얻고, 그 결과를 `...`로 펼쳐 다른 명령에 넘깁니다. 공식 문서의 `ls` 예제도 이 방식을 씁니다.

```nu
glob **/*.{md,csv}                          # md와 csv를 모두 (경로 문자열 리스트)
ls ...(glob **/*.{md,csv})                  # 그 결과를 ls에 펼쳐 넣기
rm --trash ...(glob **/*.{tmp,bak})         # 여러 확장자 한 번에 정리
```

`glob`은 문자열 리스트를 돌려주므로 `ls`처럼 `size`나 `modified` 열이 없습니다. 열이 필요하면 `ls ...(glob ...)`로 감싸세요. `glob`의 결과 경로가 상대인지 절대인지는 직접 `glob *.md`를 실행해 확인해 두는 것이 좋습니다.

| 플래그                 | 효과                       | 예                                  |
| ------------------- | ------------------------ | ---------------------------------- |
| `--depth (-d)`      | 탐색할 디렉터리 깊이를 제한한다        | `glob **/*.md --depth 2`           |
| `--no-dir (-D)`     | 결과에서 디렉터리를 뺀다            | `glob **/* --no-dir`               |
| `--no-file (-F)`    | 결과에서 파일을 뺀다              | `glob **/* --no-file`              |
| `--no-symlink (-S)` | 결과에서 심볼릭 링크를 뺀다          | `glob **/* -S`                     |
| `--exclude (-e)`    | 패턴에 맞는 디렉터리 안으로 들어가지 않는다 | `glob **/* --exclude [**/logs/**]` |

`glob`은 `ls`보다 풍부한 패턴도 지원합니다. 공식 문서의 예를 연습 디렉터리에 맞게 바꾼 것입니다.

```nu
glob "[Cc]*"          # 대문자 C 또는 소문자 c로 시작하는 항목
glob "(?i)d*"         # 대소문자 구분 없이 d로 시작 (data, docs ...)
glob "{a?c,x?z}"      # 중괄호 안의 패턴 중 하나, ? 는 글자 한 개
glob "[!cCbMs]*"      # c C b M s 로 시작하지 않는 항목
```

**`ls` 계열과 `glob` 중 무엇을 쓸까.** 한 줄 기준으로 정리합니다. `*`, `**`, `?`, `[]`로 충분하면 `ls`에 직접 쓰는 것이 가장 간단합니다. 확장자 여러 개나 대소문자 무시, 특정 디렉터리 제외, 깊이 제한이 필요하면 `glob`을 쓰고 결과를 `...`로 펼칩니다. 결과에 크기나 날짜 열이 필요하지 않다면 `glob`의 문자열 리스트를 `each`나 `path` 명령에 바로 넘기면 됩니다.

### 5.4 흔한 실수

* `rm "*.tmp"`처럼 따옴표를 붙여 놓고 파일이 지워지지 않는다고 당황하는 경우가 많습니다. 따옴표 안의 `*`는 와일드카드가 아닙니다.
* `ls **/*.md`는 숨김 디렉터리 안의 파일을 찾지 못합니다. `.git` 같은 숨김 디렉터리 안을 찾으려면 `ls -a`를 씁니다.
* 변수에 담은 패턴이 "안 먹히는" 문제는 위 5.2의 세 방법으로 해결합니다.

## 6. 경로 처리: path 명령 모음

경로를 문자열 이어 붙이기(`"docs/" + "a.md"`)나 자르기로 다루면 운영체제마다 다른 구분자(`/`와 `\`), 중복 슬래시, 확장자 처리에서 실수가 납니다. `path` 하위 명령은 경로를 "부모, 이름, 확장자"로 이해하고 처리하므로, 경로를 만들고 분해할 때는 항상 이쪽을 씁니다.

이 명령들은 문자열 하나뿐 아니라 문자열 리스트도 받아 각 원소에 같은 동작을 적용합니다. 그래서 `ls`로 얻은 `name` 열과 곧바로 이어집니다. 대부분은 문자열만 가공하고 파일에는 접근하지 않지만, `exists`, `type`, `expand`는 실제 파일 시스템을 확인합니다.

| 명령                 | 하는 일                                     | 입력 → 출력                       |
| ------------------ | ---------------------------------------- | ----------------------------- |
| `path join`        | 경로 조각을 이어 하나의 경로로 만든다                    | string, list, record → string |
| `path parse`       | 경로를 `parent`, `stem`, `extension`으로 분해한다 | string → record, list → table |
| `path dirname`     | 부모 디렉터리 부분만 돌려준다                         | string → string               |
| `path basename`    | 마지막 이름(파일명)만 돌려준다                        | string → string               |
| `path relative-to` | 기준 경로에서 본 상대 경로를 구한다                     | string → string               |
| `path exists`      | 경로가 존재하는지 true/false로 돌려준다               | string → bool                 |
| `path type`        | `file`, `dir` 같은 종류를 돌려준다(없으면 빈 값)       | string → string               |
| `path expand`      | `..`, 심볼릭 링크 등을 풀어 절대 경로로 만든다            | string → string               |

### 6.1 path join: 경로 만들기

입력 경로에 뒤에 오는 조각들을 이어 붙입니다. 구분자는 운영체제에 맞게 알아서 처리됩니다.

```nu
'/home/viking' | path join spam.txt             # /home/viking/spam.txt
'/home/viking' | path join spams this_spam.txt  # /home/viking/spams/this_spam.txt
$env.PWD | path join docs intro.md              # 현재 위치/docs/intro.md
[ '/' 'home' 'viking' 'spam.txt' ] | path join  # 리스트의 조각들을 이어 붙임
```

레코드나 테이블도 받습니다. 키가 `parent`, `stem`, `extension`인 값이면 경로로 조립합니다. 이 점이 `path parse`와 짝을 이룹니다(아래 6.2).

```nu
{ parent: '/home/viking', stem: 'spam', extension: 'txt' } | path join
# /home/viking/spam.txt
```

**주의: 뒤에 절대 경로가 오면 앞이 버려집니다.** 공식 문서의 예에서 `'/home/viking' | path join / folder`의 결과는 `/folder`입니다. 사용자 입력 같은 값을 조각으로 넘길 때는 그 값이 `/`로 시작하지 않는지 확인하세요.

### 6.2 path parse: 경로 분해하기

경로를 세 부분으로 나눠 레코드로 돌려줍니다.

```nu
'/home/viking/spam.txt' | path parse
```

```text
╭───────────┬──────────────╮
│ parent    │ /home/viking │
│ stem      │ spam         │
│ extension │ txt          │
╰───────────┴──────────────╯
```

리스트를 넣으면 테이블이 됩니다. `ls`의 이름 열과 이으면 디렉터리 전체의 구성 요소를 얻습니다.

```nu
ls docs | get name | path parse
```

```text
╭───┬────────┬───────┬───────────╮
│ # │ parent │ stem  │ extension │
├───┼────────┼───────┼───────────┤
│ 0 │ docs   │ intro │ md        │
│ 1 │ docs   │ todo  │ md        │
╰───┴────────┴───────┴───────────╯
```

**분해한 값을 고쳐서 다시 조립하는 패턴**이 가장 쓸모가 큽니다. 확장자만 바꾸려면 다음처럼 합니다. `upsert`로 `extension`을 바꾸고 `path join`으로 합칩니다.

```nu
'docs/intro.md' | path parse | upsert extension 'txt' | path join
# docs/intro.txt

'docs/intro.md' | path parse | upsert stem 'overview' | path join
# docs/overview.md
```

확장자가 `tar.gz`처럼 점이 둘이라면 `--extension (-e)`로 확장자를 직접 알려 줍니다. 확장자를 무시하려면 빈 문자열을 줍니다.

```nu
'/home/viking/spam.tar.gz' | path parse --extension tar.gz   # stem: spam, extension: tar.gz
'/etc/conf.d' | path parse --extension ''                     # stem: conf.d, extension: 빈 값
```

### 6.3 dirname과 basename

`parse` 전체가 필요하지 않고 한 부분만 쓸 때 간편합니다. 둘 다 `--replace (-r)`로 해당 부분을 바꾼 경로를 돌려줍니다.

```nu
'/home/joe/code/test.txt' | path dirname                              # /home/joe/code
'/home/joe/code/test.txt' | path dirname --num-levels 2               # /home/joe
'/home/joe/test.txt'      | path basename                             # test.txt
'/home/joe/test.txt'      | path basename --replace 'spam.png'        # /home/joe/spam.png
```

`--num-levels (-n)`은 몇 단계 위까지 올라갈지 정하며, 프로젝트 루트를 구하는 데 자주 씁니다.

### 6.4 exists, type, expand, relative-to

```nu
'data/people.csv' | path exists          # true
'data/ghost.csv'  | path exists          # false
[ docs images nope ] | path exists       # [true true false]
'.' | path type                          # dir
'data/people.csv' | path type            # file
'docs/../images'  | path expand          # 현재위치/images (.. 해결)
$env.PWD | path join docs intro.md | path relative-to $env.PWD   # docs/intro.md
```

`path expand`는 `..`을 풀어 정규화된 경로를 만듭니다. 존재하지 않는 경로를 오류로 취급하려면 `--strict (-s)`를 붙이고, 심볼릭 링크를 풀지 않으려면 `--no-symlink (-n)`을 붙입니다. `path exists`에도 같은 의미의 `--no-symlink (-n)`이 있습니다.

`path relative-to`는 입력 경로에서 기준 경로를 뺀 나머지를 돌려줍니다. 공식 문서의 예로는 `'/home/viking' | path relative-to '/home'`이 `viking`입니다. 보고서에 절대 경로 대신 짧은 상대 경로를 출력할 때 유용합니다.

### 6.5 실전 패턴

**확장자별 파일 수 세기.** `parse`가 만든 `extension` 열을 `uniq --count`에 넘깁니다.

```nu
ls **/* | where type == file | get name | path parse | get extension | uniq --count
```

결과는 `value`(확장자)와 `count`(개수) 열을 가진 테이블입니다.

**여러 파일을 다른 확장자로 복사.** 이름 리스트를 `each`로 돌며 새 경로를 만들어 `cp`합니다. `each`와 `let`은 5, 6단원에서 자세히 배웁니다. 지금은 "파일마다 같은 작업을 반복한다"는 감각만 잡으면 됩니다.

```nu
ls docs/*.md | get name | each {|f|
    let dest = ($f | path parse | upsert extension 'txt' | path join)
    cp $f $dest
} | ignore
```

실행 후 `ls docs`에 `intro.txt`, `todo.txt`가 생깁니다. 원본을 보존하는 복사이므로 실수해도 되돌리기 쉽습니다.

### 6.6 판단 기준

경로를 만들 때는 `path join`, 쪼갤 때는 `path parse`, 일부만 필요할 때는 `dirname`과 `basename`, 존재 여부는 `exists`를 씁니다. 문자열 연결과 `split row "/"`로 직접 처리하고 있다면 대부분 `path` 명령으로 바꿀 수 있습니다.

## 7. 종합 예제: 명령을 파이프로 엮기

앞의 절에서 배운 도구는 각각 작지만, 조회(`ls`), 선별(`where`), 경로 가공(`path`), 조작(`mv`, `cp`, `rm`), 저장(`save`)을 파이프로 이으면 실무 작업이 됩니다. 아래 세 시나리오는 모두 같은 구조를 따릅니다. 먼저 대상을 조회하고, 결과를 눈으로 확인하고, 마지막에 파괴적인 명령을 붙입니다.

### 7.1 확장자별로 파일 분류하기

연습용 `inbox` 디렉터리에 어지러운 파일을 만들고, 확장자 이름의 하위 디렉터리로 나눕니다.

```nu
cd ~/nu-lab
mkdir inbox
touch inbox/report-10.csv inbox/report-11.csv inbox/photo1.png inbox/photo2.png inbox/memo.txt inbox/data.json inbox/README
```

먼저 분류 대상과 확장자만 뽑아서 확인합니다. 아직 아무것도 옮기지 않습니다.

```nu
ls inbox
| where type == file
| insert ext {|r| $r.name | path parse | get extension }
| where ext != ""
| select name ext
```

한 줄씩 읽어 보겠습니다.

| 줄                    | 의미                                                       |
| -------------------- | -------------------------------------------------------- |
| `ls inbox`           | `inbox` 안의 항목을 테이블로 얻는다                                  |
| `where type == file` | 디렉터리를 빼고 파일만 남긴다                                         |
| `insert ext {...}`   | 각 행의 `name`을 `path parse`로 분해해 확장자를 새 열 `ext`에 넣는다       |
| `where ext != ""`    | 확장자가 없는 `README`를 제외한다. 이를 빼먹으면 이동 목적지가 자기 자신이 되어 오류가 난다 |
| `select name ext`    | 확인용으로 두 열만 본다                                            |

결과가 의도와 같다면 같은 파이프 끝에 이동 명령을 붙입니다.

```nu
ls inbox
| where type == file
| insert ext {|r| $r.name | path parse | get extension }
| where ext != ""
| each {|r|
    let dest = ($r.name | path dirname | path join $r.ext)
    mkdir $dest
    mv $r.name $dest
}
| ignore

ls inbox/**/* | where type == file | get name
```

마지막 줄의 결과로 `inbox/csv/report-10.csv`처럼 분류된 경로와 그대로 남은 `inbox/README`가 보여야 합니다. `mkdir`는 이미 있는 디렉터리에도 오류를 내지 않으므로, 같은 확장자의 두 번째 파일에서도 안전합니다. `$r.name`이 `inbox/report-10.csv`이므로 `path dirname`은 `inbox`가 되고, 여기에 `csv`를 이어 붙여 `inbox/csv`를 만듭니다.

### 7.2 파일 목록을 CSV 보고서로 저장하기

3단원 실습 과제의 기본형입니다. 마크다운 파일을 크기순으로 정렬해 CSV로 저장합니다.

```nu
ls **/*.md | sort-by size | save --force files.csv
open files.csv
open files.csv | describe
```

`--force`를 붙인 이유는 `files.csv`가 이미 있어도 덮어써서 같은 명령을 여러 번 실행할 수 있게 하기 위해서입니다. 파일을 열어 보면 `name`, `type`, `size`, `modified` 열이 보입니다.

여기서 CSV의 한계를 함께 짚어 둡니다. CSV는 글자만 담는 형식이라 `size`가 filesize 타입이었다는 정보와 `modified`가 datetime이었다는 정보를 보존하지 않습니다. `open files.csv | describe`로 열의 타입을 확인해 보면, 저장 전과 같지 않을 수 있습니다. 타입을 그대로 보존해야 한다면 Nushell 고유의 `.nuon` 형식으로 저장하세요. 사람이 아닌 Nushell이 다시 읽을 파일이라면 이쪽이 정확합니다.

```nu
ls **/*.md | save --force files.nuon
open files.nuon | describe
```

필요한 열만 골라 저장하면 보고서가 깔끔해집니다.

```nu
ls **/*.md
| sort-by size --reverse
| select name size
| save --force md-report.csv
```

### 7.3 날짜가 붙은 백업 만들기

현재 시각으로 이름을 붙인 디렉터리를 만들어 중요한 디렉터리를 복사합니다. `path join`으로 경로를 만들고 `mkdir`와 `cp -r`로 마무리합니다.

```nu
let stamp = (date now | format date '%Y%m%d-%H%M')
let dest = ($env.PWD | path join backup $stamp)
mkdir $dest
cp -r docs data $dest
ls $dest
```

`let`은 변수를 만드는 명령이고 5단원에서 자세히 다룹니다. `format date '%Y%m%d-%H%M'`은 날짜를 `20261029-0140` 같은 문자열로 만들며, `cp -r docs data $dest`는 소스 두 개와 마지막 목적지 디렉터리를 받습니다.

### 7.4 오래된 로그 정리하기

조건에 맞는 파일만 골라 휴지통으로 보냅니다. 이전 절의 "먼저 보고, 나중에 지운다" 원칙을 그대로 따릅니다.

```nu
# 1단계: 대상을 본다
ls logs/*.log | where modified < ((date now) - 7day) | select name modified

# 2단계: 확인했으면 휴지통으로 보낸다
ls logs/*.log
| where modified < ((date now) - 7day)
| get name
| each {|f| rm --trash $f }
| ignore
```

연습 디렉터리의 `app.log`는 방금 만들었으므로 1단계 결과가 비어 있습니다. 파일 시각을 바꾸는 `touch -d "-10 days" logs/app.log`를 먼저 실행하면 대상에 걸립니다.

## 8. 흔한 오해와 문제 해결

막혔을 때 확인할 순서는 세 단계입니다. 먼저 `| describe`로 지금 다루는 값의 타입을 봅니다. 다음으로 `help <명령>`으로 사용 중인 버전의 플래그를 확인합니다. 마지막으로 긴 파이프라인을 한 단계씩 잘라 실행해 어디서 값이 달라지는지 찾습니다. 이 세 가지로 대부분의 문제가 풀립니다.

아래 표는 입문자가 가장 자주 만나는 증상을 정리한 것입니다. 표의 오류 문구는 버전에 따라 조금씩 다를 수 있으므로 증상의 성격을 기준으로 찾아보세요.

| 증상                                      | 원인                                                      | 해결                                                     |
| --------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| `ls -d`가 디렉터리 자체를 보여 주지 않는다             | `-d`는 디렉터리 크기를 내용물 합계로 계산하는 플래그다. 디렉터리 자체 조회는 대문자 `-D`다 | `ls -D docs`                                           |
| `mkdir -p`에서 알 수 없는 플래그 오류가 난다          | `mkdir`가 기본적으로 `-p`처럼 동작한다                              | `-p`를 빼고 `mkdir a/b/c`. 중복을 막으려면 `--fail-if-exists`    |
| `save`가 "이미 있다"는 취지의 오류를 낸다             | `save`는 기존 파일을 기본적으로 덮어쓰지 않는다                           | 덮어쓸 의도면 `--force`, 덧붙일 의도면 `--append`                  |
| `open notes.md`의 결과가 글자가 아니라 표 같은 구조다   | 마크다운도 구조화되어 열린다                                         | 글자 그대로는 `open --raw notes.md`                          |
| `rm "*.tmp"`가 아무것도 지우지 않는다              | 따옴표 안의 `*`는 와일드카드가 아니라 글자다                              | 따옴표를 빼거나 백틱을 쓴다: `rm *.tmp`                            |
| 변수에 담은 패턴으로 `ls $p`를 해도 안 먹힌다           | 변수의 문자열은 글롭이 아니라 리터럴이다                                  | `ls ($p \| into glob)` 또는 `ls ...(glob $p)`            |
| `ls **/*.md`가 숨김 디렉터리 안을 찾지 못한다         | 숨김 항목은 기본에서 제외된다                                        | `ls -a **/*.md`                                        |
| `cp docs backup`이 디렉터리라서 실패한다           | 디렉터리 복사는 재귀 플래그가 필요하다                                   | `cp -r docs backup`                                    |
| 함수 안의 `cd`가 호출한 뒤에는 효과가 없다              | `cd`의 효과는 scope 안에서만 유지된다                               | 8단원에서 배울 `def --env`                                   |
| 작은따옴표로 쓴 `'a\nb'`가 줄바꿈이 되지 않는다          | 작은따옴표 문자열은 이스케이프를 해석하지 않는다                              | 줄바꿈이 필요하면 큰따옴표 `"a\nb"`                                |
| 확장자가 `.txt`인 파일에 테이블을 저장하면 오류가 난다       | 해당 확장자에 맞는 변환 규칙이 없다                                    | `to json`처럼 먼저 문자열로 바꾸거나 `.json`, `.csv`, `.nuon`으로 저장 |
| `path join`의 결과가 예상과 다르게 `/folder`로 끝난다 | 뒤 조각이 절대 경로이면 앞부분이 버려진다                                 | 조각이 `/`로 시작하지 않는지 확인                                   |

### 8.1 명령을 스스로 찾는 습관

`path`처럼 하위 명령이 많은 계열은 이름을 외우는 것보다 찾는 법을 아는 편이 낫습니다.

```nu
help ls                                          # 한 명령의 설명과 플래그
help path                                        # path 계열 개요와 하위 명령 목록
help commands | where name =~ "^path"            # 이름으로 명령 검색
help commands | where category == "filesystem"   # 파일 시스템 범주 (열 구성은 버전에 따라 다를 수 있다)
```

플래그가 문서와 다르게 동작한다면 쓰는 버전이 다른 것입니다. `version`으로 버전을 확인하고, 인터넷의 오래된 글보다 설치된 `help`의 설명을 우선하세요. 특히 `ls`의 `-d`와 `-D`처럼 대소문자만 다른 플래그는 습관과 충돌하기 쉬우니 주의하세요.

### 8.2 안전하게 연습하는 요령

* 파괴적인 명령(`rm`, `mv`, `save --force`)은 대상을 먼저 `ls`나 `glob`으로 확인한 뒤 실행합니다.
* 처음 쓰는 글롭이나 반복문은 `cp`로 복사본을 만들어 놓고, 복사본에서 시험합니다.
* 삭제는 `--trash`를 기본으로 하고, 영구 삭제는 마지막에 의식적으로 `--permanent`를 선택합니다.
* 연습 디렉터리(`nu-lab`)는 언제든 지우고 다시 만들 수 있게 홈 아래에 둡니다.

## 9. 실습 과제와 풀이

과제는 풀이를 가리고 먼저 직접 시도한 뒤 비교하세요. 모든 과제는 `~/nu-lab`에서 진행하며, 중간에 꼬이면 디렉터리를 지우고 처음의 실습 준비 명령으로 되돌아가면 됩니다. 풀이는 정답이 하나가 아니므로 결과가 같다면 다른 방식이어도 괜찮습니다.

### 과제 1. 크기순 CSV 보고서 (목차의 필수 과제)

**목표.** 특정 확장자의 파일을 크기순으로 정렬해 CSV로 저장합니다.

**풀이.**

```nu
ls **/*.md | sort-by size | save --force files.csv
open files.csv | first 3
```

**설명.** `**/*.md`는 하위 디렉터리를 모두 뒤져 마크다운 파일을 고르고, `sort-by size`는 `size` 열을 기준으로 정렬합니다. `save`는 확장자 `.csv`를 보고 테이블을 CSV로 바꿔 씁니다. `--force`는 다시 실행해도 오류가 나지 않게 하려는 것입니다.

**변형.** 이름과 크기만 남기고 큰 파일이 위에 오게 하려면 `ls **/*.md | sort-by size --reverse | select name size | save --force md-report.csv`로 바꿉니다.

### 과제 2. 이동과 위치 확인

**목표.** `work/2026/q4`를 한 번에 만들고 들어갔다 나오세요. 그리고 지금 위치가 어디인지 값으로 확인하세요.

**풀이.**

```nu
mkdir work/2026/q4
cd work/2026/q4
$env.PWD | path relative-to ($env.OLDPWD)
cd -
$env.PWD
'work/2026/q4' | path exists
```

**설명.** `mkdir`가 중간 단계까지 만들고, `cd -`가 직전 위치(`OLDPWD`)로 돌아옵니다. 세 번째 줄은 현재 위치를 직전 위치에서 본 상대 경로로 보여 주며 `work/2026/q4`가 나와야 합니다. 마지막 줄은 `true`입니다.

### 과제 3. 형식 변환과 수정 저장

**목표.** `data/people.csv`에서 30살 이상만 골라 `data/people-30.json`으로 저장하고, 이름 목록을 확인하세요. 그리고 `data/config.json`의 `version`을 `0.2.0`으로 바꿔 같은 파일에 저장하세요.

**풀이.**

```nu
open data/people.csv | where age >= 30 | save --force data/people-30.json
open data/people-30.json | get name            # [kim park]

open data/config.json | upsert version "0.2.0" | save --force data/config.json
open data/config.json | get version            # 0.2.0
```

**설명.** 첫 줄은 "읽기, 필터, 확장자에 따른 변환 저장"의 전형입니다. 둘째 파이프는 읽은 값을 `upsert`로 고쳐 같은 파일에 되돌려 쓰는데, `open`이 파일 전체를 값으로 읽은 뒤이므로 안전합니다. 기존 파일을 덮어쓰므로 `--force`가 필요합니다.

### 과제 4. 글롭과 따옴표

**목표.** `images`에서 `a.png`와 `b.png`만 `images/selected`로 복사하고 개수를 확인한 뒤 지우세요. 그리고 아래 두 줄이 각각 무엇을 지울지 실행 전에 예상하세요.

```nu
rm *.tmp
rm "*.tmp"
```

**풀이.**

```nu
mkdir images/selected
cp images/[ab].png images/selected/
ls images/selected | length            # 2
rm -r images/selected
```

**설명.** `[ab]`는 `a` 또는 `b` 한 글자를 뜻하는 글롭입니다. 예상 문제의 답은 이렇습니다. 첫 줄은 글롭이므로 `.tmp`로 끝나는 모든 파일을 지우고, 둘째 줄은 따옴표 때문에 이름이 정확히 `*.tmp`인 파일만 지웁니다. 실제로 확인해 보려면 `touch a.tmp b.tmp '*.tmp'`로 세 파일을 만든 뒤 `ls *.tmp`로 보고 각각 시험해 보세요. 이때 `touch '*.tmp'`의 따옴표가 반대로 글자 그대로 파일을 만든다는 점도 함께 관찰할 수 있습니다.

### 과제 5. 확장자를 바꿔 복사

**목표.** `docs` 안의 모든 `.md` 파일을 확장자만 `.txt`로 바꿔 `docs-txt` 디렉터리에 복사하세요.

**풀이.**

```nu
mkdir docs-txt
ls docs/*.md | get name | each {|f|
    let dest = ($f | path parse | upsert parent 'docs-txt' | upsert extension 'txt' | path join)
    cp $f $dest
} | ignore
ls docs-txt | get name
```

**설명.** `path parse`로 경로를 `parent`, `stem`, `extension`으로 나눈 뒤 두 필드를 바꾸고 `path join`으로 다시 조립합니다. 결과로 `docs-txt/intro.txt`, `docs-txt/todo.txt`가 나옵니다. 문자열을 잘라 붙이는 방식보다 훨씬 짧고 안전합니다.

### 확인 질문

답은 가린 채로 풀어 보고, 막히면 해당 절로 돌아가세요.

| 질문                                   | 답                                                   |
| ------------------------------------ | --------------------------------------------------- |
| `ls`가 돌려주는 값의 타입과 열은?                | table. `name`, `type`, `size`, `modified` 열(2절)     |
| 디렉터리 안이 아니라 디렉터리 자체를 보려면?            | `ls -D 경로` (2절)                                     |
| `mkdir`로 이미 있는 디렉터리를 또 만들면?          | 오류가 나지 않는다. 막으려면 `--fail-if-exists` (2절)            |
| `open`한 마크다운을 글자 그대로 읽으려면?           | `open --raw` (3절)                                   |
| `save`가 기존 파일을 덮어쓰게 하려면?             | `--force`. 덧붙이려면 `--append` (3절)                    |
| 파일 여러 개를 다른 디렉터리로 옮기는 `mv`의 마지막 인수는? | 반드시 디렉터리(목적지) (4절)                                  |
| `rm *.log`와 `rm "*.log"`의 차이는?       | 앞은 글롭이라 여러 파일, 뒤는 이름이 `*.log`인 파일 하나 (5절)           |
| 변수에 담은 패턴을 글롭으로 쓰려면?                 | `into glob`, `...(glob $p)`, `glob` 타입 지정 중 하나 (5절) |
| 경로의 확장자만 바꾸려면?                       | `path parse`, `upsert extension`, `path join` (6절)  |
| `{md,csv}` 같은 중괄호 패턴이 필요하면?          | `glob` 명령을 쓰고 `...`로 펼친다 (5절)                       |

## 10. 정리와 다음 단원

3단원의 결론은 한 문장입니다. 파일 시스템 명령은 값을 돌려주므로, 조회한 결과를 그대로 필터링하고 가공해 다시 다른 명령에 넘길 수 있습니다. 아래 표는 이 단원의 명령을 용도별로 묶은 것으로, 복습용 치트시트로 쓰면 됩니다.

| 하려는 일       | 명령                                                    | 기억할 점                              |
| ----------- | ----------------------------------------------------- | ---------------------------------- |
| 목록 보기       | `ls`, `ls -a`, `ls -D 경로`                             | 결과는 table. 숨김은 `-a`, 디렉터리 자체는 `-D` |
| 이동          | `cd 경로`, `cd -`, `cd ~`, `cd ..`                      | 위치는 scope 안에서만 유지된다                |
| 디렉터리 만들기    | `mkdir a/b/c`                                         | 중간 단계 자동 생성, 중복 오류 없음              |
| 읽기          | `open`, `open --raw`                                  | 확장자로 해석한다. 마크다운도 구조화된다             |
| 저장          | `save`, `save --force`, `save --append`               | 기본은 덮어쓰기 금지. 확장자로 변환한다             |
| 빈 파일, 시각 변경 | `touch`                                               | 있으면 시각만 갱신한다                       |
| 이동, 이름 바꾸기  | `mv 원본... 목적지`                                        | 마지막 인수가 목적지                        |
| 복사          | `cp 원본... 목적지`, `cp -r`                               | 디렉터리는 `-r` 필요                      |
| 삭제          | `rm`, `rm --trash`, `rm -r`                           | 먼저 `ls`로 대상 확인                     |
| 여러 파일 선택    | `*`, `**`, `?`, `[]`, `glob`                          | 따옴표는 글롭을 끈다. 중괄호는 `glob`           |
| 경로 가공       | `path join`, `parse`, `dirname`, `basename`, `exists` | 문자열 연결 대신 사용                       |

새로운 상황에서 판단하는 기준은 세 가지입니다. 파일 내용을 데이터로 다루려면 `open`, 글자로 다루려면 `open --raw`를 씁니다. 여러 파일에 같은 작업을 하려면 글롭이나 `glob`으로 대상을 먼저 확인합니다. 경로를 조립하거나 분해할 때는 항상 `path` 명령을 씁니다.

### 다음 단원과의 연결

이 단원에서 이미 `where`, `sort-by`, `select`, `get`, `length`, `uniq --count`를 맛보기로 썼습니다. 4단원은 이 도구들을 정식으로 배웁니다. 행을 거르는 `where`, 상위·하위를 뽑는 `first`와 `last`, 열을 고르는 `select`와 `reject`, 값을 꺼내는 `get`, 정렬과 개수 `sort-by`, `length`, `uniq`입니다. 3단원에서 `ls`와 `open`으로 테이블을 얻는 방법을 익혔으니, 4단원에서는 그 테이블을 자유자재로 다듬을 수 있습니다.

### 확인한 범위와 한계

이 가이드를 쓴 환경에는 Nushell이 설치되어 있지 않아 예제를 실제로 실행하지 못했습니다. 명령의 시그니처, 플래그, 문서 예제는 아래 공식 페이지를 직접 열어 대조했고, 연습 파일의 크기는 내용을 바이트로 계산해 맞췄습니다. 출력 표는 공식 문서의 예와 이 연습 파일 기준의 예시이며, 시각과 디렉터리 크기는 환경마다 다릅니다. 다음 항목은 공식 문서에 직접 적혀 있지 않아 일반적인 동작에 기대어 설명했으므로, 실제로 실행해 확인해 보시기를 권합니다.

* `save`가 기존 파일을 덮어쓰지 않고 오류를 낸다는 동작(문서에는 `--force`가 덮어쓰기를 허용한다고만 적혀 있습니다)
* `open`한 마크다운 파일의 구체적인 열 구성(공식 책은 구조화된다는 사실만 설명합니다)
* `glob`이 돌려주는 경로가 상대 경로인지 절대 경로인지
* `ls` 계열의 인수에서 중괄호 `{a,b}`를 쓸 수 있는지 여부(문서의 `ls` 예제는 `glob`을 펼쳐 쓰는 방식을 보여 줍니다)
* `touch '*.tmp'`가 글자 그대로의 이름으로 파일을 만든다는 점(따옴표 규칙에서 추론)
* `rm`의 기본 동작이 휴지통인지 영구 삭제인지(설정 `always_trash`에 따라 다르며 기본값은 설치 환경에서 확인)

기준 버전은 목차의 Nushell 0.116.x입니다. 아래 문서는 2026-10-29에 열어 본 공식 페이지이며, 설치한 버전과 다르면 `help <명령>`의 설명을 우선하세요.

### 출처

공식 명령 문서입니다.

* [ls](https://www.nushell.sh/commands/docs/ls.html), [cd](https://www.nushell.sh/commands/docs/cd.html), [mkdir](https://www.nushell.sh/commands/docs/mkdir.html), [touch](https://www.nushell.sh/commands/docs/touch.html)
* [open](https://www.nushell.sh/commands/docs/open.html), [save](https://www.nushell.sh/commands/docs/save.html)
* [mv](https://www.nushell.sh/commands/docs/mv.html), [cp](https://www.nushell.sh/commands/docs/cp.html), [rm](https://www.nushell.sh/commands/docs/rm.html)
* [glob](https://www.nushell.sh/commands/docs/glob.html)
* [path parse](https://www.nushell.sh/commands/docs/path_parse.html), [path join](https://www.nushell.sh/commands/docs/path_join.html), [path dirname](https://www.nushell.sh/commands/docs/path_dirname.html), [path basename](https://www.nushell.sh/commands/docs/path_basename.html), [path relative-to](https://www.nushell.sh/commands/docs/path_relative-to.html), [path exists](https://www.nushell.sh/commands/docs/path_exists.html), [path expand](https://www.nushell.sh/commands/docs/path_expand.html), [path type](https://www.nushell.sh/commands/docs/path_type.html)

공식 책입니다.

* [Moving around the system](https://www.nushell.sh/book/moving_around.html): `ls`, 글롭, 따옴표 규칙, `cd`, `mkdir`
* [Loading data](https://www.nushell.sh/book/loading_data.html): `open`의 형식 판별과 `--raw`
