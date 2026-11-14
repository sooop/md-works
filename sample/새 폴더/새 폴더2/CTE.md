CTE가 해결하는 문제

중간 결과를 거쳐야 하는 쿼리는 서브쿼리가 겹겹이 쌓이기 쉽다. 서브쿼리는 안쪽부터 읽어야 하고, 같은 서브쿼리를 두 번쓰려면 반복해서 그래도 넣어야 한다. CTE(Common Table Expression: 공통 테이블 표현식)는 그 중간 결과에 이름을 붙여 쿼리 맨 앞에 선언한다. 독자는 위에서 아래로 읽으면 된다.CTE는 한 문장이 실행되는 동안만 존재하는 임시 뷰와 같다. 문장이 끝나면 사라지므로 테이블을 만들거나 지울 필요는 없다. 

오래된 SQLite3에서는 재귀 CTE를 사용할 수 없다. `SELECT sqlite_version();`으로 버전을 확인해줘야 한다.

## 기본 문법

```sql
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, region TEXT);
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, order_date TEXT, amount REAL);
CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, boss_id INTEGER);
CREATE TABLE edges (src TEXT, dst TEXT);
```

CTE는 `WITH 이름 AD (쿼리)`의 구문 형식을 쓴다. 

```sql
WITH monthly AS (
  SELECT customer_id, substr(order_date, 1, 7) AS ym, SUM(amount) AS total
  FROM orders
  GROUP BY customer_id, ym
)
SELECT c.name, m.ym, m.total
FROM monthly m JOIN customers c ON c.id = m.customer_id
ORDER BY m.ym, m.total DESC;
```

> 주문에서 연도별, 고객별로 고객번호, 연도, 구매총액을 계산하여 monthly 라는 임시 테이블로 정의하고,
>
> 다시 monthly를 customers에 조인하여 이름, 연도, 구매액을 출력함

<br />
