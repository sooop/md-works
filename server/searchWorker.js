// 본문 검색을 별도 스레드에서 돌린다. 사용자가 준 정규식이 오래 걸려도 부모가 terminate 로 끊을 수 있다.
import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import { buildMatcher, searchText } from './searchCore.js';

const { files, query, opts, perFile, total, maxBytes } = workerData;
const { re } = buildMatcher(query, opts);
const results = [];
let count = 0;
let truncated = false;

for (const f of files) {
  if (count >= total) { truncated = true; break; }
  let text;
  try {
    if (fs.statSync(f.abs).size > maxBytes) continue;
    text = fs.readFileSync(f.abs, 'utf8');
  } catch { continue; }
  const r = searchText(text, re, { maxMatches: Math.min(perFile, total - count) });
  if (!r.matches.length) continue;
  count += r.matches.length;
  if (r.truncated) truncated = true;
  results.push({ path: f.path, matches: r.matches, more: r.truncated });
}
parentPort.postMessage({ results, count, truncated });
