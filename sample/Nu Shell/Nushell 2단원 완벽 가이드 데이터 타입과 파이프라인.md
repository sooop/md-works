# Nushell 2단원 완벽 가이드: 데이터 타입과 파이프라인

Oct 29, 2026

## 이 단원의 목표와 읽는 법

이 단원을 마치면 Nushell의 모든 값이 타입을 가진다는 사실을 설명하고, 파이프(`|`)가 그 값을 다음 명령에 넘기는 과정을 `describe`로 직접 확인할 수 있습니다. 1단원에서 `nu`를 실행하고 `help`를 써 본 독자를 가정하며, 프로그래밍 경험은 필요하지 않습니다. 기준 버전은 Nushell 0.116.x 계열입니다.

이 단원이 이후 모든 단원의 토대인 이유는 간단합니다. Nushell의 명령은 거의 전부 "어떤 타입을 받아 어떤 타입을 돌려주는 함수"이고, 오류의 대부분은 타입이 맞지 않아서 생깁니다. 타입을 읽을 줄 알면 오류 메시지와 `help` 문서가 갑자기 읽히기 시작합니다.

**예제를 읽는 방법.** 각 예제는 `명령` 다음에 `# 결과` 형태의 설명 또는 예시 출력으로 구성됩니다. 입력 프롬프트 기호는 생략했습니다. 모든 예제는 직접 입력해 보면서 읽으세요. 눈으로 읽는 것과 `describe` 결과를 직접 보는 것은 학습 효과가 크게 다릅니다.

**검증 상태에 대한 안내.** 예제의 문법과 동작 규칙은 공식 문서와 Nushell의 타입 규칙에 근거해 작성했지만, 이 가이드를 작성한 환경에서는 Nushell 바이너리를 실행하지 못해 예제 출력을 직접 대조하지 못했습니다. 따라서 표의 열 폭, 단위 표기(`kB`, `MB` 등), 플랫폼별로 다른 열(예: `ps`)은 독자의 환경과 다를 수 있습니다. 설명과 결과가 어긋나면 본인 환경의 결과를 기준으로 삼고, 한 번씩 실행해 대조하길 권합니다.

### 이 가이드의 구성

| 절 | 답하는 질문 |
| --- | --- |
| 왜 타입이 있는 셸인가 | bash와 무엇이 근본적으로 다른가 |
| 기본 스칼라 타입 | 숫자, 문자열, 참거짓, 단위가 붙은 값은 어떻게 쓰는가 |
| 컬렉션 타입 | list, record, table은 어떻게 만들고 꺼내는가 |
| table은 record의 list | `ls` 결과의 정체는 무엇인가 |
| 파이프라인 | 값은 어떻게 흘러가고 무엇이 출력되는가 |
| describe | 중간 단계의 타입을 어떻게 확인하는가 |
| 흔한 오해와 오류 읽기 | 타입 오류는 어떻게 읽고 고치는가 |
| 실습 과제 풀이 | 단원 과제를 단계별로 풀면 어떻게 되는가 |

## 왜 타입이 있는 셸인가

Nushell의 파이프에는 글자가 아니라 값이 흐르기 때문에, 열 위치를 세거나 문자열을 잘라 내는 작업이 필요 없습니다. 이것이 bash, zsh와 Nushell의 가장 근본적인 차이이고, 이 단원 전체가 이 한 문장의 풀이입니다.

### 텍스트 스트림의 문제

bash에서 파일 크기가 가장 큰 항목을 찾으려면 `ls -l`이 찍어 주는 글자를 `awk`나 `sort`가 해석해야 합니다.

```bash
ls -l | sort -k5 -n -r | head -3
```

여기서 `-k5`는 "공백으로 나눈 다섯 번째 칸"이라는 뜻입니다. 명령은 글자 사이의 약속(공백 구분, 칸 순서)에 기대고 있어서, 파일 이름에 공백이 있거나 `ls`의 출력 형식이 바뀌면 조용히 틀린 결과를 냅니다. 숫자도 사실은 글자이므로 정렬 때 숫자로 읽으라고(`-n`) 매번 알려 줘야 합니다.

### 구조화된 값의 해법

같은 일을 Nushell에서는 이렇게 합니다.

```nu
ls | sort-by size --reverse | first 3
```

`ls`는 글자를 찍는 대신 \*\*파일 하나하나가 이름, 종류, 크기, 수정 시각을 가진 표(table)\*\*를 돌려줍니다. `sort-by size`는 "size라는 열"을 이름으로 찾고, 그 열의 값이 파일 크기(filesize) 타입이므로 숫자 크기 순으로 정렬합니다. 칸 번호도, 구분자도, `-n` 옵션도 필요 없습니다. 열의 이름과 값의 타입이 약속을 대신하기 때문입니다.

| 구분 | bash, zsh | Nushell |
| --- | --- | --- |
| 파이프에 흐르는 것 | 바이트와 텍스트 | 타입이 있는 값(표, 목록, 숫자 등) |
| 열을 고르는 방법 | 위치(`$5`, `-k5`) | 이름(`get size`, `select name`) |
| 숫자 비교 | 글자를 숫자로 해석하라고 지시 | 값 자체가 숫자, 크기, 시간 타입 |
| 형식이 바뀌면 | 조용히 틀린 결과 | 열이 없다는 오류로 즉시 드러남 |

### 표는 보여 주는 방식일 뿐이다

흔한 오해가 하나 있습니다. "Nushell은 출력을 예쁜 표로 꾸며 주는 셸"이라는 생각입니다. 실제로는 반대입니다. 데이터가 먼저 표 구조로 존재하고, 터미널에 마지막으로 나갈 때만 사람이 읽기 좋은 모양으로 그려집니다. 이 차이는 다음 한 줄로 확인할 수 있습니다.

```nu
ls | get name
```

`get name`은 표에서 `name` 열만 꺼내 **문자열의 목록**을 돌려주고, 그 결과는 다시 다음 명령의 입력이 됩니다. 글자를 자르지 않았는데도 정확히 이름만 나오는 것은 `name`이 실제로 존재하는 열이기 때문입니다.

### 외부 명령은 여전히 텍스트다

Nushell 안에서도 외부 프로그램은 글자를 내놓습니다. 명령 앞에 `^`를 붙이면 Nushell 내장 `ls` 대신 시스템의 `ls` 프로그램이 실행됩니다.

```nu
^ls | describe
```

결과는 표가 아니라 문자열 계열의 타입(환경에 따라 `string` 또는 `byte stream` 같은 형태로 표시)입니다. 내장 `ls`와 외부 `ls`가 같은 이름이어도 돌려주는 타입이 다르다는 점이 이 단원의 핵심 직관입니다. 외부 명령의 글자를 Nushell 값으로 바꾸는 방법은 9단원에서 다룹니다.

**판단 기준.** 명령을 쓰기 전에 "지금 파이프에 흐르는 것이 표인가, 목록인가, 글자인가"를 먼저 묻습니다. 그 답이 어떤 명령을 쓸 수 있는지를 거의 결정합니다.

## 기본 스칼라 타입

스칼라는 "값 하나"를 뜻하며, Nushell은 숫자와 글자뿐 아니라 파일 크기, 시간 길이, 날짜까지 스칼라 타입으로 직접 지원합니다. 이 점이 `5mb`나 `2hr` 같은 값을 문자열 처리 없이 곧바로 비교하고 계산할 수 있게 해 줍니다.

| 타입 | 리터럴 예 | `describe` 결과 | 한 줄 설명 |
| --- | --- | --- | --- |
| int | `42`, `-7`, `0xff` | `int` | 정수 |
| float | `3.14`, `1e3` | `float` | 소수 |
| string | `"hello"`, `'hi'` | `string` | 글자 |
| bool | `true`, `false` | `bool` | 참과 거짓 |
| nothing | `null` | `nothing` | 값이 없음 |
| filesize | `10kb`, `1.5gb` | `filesize` | 파일 크기 |
| duration | `30min`, `2hr` | `duration` | 시간의 길이 |
| datetime | `2026-10-29` | `datetime` | 날짜와 시각 |
| range | `1..5` | `range` | 연속하는 값의 구간 |

### 타입을 확인하는 가장 빠른 방법

값 뒤에 `| describe`를 붙이면 그 값의 타입 이름이 문자열로 나옵니다. 아래 예제를 하나씩 입력해 보세요.

```nu
42 | describe        # int
3.14 | describe      # float
"hi" | describe      # string
true | describe      # bool
null | describe      # nothing
5mb | describe       # filesize
2hr | describe       # duration
2026-10-29 | describe  # datetime
1..5 | describe      # range
```

`값 | describe` 형태가 곧 파이프라인의 첫 사용입니다. 왼쪽의 값이 파이프를 지나 오른쪽 명령 `describe`의 입력이 됩니다.

### 정수와 소수 (int, float)

소수점이 없으면 int, 있으면 float입니다. 16진수(`0xff`), 2진수(`0b1010`), 8진수(`0o17`) 표기도 모두 int이며, `1e3`처럼 지수로 쓰면 float(`1000.0`)입니다.

```nu
0xff            # 255
0b1010          # 10
7 + 2           # 9
7 / 2           # 3.5   (나눗셈은 항상 float: 10 / 2도 5.0)
7 // 2          # 3     (몫만 구하는 정수 나눗셈)
7 mod 2         # 1     (나머지)
2 ** 10         # 1024  (거듭제곱)
2 + 3 * 4       # 14    (곱셈이 먼저)
1 + 2.5         # 3.5   (int와 float을 섞으면 float)
7 / 2 | describe  # float
```

- `/`는 나누고, `//`는 몫, `mod`는 나머지입니다. 나머지 연산자 기호가 `%`가 아니라 `mod`라는 점이 bash에서 온 독자가 자주 틀리는 부분입니다.
- 연산자의 우선순위는 수학과 같고, 묶고 싶으면 괄호를 씁니다: `(2 + 3) * 4`는 20.
- int와 float을 섞으면 결과는 float이 됩니다. 정밀도를 잃지 않는 쪽으로 타입이 올라가는 규칙입니다.

### 문자열 (string)

문자열은 따옴표 종류에 따라 해석이 달라집니다. 이 차이를 알아야 경로와 정규식에서 막히지 않습니다.

| 표기 | 이스케이프(`\n` 등) | 용도 |
| --- | --- | --- |
| `"큰따옴표"` | 해석함 | 일반 문자열, 줄바꿈이나 탭이 필요할 때 |
| `'작은따옴표'` | 해석하지 않음 | 윈도 경로, 정규식처럼 역슬래시가 많을 때 |
| 백틱 `` `경로` `` | 해석하지 않음 | 공백이 든 경로를 명령 인자로 줄 때 |
| 따옴표 없는 단어 | 해당 없음 | 명령 인자나 목록 안의 간단한 단어(`[a b c]`) |

```nu
"line1\nline2"       # 두 줄로 출력됨 (\n이 줄바꿈으로 해석)
'line1\nline2'       # 글자 그대로 line1\nline2
"hello" | str length    # 5
"hello" | str upcase    # HELLO
"hello world" | str contains "wor"   # true
```

`str`로 시작하는 명령 묶음(`str length`, `str upcase`, `str replace` 등)이 문자열 도구 상자입니다. `help str`로 전체 목록을 볼 수 있습니다. 변수를 문자열 안에 끼워 넣는 `$"hello ($name)"` 형태는 5단원에서 배웁니다.

**오해 교정.** `"42"`와 `42`는 전혀 다른 값입니다. 앞은 글자 두 개이고 뒤는 정수입니다. `"42" | describe`는 `string`, `42 | describe`는 `int`입니다. 글자를 수로 바꾸려면 아래 `into`를 씁니다.

### 불리언과 비교 (bool)

비교 연산의 결과는 항상 bool이고, bool끼리는 `and`, `or`로 조합하며 부정은 `not`을 앞에 붙입니다. 기호 `&&`나 `||`가 아니라 단어를 쓴다는 점에 주의하세요.

```nu
3 > 2                    # true
3 == 4                   # false
3 != 4                   # true
(3 > 2) and (5 < 4)      # false
(3 > 2) or (5 < 4)       # true
not (3 > 2)              # false
"abc" == "abc"           # true
```

`where` 같은 필터 명령은 각 행에 대해 이 bool 값을 계산하고, `true`인 행만 남깁니다. 4단원에서 본격적으로 쓰게 됩니다.

### 값 없음 (nothing)

`null`은 "값이 없다"는 사실 자체를 나타내는 값입니다. 숫자 0, 빈 문자열 `""`, 빈 목록 `[]`과는 모두 다릅니다. 파일 정보에서 찾는 열이 비어 있거나, 명령이 아무것도 돌려주지 않을 때 `nothing` 타입이 등장합니다.

```nu
null | describe          # nothing
null | is-empty          # true
"" | is-empty            # true
[] | is-empty            # true
```

`is-empty`는 null, 빈 문자열, 빈 목록을 모두 "비었다"로 판정하는 편의 명령입니다. 세 값이 같다는 뜻은 아니며, 타입은 각각 `nothing`, `string`, `list`입니다.

### 단위가 붙은 값 (filesize, duration, datetime)

숫자 바로 뒤에 단위를 붙이면 그 값은 곧바로 전용 타입이 됩니다. 문자열로 "5MB"를 다루다가 매번 숫자로 파싱하던 수고가 사라집니다.

```nu
1kb                       # 1.0 kB   (1000바이트)
1kib                      # 1.0 KiB  (1024바이트)
1gb + 500mb               # 1.5 GB
500b                      # 500 B

30min                     # 30min
1hr + 30min               # 1hr 30min
1day * 3                  # 3day
2hr > 90min               # true

2026-10-29                # 2026-10-29 00:00:00 (날짜 리터럴)
date now                  # 지금 시각 (datetime)
(date now) - 2026-01-01   # 올해 1월 1일부터 지금까지의 duration
(date now) - 2026-01-01 | describe   # duration
```

- filesize 단위는 `b`, `kb`, `mb`, `gb`, `tb`(10의 거듭제곱)와 `kib`, `mib`, `gib`(2의 거듭제곱)가 있고, 출력 표기는 환경 설정에 따라 `kB`, `KiB` 등으로 달라질 수 있습니다.
- duration 단위는 `ns`, `us`, `ms`, `sec`, `min`, `hr`, `day`, `wk` 등입니다.
- 같은 종류끼리는 더하고 비교할 수 있습니다. `2hr > 90min`처럼 단위가 달라도 같은 duration이면 계산됩니다.
- datetime에서 datetime을 빼면 duration이 됩니다. 이 규칙 덕분에 "파일이 일주일 넘게 안 바뀌었나"를 `(date now) - $수정시각 > 1wk` 같은 식으로 적을 수 있습니다.

이 세 타입은 7단원에서 더 깊이 다룹니다. 지금은 "단위를 붙이면 타입이 생기고, 그 타입끼리 직접 비교된다"만 기억하세요.

### 범위 (range)

`시작..끝`은 연속한 정수 구간을 만드는 리터럴입니다. 끝 값이 포함된다는 점이 많은 언어와 다릅니다.

```nu
1..5                          # 1, 2, 3, 4, 5 (끝 포함)
1..<5                         # 1, 2, 3, 4    (끝 제외)
5..1                          # 5, 4, 3, 2, 1 (내림차순)
1..3..10                      # 1, 3, 5, 7, 9 (처음 두 수의 차이가 간격)
1..5 | each {|n| $n * $n }    # [1, 4, 9, 16, 25]
```

마지막 줄의 `each {|n| ... }`는 "구간의 각 값에 코드 블록을 적용한다"는 뜻입니다. `{|n| ... }`를 클로저라고 부르며 6단원에서 자세히 배웁니다. 여기서는 range가 파이프를 통해 값을 하나씩 흘려보내는 재료가 된다는 점만 보면 됩니다.

### 타입을 바꾸는 into 명령

타입이 서로 다른 값은 그대로 섞이지 않으므로, 필요할 때 `into 타입`으로 명시적으로 바꿉니다.

```nu
"42" | into int          # 42
42 | into string         # "42"
"3.14" | into float      # 3.14
"42" | into int | describe   # int
```

`into`는 7단원에서 `into datetime`, `into filesize`, `into duration`까지 확장해서 다룹니다. 지금은 "문자열을 숫자로 바꾸고 싶으면 `into int`"를 기억하면 충분합니다.

## 컬렉션 타입: list, record, table

컬렉션은 값을 여럿 묶어 담는 타입이며, 위치로 꺼내면 list, 이름으로 꺼내면 record, 둘을 겹치면 table입니다. 실제 셸 작업에서 만나는 데이터(파일 목록, 프로세스 목록, JSON 응답)는 거의 전부 이 세 가지의 조합입니다.

이 절의 예제는 값을 이름에 담아 재사용합니다. `let 이름 = 값`으로 변수를 만들고 `$이름`으로 꺼내 쓰며, 자세한 규칙은 5단원에서 다룹니다. 대화형 셸에서는 한 줄에 하나씩 입력하면 이후 줄에서 변수가 유지됩니다.

### list: 순서가 있는 값의 나열

```nu
[1 2 3]                    # 공백으로 구분
[1, 2, 3]                  # 쉼표를 써도 같은 값
[a b c]                    # 따옴표 없는 단어도 문자열
["a" "b" "c"]              # 위와 같은 값
[]                         # 빈 목록
[1 2 3] | describe         # list<int>
[a b c] | describe         # list<string>
[1 "two" 3.0] | describe   # list<any> (섞이면 any 계열로 표시)
[[1 2] [3 4]] | describe   # list<list<int>> (목록의 목록)
```

`describe`가 `list<int>`처럼 꺾쇠 안에 원소 타입을 함께 보여 주는 점을 눈여겨보세요. 이 표기는 11단원에서 직접 쓰게 될 타입 시그니처와 같은 문법입니다. 서로 다른 타입이 섞인 목록은 하나의 원소 타입으로 요약할 수 없어 `any` 계열로 보이며, 정확한 표기는 버전에 따라 다를 수 있습니다.

목록에서 값을 꺼내고 다루는 대표 명령입니다. 모두 **원본을 바꾸지 않고 새 목록을 돌려줍니다.**

```nu
let nums = [10 20 30 40]

$nums.0                      # 10   (0부터 시작하는 위치)
$nums | get 2                # 30   (위와 같은 방식의 명령 형태)
$nums | first                # 10
$nums | last                 # 40
$nums | first 2              # [10, 20]
$nums | skip 1               # [20, 30, 40]
$nums | length               # 4
$nums | append 50            # [10, 20, 30, 40, 50]
$nums | prepend 0            # [0, 10, 20, 30, 40]
$nums | reverse              # [40, 30, 20, 10]
$nums | math sum             # 100
$nums | math avg             # 25
20 in $nums                  # true (포함 여부)
$nums | where {|n| $n > 15}  # [20, 30, 40]
$nums | each {|n| $n + 1}    # [11, 21, 31, 41]
$nums                        # [10, 20, 30, 40] (그대로)
```

- 위치는 0부터 셉니다. 첫 번째 값이 `.0`입니다.
- `append`, `prepend`, `reverse`는 목록을 고치는 것이 아니라 새 목록을 만듭니다. 마지막 줄에서 `$nums`가 그대로인 이유입니다. 이 성질이 Nushell 전체의 기본 설계이고, 값을 실제로 바꾸고 싶으면 5단원의 `mut`를 씁니다.
- `where {|n| ...}`는 조건이 참인 원소만 남기고, `each {|n| ...}`는 모든 원소를 변환합니다. 둘 다 6단원의 클로저를 쓰며, 여기서는 "원소 하나를 `n`이라 부르고 그 값으로 식을 계산한다"로 읽으면 됩니다.

### record: 이름이 붙은 값의 묶음

```nu
{name: "kim", age: 30}          # 쉼표로 구분
{name: kim age: 30}             # 쉼표 없이도 가능
{}                              # 빈 record
{name: "kim", age: 30} | describe   # record<name: string, age: int>
{"first name": "kim"}           # 공백이 있는 이름은 따옴표로 감싼다
```

목록이 "몇 번째"로 값을 찾는다면 record는 "무슨 이름"으로 찾습니다. 이름(필드명)은 중복될 수 없고, 값의 타입은 필드마다 달라도 됩니다. `describe`는 필드마다 타입을 따로 보여 줍니다.

```nu
let p = {name: "kim", age: 30, tags: [dev ops]}

$p.name                      # kim
$p | get age                 # 30
$p.tags.1                    # ops   (record 안의 list에서 두 번째)
$p | columns                 # [name, age, tags]  (필드 이름들)
$p | values                  # [kim, 30, [dev, ops]]
$p | select name age         # {name: kim, age: 30}   (record 유지)
$p | reject tags             # {name: kim, age: 30}   (tags 제외)
$p | upsert age 31           # age를 31로 바꾼 새 record (없으면 추가)
$p | insert city "seoul"     # 새 필드를 추가한 새 record
$p | merge {city: "seoul"}  # 다른 record를 합친 새 record
$p | transpose key value     # 필드를 행으로 세운 table
```

- `$p.name`처럼 점(`.`) 뒤에 필드명을 쓰는 표기, `$p.tags.1`처럼 점을 이어 쓰는 표기를 \*\*셀 경로(cell path)\*\*라고 부릅니다. 경로의 조각이 이름이면 record의 필드, 숫자이면 list의 위치를 뜻하고, 둘을 섞어 깊이 들어갈 수 있습니다.
- `select`는 record를 record로 돌려주고, `get`은 값 자체를 꺼냅니다. `$p | select name`은 `{name: kim}`이고 `$p | get name`은 `kim`입니다. 이 차이는 table에서 더 중요해지므로 아래에서 다시 다룹니다.
- 공백이 든 필드명은 `$p."first name"`처럼 따옴표로 접근합니다.
- `columns`와 `values`는 record를 이름의 목록과 값의 목록으로 갈라 줍니다.

### 중첩: JSON을 닮은 구조

list와 record는 서로의 안에 얼마든지 들어갈 수 있습니다. 이 성질 덕분에 JSON, YAML, TOML 같은 형식이 Nushell 값으로 손실 없이 옮겨지고, 7단원에서 `open`으로 파일을 열면 이런 값이 바로 나옵니다.

```nu
let config = {
  name: "app"
  ports: [80 443]
  db: {host: "localhost", port: 5432}
}

$config.db.port              # 5432
$config.ports.1              # 443
$config | describe
# record<name: string, ports: list<int>, db: record<host: string, port: int>>
```

**판단 기준.** "위치로 부르면 list, 이름으로 부르면 record"입니다. 같은 성격의 값 여러 개(파일 이름 여러 개)는 list, 한 대상의 속성(파일 한 개의 이름, 크기, 시각)은 record입니다.

**흔한 오해.** record를 `{name: kim}`으로 쓸 때 필드명에 따옴표를 붙이지 않아도 된다는 점이 처음에는 낯섭니다. 필드명은 변수가 아니라 이름 자체이므로 따옴표가 필요 없고, 공백이나 특수문자가 있을 때만 필요합니다.

## table은 record의 list

table은 별개의 타입처럼 보이지만 실체는 "같은 필드를 가진 record들의 list"입니다. 이 한 가지를 이해하면 `ls`, `ps`, CSV, JSON 배열 같은 표 모양 데이터가 왜 전부 같은 명령으로 다뤄지는지 설명됩니다.

### 두 가지 표기, 같은 값

표 모양을 직접 쓰는 문법은 머리글 줄, 세미콜론(`;`), 데이터 줄로 구성됩니다.

```nu
[[name age]; [kim 30] [lee 25] [park 41]]
```

첫 대괄호 `[name age]`가 열 이름이고, `;` 뒤의 `[kim 30]` 같은 묶음이 행입니다. 이 값은 아래의 "record 목록"과 완전히 같은 값입니다.

```nu
[{name: kim, age: 30} {name: lee, age: 25} {name: park, age: 41}]

([[name age]; [kim 30]] == [{name: kim, age: 30}])   # true
[[name age]; [kim 30] [lee 25]] | describe           # table<name: string, age: int>
```

`describe`가 `list<record<...>>`가 아니라 `table<name: string, age: int>`라고 줄여서 보여 줄 뿐, 두 표기는 같은 데이터를 가리킵니다. 그래서 table에 list 명령(`length`, `first`, `reverse`)이 그대로 통하고, 행 하나를 꺼내면 record 명령(`get`, `select`)이 그대로 통합니다.

### 열과 행의 개념

| 용어 | 정체 | 예 |
| --- | --- | --- |
| 행(row) | record 하나 | `{name: kim, age: 30}` |
| 열(column) | 모든 record에 공통으로 있는 필드 이름 | `name`, `age` |
| 셀(cell) | 특정 행의 특정 열의 값 | kim, 30 |

### 표에서 꺼내고 걸러 내는 방법

아래 변수를 기준으로 입력 타입과 출력 타입이 어떻게 달라지는지 확인합니다.

```nu
let t = [[name age]; [kim 30] [lee 25] [park 41]]

$t | length                  # 3                          (int)
$t | first                   # {name: kim, age: 30}       (record)
$t | first 2                 # 위 두 행                    (table)
$t | get name                # [kim, lee, park]           (list<string>)
$t | select name             # name 열만 가진 표           (table)
$t.1.name                    # lee                        (string, 셀 경로)
$t | where age > 26          # kim과 park 행               (table)
$t | sort-by age            # age 오름차순으로 정렬한 표   (table)
$t | get age | math avg      # 32                         (age 열의 평균)
```

이 중 핵심은 `get`과 `select`의 차이입니다.

- `get name`은 열 **안의 값**을 꺼내 list로 돌려줍니다. 표의 껍데기가 벗겨지므로 다음에 쓸 명령은 list용(`math avg`, `each`, `first`)입니다.
- `select name`은 열 **자체**를 골라 여전히 table로 돌려줍니다. 열 이름이 남아 있어 `sort-by`나 `where`를 이어서 쓸 수 있습니다.
- `first`는 인자가 없으면 record 한 개, `first 2`처럼 개수를 주면 table입니다. 인자 하나로 출력 타입이 바뀌는 대표적인 사례입니다.

`$t.1.name`의 셀 경로를 읽으면 "표에서 1번 행(두 번째)을 꺼내고, 그 행의 name 필드를 꺼낸다"입니다. 앞서 배운 list의 위치 접근과 record의 이름 접근이 순서대로 이어진 것입니다.

### ls 결과를 해부한다

`ls`가 돌려주는 값이 정확히 이 구조입니다.

```nu
ls | describe
# table<name: string, type: string, size: filesize, modified: datetime> (stream)

ls | first | describe
# record<name: string, type: string, size: filesize, modified: datetime>

ls | get name | describe         # list<string>
ls | get size | describe         # list<filesize>
ls | length | describe           # int
```

- `ls`의 한 행은 파일 하나를 설명하는 record이고, 필드는 이름(string), 종류(string), 크기(filesize), 수정 시각(datetime)입니다. 필드마다 서로 다른 타입을 갖는 것이 record의 특징이었습니다.
- 끝의 `(stream)`은 값이 한꺼번에 메모리에 올라와 있지 않고 흘러오는 중이라는 표시입니다. 큰 디렉터리를 효율적으로 처리하기 위한 장치이며 12단원에서 다룹니다. 지금은 table과 같은 것으로 읽으면 됩니다.
- `size` 열의 타입이 숫자가 아니라 filesize이므로 `ls | where size > 1mb`처럼 단위 리터럴과 바로 비교됩니다. 앞 절의 단위 값이 여기서 쓰입니다.

`ps`도 같은 구조입니다. 열 구성은 운영체제마다 조금 다르지만(프로세스 번호 `pid`, 이름 `name`, 메모리 `mem` 등), `ps | describe`로 직접 확인하면 `table<...>` 형태가 나옵니다. 1단원의 "ls와 ps 비교" 과제가 이제 의미를 갖습니다. 둘은 같은 table 타입이고 열 이름과 열 타입만 다릅니다.

### 번호 열 `#`은 데이터가 아니다

표를 출력하면 맨 왼쪽에 `#` 열(0, 1, 2 …)이 보이지만, 이것은 화면에 그려 주는 행 번호일 뿐 표 안의 열이 아닙니다. `ls | get '#'`은 동작하지 않습니다. 번호를 데이터로 쓰고 싶다면 `enumerate`로 명시적으로 만듭니다.

```nu
[a b c] | enumerate
# 각 행이 {index: 0, item: a}, {index: 1, item: b}, {index: 2, item: c}
[a b c] | enumerate | describe      # table<index: int, item: string>
```

**판단 기준.** 표 모양으로 보이면 일단 "record의 list"로 생각합니다. 열 하나가 필요하면 `get`(값만) 또는 `select`(표 유지)를, 행 하나가 필요하면 `first`나 `$t.n`을, 행을 걸러 내려면 `where`를 고릅니다.

## 파이프라인: 값이 흘러가는 길

파이프라인은 앞 명령이 돌려준 값을 뒤 명령의 입력으로 넘기는 연결이고, 각 명령은 "무슨 타입을 받아 무슨 타입을 돌려주는가"가 정해진 부품입니다. 부품의 규격만 맞으면 어떤 순서로도 조립할 수 있다는 점이 Nushell 한 줄짜리 코드가 강력한 이유입니다.

### 파이프의 기본 동작

`|` 왼쪽 식의 결과가 오른쪽 명령의 입력이 됩니다. 아래는 모두 같은 원리의 변주입니다.

```nu
"hello" | str upcase                    # HELLO
[3 1 2] | sort                          # [1, 2, 3]
[3 1 2] | sort | reverse                # [3, 2, 1]
ls | length                             # 현재 디렉터리의 항목 수
ls | where size > 1kb | length          # 1kB보다 큰 항목 수
```

길어지면 줄을 바꿔 한 단계씩 적을 수 있습니다. 다음 줄이 `|`로 시작하면 이전 줄에 이어집니다.

```nu
ls
| where type == file
| sort-by size --reverse
| first 3
| select name size
```

### 단계마다 타입이 바뀐다

위 다섯 줄을 단계별로 쪼개서 각 단계가 받는 타입과 내놓는 타입을 적어 보면, 파이프라인이 타입의 연쇄라는 말의 뜻이 드러납니다.

| 단계 | 명령 | 받는 입력 | 돌려주는 출력 |
| --- | --- | --- | --- |
| 1 | `ls` | 없음 | table (name, type, size, modified) |
| 2 | `where type == file` | table | table (행이 줄어듦) |
| 3 | `sort-by size --reverse` | table | table (순서만 바뀜) |
| 4 | `first 3` | table | table (3행) |
| 5 | `select name size` | table | table (2열) |

이 파이프라인을 마지막에 `get name`으로 끝내면 5단계의 출력이 `list<string>`으로 바뀌고, `length`로 끝내면 `int`가 됩니다. **마지막 단계가 무엇이냐에 따라 최종 결과의 타입이 결정됩니다.**

### 명령의 입력/출력 규격을 읽는 법

각 명령의 규격은 `help` 문서의 "Input/output types" 항목에 표로 나옵니다.

```nu
help length
help sort-by
help get
```

`input` 열은 받을 수 있는 타입, `output` 열은 그때 돌려주는 타입입니다. 한 명령이 여러 입력 타입을 받는 경우 줄이 여러 개입니다. 예를 들어 `length`는 list나 table 같은 컬렉션을 받아 int를 돌려줍니다. 이 표를 읽을 수 있으면 "이 명령을 지금 이 자리에 쓸 수 있는가"를 실행해 보지 않고도 판단할 수 있고, 8단원의 커스텀 명령 시그니처(`string -> int`)도 같은 문법으로 직접 씁니다.

### 인자와 파이프 입력은 역할이 다르다

명령에 전달되는 것은 두 갈래입니다.

- **파이프 입력**은 가공할 대상입니다. `ls | sort-by size`에서 `ls`의 표가 입력입니다.
- **인자**는 명령의 설정입니다. 같은 줄의 `size`(어느 열로 정렬할지)와 `--reverse`(내림차순)가 인자입니다.

```nu
ls /tmp                              # 인자 /tmp: 어디를 볼지
"a,b,c" | split row ","              # 입력은 문자열, 인자는 구분자
"a,b,c" | split row "," | length     # 3
```

외부에서 온 글자를 Nushell 값으로 바꾸는 과정에서 이 구분이 자주 쓰입니다.

```nu
"kim 30" | parse "{name} {age}"                  # 1행 table, 값은 모두 string
"kim 30" | parse "{name} {age}" | describe       # table<name: string, age: string>
"kim 30" | parse "{name} {age}" | into int age   # age 열이 int로 바뀜
```

`parse`는 글자에서 패턴 조각을 뽑아 table로 만듭니다. 뽑은 값은 모두 글자이므로 `30`이 숫자가 아니라 `"30"`이라는 점이 중요합니다. 숫자 연산이 필요하면 `into int`로 변환해야 하고, 이것이 "타입을 의식하며 파이프를 짠다"의 전형적인 사례입니다.

### 무엇이 화면에 출력되는가

대화형 셸에서는 입력한 줄의 **마지막 값**이 표 모양으로 화면에 그려집니다. 중간 단계의 값은 다음 단계로 넘어갈 뿐 보이지 않습니다. 스크립트 파일이나 클로저 안에서도 같은 규칙이 적용되어, 블록의 마지막 식의 값만 결과가 되고 중간 값은 버려집니다. 중간 값을 보고 싶으면 `print`로 명시적으로 출력합니다.

```nu
print "시작"                  # 시작
let n = 3                    # 변수 선언 (출력 없음)
print $"n은 ($n)"            # n은 3
$n * 2                       # 6 (마지막 값이라 자동 출력)
```

이 "마지막 값만 보인다"는 성질 때문에 긴 파이프라인에서 값이 이상해졌을 때 어느 단계에서 틀어졌는지 눈으로 찾기 어렵습니다. 해법이 다음 절의 `describe`입니다.

### 흔한 오해

- **"파이프는 명령을 순서대로 실행하는 장치다."** 순서 실행은 줄바꿈이나 `;`가 하는 일입니다. 파이프는 값을 넘기는 연결입니다. 값이 넘어갈 수 없는 조합(예: 문자열을 받지 않는 명령에 문자열을 연결)은 오류가 납니다.
- **"파이프를 거치면 모양이 그대로다."** 단계마다 타입이 바뀔 수 있습니다. `get`은 table을 list로, `length`는 table을 int로 바꿉니다.
- **"외부 명령도 같은 값을 내놓는다."** `^ls`는 글자입니다. 글자를 구조로 바꾸려면 `lines`, `split row`, `parse` 같은 변환 명령이 필요합니다.

**판단 기준.** 파이프라인을 짤 때는 "지금 왼쪽에서 오는 타입은 무엇이고, 다음 명령은 그 타입을 받는가"를 매 단계 확인합니다. 확신이 없으면 그 자리에 `| describe`를 끼워 넣어 확인하면 됩니다.

## describe로 중간 단계의 타입 확인하기

`describe`는 파이프라인 어느 지점에서든 "지금 흐르는 값이 무슨 타입인가"를 문자열로 알려 주는 진단 도구이며, 타입 오류를 푸는 첫 번째 수단입니다. 오류가 났을 때 코드를 다시 읽기 전에 `describe`로 값부터 확인하는 습관을 들이면 원인의 대부분이 바로 보입니다.

### 사용법: 잘라서 확인한다

`describe`는 입력받은 값을 타입 설명 문자열로 **바꿔 버리므로**, 그 뒤에 다른 명령을 이어 쓸 수 없습니다. 그래서 파이프라인을 한 단계씩 늘려 가며 끝에 붙이는 방식으로 씁니다.

```nu
ls | describe
# table<name: string, type: string, size: filesize, modified: datetime> (stream)

ls | where size > 1kb | describe
# table<name: string, type: string, size: filesize, modified: datetime> (stream)

ls | where size > 1kb | get name | describe
# list<string>

ls | where size > 1kb | get name | first | describe
# string
```

단계가 나아갈수록 table, table, list, string으로 타입이 "껍데기를 벗는" 모습이 한눈에 보입니다. 앞 절의 단계 표를 실제 출력으로 확인한 셈입니다.

### 출력을 읽는 법

| `describe` 출력 | 읽는 법 |
| --- | --- |
| `int`, `float`, `string`, `bool` | 스칼라 값 하나 |
| `filesize`, `duration`, `datetime` | 단위가 붙은 값 |
| `list<int>` | 정수의 목록. 꺾쇠 안이 원소 타입 |
| `list<any>` 등 | 원소 타입이 섞인 목록 |
| `record<name: string, age: int>` | 필드 이름과 타입을 모두 보여 주는 record |
| `table<name: string, age: int>` | 열 이름과 열 타입을 보여 주는 table |
| 끝의 `(stream)` | 값이 흘러오는 중인 스트림. 내용은 같은 타입으로 읽으면 됨 |
| `nothing` | 아무 값도 없음 |

11단원에서는 `describe --detailed`로 더 자세한 구조를 볼 것이며, 위 표기법은 그때 직접 쓰는 타입 시그니처와 같은 문법입니다.

### 오류를 진단하는 두 가지 사례

**사례 1. 열이 사라졌다.** 크기순으로 정렬한 이름 목록을 뽑으려는 아래 코드는 오류가 납니다.

```nu
ls | get name | sort-by size      # 오류
```

원인을 찾으려고 `sort-by` 앞에서 끊어 `describe`를 붙입니다.

```nu
ls | get name | describe          # list<string>
```

`get name` 이후에는 열이 아니라 문자열의 list만 남았으므로 `size`라는 열을 찾을 수 없다는 것이 원인입니다. **열이 필요한 명령은 열을 버리는 명령(`get`)보다 앞에 와야 합니다.** 순서를 바꾸면 해결됩니다.

```nu
ls | sort-by size | get name       # 정상
```

**사례 2. 숫자인 줄 알았던 글자.** 다음은 외부 글자에서 뽑은 값을 계산하려는 경우입니다.

```nu
"kim 30" | parse "{name} {age}" | get age | first | $in + 1   # 오류
```

중간에 `describe`를 끼워 보면 `age`가 `string`임이 드러납니다.

```nu
"kim 30" | parse "{name} {age}" | get age | first | describe   # string
```

해결은 계산 전에 변환하는 것입니다.

```nu
"kim 30" | parse "{name} {age}" | get age | first | into int | $in + 1   # 31
```

여기 나온 `$in`은 "파이프로 넘어온 입력"을 가리키는 변수이며 6단원에서 정식으로 배웁니다. 지금은 `| $in + 1`을 "앞에서 넘어온 값에 1을 더한다"로 읽으면 충분합니다.

### 값을 흘려보내면서 들여다보기: inspect

`describe`는 값을 소비하지만 `inspect`는 값의 타입과 내용을 화면에 보여 준 뒤 **값을 그대로 다음 단계로 넘깁니다.** 파이프라인을 끊지 않고 중간 점검을 할 때 편리합니다.

```nu
ls | where size > 1kb | inspect | get name
```

`inspect`가 보여 주는 박스의 모양은 버전에 따라 다를 수 있으니, 처음 한 번 실행해서 본인 환경의 출력을 확인해 두세요. 이 명령은 `help inspect`로 자세한 설명을 볼 수 있습니다.

### 더 둘러보기: explore

큰 table이나 깊게 중첩된 record는 `explore`로 탐색할 수 있습니다. 1단원에서 맛본 대로 값을 파이프로 넘기면 화살표 키로 열과 행을 오가며 구조를 확인할 수 있습니다.

```nu
ls | explore
$config | explore       # 앞 절에서 만든 중첩 record를 탐색
```

**판단 기준.** 오류가 났거나 결과가 예상과 다르면 "오류가 난 명령 바로 앞까지 잘라서 `describe`"를 먼저 합니다. 타입이 예상과 다르면 원인은 대개 그 앞 단계에 있습니다.

## 흔한 오해와 오류 읽기

초보 단계에서 만나는 오류는 대부분 세 가지 원인으로 모입니다. 값의 타입이 예상과 다르거나, 열이나 위치가 존재하지 않거나, bash에서 익힌 문법을 그대로 쓴 경우입니다. 오류 메시지를 읽는 법을 알면 이 셋을 구별하는 데 몇 초면 충분합니다.

### 오류 메시지의 구조

Nushell의 오류는 "무엇이 문제인가", "어디인가", "어떻게 고치는가"를 함께 보여 줍니다. 아래는 정수와 문자열을 더했을 때의 대략적인 모양입니다. 문구와 줄 모양은 버전에 따라 조금씩 다릅니다.

```nu
1 + "2"
# Error: nu::shell::operator_incompatible_types
#   × Types mismatched for operation
#    ╭─[entry #1:1:3]
#  1 │ 1 + "2"
#    ·   ┬   ─┬─
#    ·   │    ╰── string
#    ·   ╰── int
#    ╰────
#   help: Change int or string to be the right types and try again.
```

- **오류 코드**(`nu::shell::...`): 오류의 종류 이름입니다. 검색하거나 공식 문서에서 찾을 때 쓰는 열쇠입니다.
- **본문 한 줄**(`Types mismatched for operation`): 사람이 읽는 요약입니다.
- **소스 조각과 밑줄**: 어느 부분이 문제인지 가리키며, 밑줄마다 붙은 라벨이 **그 부분의 타입**(`int`, `string`)을 알려 줍니다. 이 단원에서 배운 타입 이름이 여기서 곧바로 읽힙니다.
- **help**: 고치는 방향의 힌트입니다.

그래서 위 오류의 해법은 한 줄입니다. 글자를 정수로 바꿔 계산합니다.

```nu
1 + ("2" | into int)       # 3
```

### 증상별 점검표

| 증상 | 대표 원인 | 확인과 해결 |
| --- | --- | --- |
| `Types mismatched for operation` 계열 | 서로 다른 타입끼리 연산 | 양쪽을 `describe`로 확인하고 `into int` 등으로 맞춘다 |
| `Cannot find column '...'` | 없는 열이나 필드를 요청함, 또는 앞 단계에서 열이 이미 사라짐 | `columns`나 `describe`로 현재 열을 확인하고, 열 선택(`get`)을 뒤로 옮긴다 |
| `Row number too large` 계열 | 목록의 길이보다 큰 위치를 요청함 | `length`로 길이를 확인한다. 위치는 0부터 시작한다 |
| `Input type not supported` 계열 | 그 명령이 받지 않는 타입을 흘려보냄 | 앞 단계 끝에 `describe`를 붙여 타입을 확인하고, `help 명령`의 Input/output types와 대조한다 |
| 예상과 다른 결과, 오류 없음 | 숫자가 사실은 글자라서 문자 순서로 정렬 등 | 아래 "조용한 오류"를 참고한다 |

### 조용한 오류: 글자로 정렬되는 숫자

타입을 몰라서 생기는 가장 교묘한 문제는 오류 없이 틀린 결과가 나오는 경우입니다.

```nu
[10 9 100] | sort                  # [9, 10, 100]   (정수는 수의 크기순)
["10" "9" "100"] | sort          # [10, 100, 9]   (문자열은 글자 순서)
["10" "9" "100"] | into int | sort   # [9, 10, 100]
```

두 번째 줄은 `"10"`이 `"9"`보다 앞에 오는데, 글자 순서로는 `1`이 `9`보다 앞서기 때문입니다. 외부 명령이나 CSV의 일부 입력에서 숫자가 글자로 들어오면 이런 일이 생기므로, 의심스러울 때 `describe`가 가장 빠른 진단입니다.

### bash 습관에서 오는 문법 실수

| bash에서 쓰던 것 | Nushell | 설명 |
| --- | --- | --- |
| `x=5` | `let x = 5` | 변수는 `let`으로 선언한다(5단원) |
| `echo $HOME` | `$env.HOME` | 환경 변수는 `$env`라는 record에 들어 있다(9단원) |
| `$((1+2))` | `1 + 2` | 계산식에 별도 문법이 없다 |
| `10 % 3` | `10 mod 3` | 나머지 연산은 `mod` |
| `cmd1 && cmd2` | 줄바꿈 또는 `;` | `&&`는 지원하지 않는다. 논리 연산은 `and`, `or` |
| `ls -la` | `ls -a -l` | 짧은 플래그는 묶어 쓰지 못하고 각각 쓴다 |

```nu
1 + 2          # 3
1+2            # 연산자 양옆에 공백이 없으면 계산이 아닌 한 덩어리 글자로 읽힘
{name: kim}    # 필드명 뒤 콜론 다음에 공백을 둔다
```

연산자 양옆의 공백은 단순한 취향이 아닙니다. `+`나 `:` 같은 기호가 글자의 일부로도 쓰일 수 있기 때문에, 공백이 Nushell이 "여기가 연산자"라고 판단하는 단서가 됩니다. 계산이 이상하게 동작하면 먼저 공백을 확인하세요.

### 오해 바로잡기

- **"따옴표를 붙이면 안전하다."** 숫자에 따옴표를 붙이면 문자열이 되어 계산이 안 됩니다. 값의 성격에 맞게 쓰고, 불확실하면 `describe`로 확인합니다.
- **"table과 list는 다른 세계다."** table은 record의 list입니다. 그래서 `length`, `first`, `reverse` 같은 list 명령이 그대로 통합니다.
- **"오류가 나면 이전 명령을 다 의심해야 한다."** 오류의 라벨이 문제 부분의 타입을 이미 알려 줍니다. 라벨의 타입과 기대한 타입을 비교하는 것이 출발점입니다.

**판단 기준.** 오류를 만나면 (1) 오류 코드와 라벨의 타입을 읽고, (2) 문제 지점 앞에서 `describe`로 실제 타입을 확인하고, (3) `into`로 변환하거나 명령 순서를 바꿉니다. 이 세 걸음이 대부분의 입문 오류를 해결합니다.

## 실습 과제 풀이와 추가 연습

과제의 요지는 "내가 손으로 만든 데이터가 `ls`의 결과와 같은 종류의 값임을 `describe`로 증명하는 것"입니다. 먼저 과제를 단계별로 풀고, 이어서 혼자 풀어 볼 연습 문제를 해설과 함께 제시합니다.

### 단원 과제

> 리스트와 레코드를 직접 만들어 `describe`로 타입을 확인하고, 같은 데이터가 `ls` 결과(table)와 어떻게 다른지 설명해 본다.

**1단계. list를 만들고 타입을 확인한다.**

```nu
let names = ["a.md" "b.md" "c.txt"]
$names | describe          # list<string>
$names | length            # 3
$names.0                   # a.md
```

**2단계. record를 만들고 타입을 확인한다.** `ls`의 한 행과 같은 필드를 갖도록 만듭니다. 크기와 날짜에는 단위 리터럴을 씁니다.

```nu
let one = {name: "a.md", type: "file", size: 1.5kb, modified: 2026-10-29}
$one | describe
# record<name: string, type: string, size: filesize, modified: datetime>
$one.size                  # 1.5 kB
```

**3단계. record를 모아 table로 만든다.**

```nu
let mine = [
  $one
  {name: "b.md", type: "file", size: 20kb, modified: 2026-10-28}
  {name: "c.txt", type: "file", size: 300b, modified: 2026-10-27}
]
$mine | describe
# table<name: string, type: string, size: filesize, modified: datetime>
```

**4단계. `ls` 결과와 비교한다.** 같은 명령을 두 값에 적용해 봅니다.

```nu
$mine | sort-by size --reverse | get name   # [b.md, a.md, c.txt]
ls | sort-by size --reverse | get name       # 같은 방식으로 동작
$mine | where size > 1kb | length            # 2
($mine | columns) == (ls | columns)          # true (열 이름이 같다)
```

**5단계. 차이를 설명한다.** 정리하면 다음과 같이 쓸 수 있습니다.

| 비교 항목 | 내가 만든 `$mine` | `ls` 결과 |
| --- | --- | --- |
| 값의 타입 | `table<name, type, size, modified>` | 같은 구조의 table |
| 만들어진 방식 | 내가 리터럴로 직접 입력 | 명령이 파일 시스템을 읽어 생성 |
| 스트림 여부 | 메모리에 모두 있는 값 | `(stream)`으로 흘러오는 값 |
| 적용 가능한 명령 | `where`, `sort-by`, `get`, `select` 등 | 동일 |

모범 답안의 요지: "같은 타입이다. `ls`의 결과는 파일 하나를 설명하는 record를 모은 table이고, 내가 만든 값도 같은 필드를 가진 record의 list다. 그래서 같은 명령이 똑같이 동작한다. 차이는 값이 어디서 왔느냐(직접 입력 대 명령 실행)와 스트림 여부뿐이다."

### 추가 연습 문제

직접 풀어 본 뒤 해설을 확인하세요.

**문제 1.** `[5 3 8 1]`에서 가장 큰 수를 구하고, 결과의 타입을 `describe`로 확인하세요.

해설: `[5 3 8 1] | sort | last`는 `8`이고 `... | last | describe`는 `int`입니다. 정렬 없이 `[5 3 8 1] | math max`도 같은 결과입니다. 목록에서 값을 꺼내면 원소 타입(int)이 됩니다.

**문제 2.** 다음 코드의 오류를 고치세요.

```nu
"42" + 1
```

해설: 문자열과 정수는 더할 수 없습니다. `("42" | into int) + 1`로 바꾸면 `43`입니다. 오류 라벨에 string과 int가 나타나는 것을 확인해 보세요.

**문제 3.** `[[name score]; [a 80] [b 90] [c 100]]`에서 점수의 평균을 구하세요.

해설: `... | get score | math avg`는 `90`입니다. `get score`가 table을 `list<int>`로 바꿔 주었기 때문에 list용 명령 `math avg`를 쓸 수 있습니다. `select score | math avg`로 하면 table이 입력되어 열 이름이 붙은 결과가 나올 수 있으니, 두 방식의 `describe` 결과를 비교해 보세요.

**문제 4.** 1부터 10까지 중 짝수만 뽑으세요.

해설: `1..10 | where {|n| $n mod 2 == 0}`은 `[2, 4, 6, 8, 10]`입니다. range는 파이프를 지나며 값을 하나씩 흘려보내는 재료이고, `where`는 조건이 참인 값만 남깁니다. `mod`와 `==`가 함께 쓰인 식은 먼저 `$n mod 2`가 계산됩니다.

**문제 5.** 아래 다섯 줄의 `describe` 결과를 실행하기 전에 예측해 보세요.

```nu
ls | length | describe
ls | first | describe
ls | get name | describe
ls | select name | describe
ls | get name | first | describe
```

해설: 순서대로 `int`, `record<name: string, type: string, size: filesize, modified: datetime>`, `list<string>`, `table<name: string>`(스트림 표시가 붙을 수 있음), `string`입니다. 모두 "table에서 무엇을 어떻게 꺼냈는가"에 따라 타입이 달라지는 사례입니다. 하나라도 틀렸다면 앞의 "표에서 꺼내고 걸러 내는 방법" 절을 다시 읽어 보세요.

**문제 6.** `2hr + 30min`이 `150min`과 같은지 `==`로 확인하세요.

해설: `2hr + 30min == 150min`은 `true`입니다. 덧셈이 비교보다 먼저 계산되고, 단위가 다른 duration끼리도 같은 타입이므로 비교됩니다.

**문제 7.** 올해 1월 1일로부터 지금까지 경과한 시간의 타입은 무엇일까요?

해설: `(date now) - 2026-01-01 | describe`는 `duration`입니다. datetime에서 datetime을 빼면 duration이 되는 규칙입니다.

## 정리와 다음 단원

이 단원의 결론은 두 문장입니다. Nushell의 값에는 타입이 있고, 파이프는 그 타입이 있는 값을 단계마다 넘긴다는 것입니다. 그래서 막히면 `describe`로 "지금 무슨 값이 흐르는가"를 먼저 확인합니다.

### 핵심 요약

| 개념 | 한 줄 정리 |
| --- | --- |
| 스칼라 | int, float, string, bool, nothing에 더해 filesize, duration, datetime, range까지 전용 타입이 있다 |
| list | 위치(`.0`)로 꺼내는 값의 나열이고, `list<int>`처럼 원소 타입이 표시된다 |
| record | 이름(`.name`)으로 꺼내는 필드의 묶음이고, 필드마다 타입이 다를 수 있다 |
| table | 같은 필드를 가진 record의 list이다. `ls`와 `ps`가 그 예이다 |
| 셀 경로 | `$t.1.name`처럼 점으로 이어 깊이 들어가는 접근 표기 |
| 파이프라인 | 앞 명령의 출력 값이 뒤 명령의 입력이 된다. 단계마다 타입이 바뀔 수 있다 |
| `get`과 `select` | `get`은 값만 꺼내 list로, `select`는 열을 골라 table로 돌려준다 |
| `describe` | 값의 타입을 알려 주는 진단 도구. 값을 소비하므로 파이프 끝에 붙인다 |
| `into` | 타입을 명시적으로 바꾼다 (`into int` 등) |

### 스스로 점검하기

다음 항목을 설명하거나 직접 실행해 보면 이 단원을 마친 것입니다.

- [ ] `42`, `"42"`, `42.0`, `42kb`의 타입 이름을 각각 말할 수 있다
- [ ] `[1 2 3]`, `{a: 1}`, `[[a]; [1]]`이 각각 list, record, table인 이유를 설명할 수 있다
- [ ] table이 "record의 list"라는 말을 `ls | first`의 결과로 증명할 수 있다
- [ ] `get name`과 `select name`의 출력 타입 차이를 말할 수 있다
- [ ] 긴 파이프라인에서 `describe`를 끝에 붙여 중간 타입을 확인할 수 있다
- [ ] `Types mismatched` 오류의 라벨에서 문제 타입을 읽고 `into`로 고칠 수 있다

### 다음 단원과의 연결

3단원에서 `open`으로 파일을 열면 파일 형식에 따라 서로 다른 타입의 값이 나옵니다. 마크다운이나 텍스트 파일은 string, JSON 객체는 record, JSON 배열이나 CSV는 table로 열리는 식입니다. 열어 본 뒤 `| describe`를 붙이는 습관이 이 단원에서 완성되었으므로 "이 파일이 무슨 타입으로 들어왔는가"를 곧바로 확인할 수 있습니다. 4단원에서는 이 단원에서 맛본 `where`, `select`, `get`, `first`, `sort-by`를 본격적으로 쓰는 법과 행과 열을 다루는 사고방식을 체계화합니다.

### 근거와 한계

타입 목록, 리터럴 문법, 연산자, 파이프라인의 입출력 규칙은 아래 공식 문서에서 확인했습니다(2026-10-29 열람). 반면 `describe`와 오류 메시지의 정확한 출력 문구, 표 렌더링 모양, 일부 명령의 세부 동작(`inspect`의 박스 모양, `into int`의 열 지정 등)은 작성 환경에서 직접 실행하지 못했으므로 문서 규칙과 일반 동작에 근거한 설명입니다. 본인 환경과 다르면 환경의 출력이 정답입니다.

**출처**

- [Types of Data | Nushell](https://www.nushell.sh/book/types_of_data.html)
- [Pipelines | Nushell](https://www.nushell.sh/book/pipelines.html)
- [inspect | Nushell 명령어 문서](https://www.nushell.sh/commands/docs/inspect.html)
- [Operators | Nushell 언어 가이드](https://www.nushell.sh/lang-guide/chapters/operators.html)
