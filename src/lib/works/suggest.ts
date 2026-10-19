// 비슷한 글감 제안: 한글 어근 정규화 없이 단어 + 문자 2-gram 을 BM25 로 채점한다.
// 조사("글감을"/"글감이") 때문에 단어 일치가 약하므로 2-gram 토큰이 실질적인 매칭을 맡는다.
export interface Candidate { id: string; text: string }
export interface Ranked { id: string; score: number }

const K1 = 1.2;
const B = 0.75;
const WORD_WEIGHT = 0.5; // 단어 토큰은 2-gram 보다 약하게 (조사 변형에 약하지만 정확히 맞으면 가산)

/** 마크다운 잡음(이미지 데이터·URL·기호)을 걷어 낸 소문자 단어 목록 */
function words(text: string): string[] {
  const clean = text.replace(/!?\[[^\]]*\]\((?:data:[^)]*|[^)]*)\)/g, ' ').replace(/https?:\/\/\S+/g, ' ').toLowerCase();
  return clean.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** 토큰 → 빈도. 단어는 "w:" 접두, 2-gram 은 "b:" 접두 */
export function tokenize(text: string): Map<string, number> {
  const tf = new Map<string, number>();
  const add = (t: string) => tf.set(t, (tf.get(t) ?? 0) + 1);
  for (const w of words(text)) {
    const cs = [...w];
    if (cs.length >= 2) add(`w:${w}`);
    for (let i = 0; i + 2 <= cs.length; i++) add(`b:${cs[i]}${cs[i + 1]}`);
  }
  return tf;
}

/**
 * query 와 비슷한 후보를 점수 내림차순으로 최대 topN 개. 점수 0 은 제외한다.
 * 같은 글감 제외는 호출자가 candidates 에서 자기 자신을 빼서 처리한다(id 로 비교하지 않는다).
 */
export function rankByText(query: string, candidates: Candidate[], topN = 5): Ranked[] {
  const q = tokenize(query);
  if (!q.size || !candidates.length || topN <= 0) return [];
  const docs = candidates.map((c) => ({ id: c.id, tf: tokenize(c.text) }));
  const lens = docs.map((d) => [...d.tf.values()].reduce((a, b) => a + b, 0));
  const avg = lens.reduce((a, b) => a + b, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) if (q.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const out: Ranked[] = [];
  docs.forEach((d, i) => {
    let score = 0;
    for (const t of q.keys()) {
      const f = d.tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const w = t.startsWith('w:') ? WORD_WEIGHT : 1;
      score += w * idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (lens[i] / avg))));
    }
    if (score > 0) out.push({ id: d.id, score });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, topN);
}

/** AI 연관 검색 등으로 바꿔 끼울 수 있는 제안 공급자 (이번 범위에서는 로컬 구현만 있다) */
export interface SuggestProvider {
  name: string;
  rank(query: string, candidates: Candidate[], topN: number): Promise<Ranked[]>;
}

export const localProvider: SuggestProvider = {
  name: 'local-bm25',
  rank: async (query, candidates, topN) => rankByText(query, candidates, topN),
};

let provider: SuggestProvider = localProvider;
export function setSuggestProvider(p: SuggestProvider | null) { provider = p ?? localProvider; }
export function suggestProvider(): SuggestProvider { return provider; }
