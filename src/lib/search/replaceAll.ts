// 전체 바꾸기: 모드(서버·스탠드얼론)마다 다른 부분은 ReplaceHost 로 분리하고, 순서와 오류 처리는 여기서 한 번만 정한다.
import type { SearchOpts } from '../../../server/searchCore.js';
import { replaceInMarkdown } from './replaceText';

export interface DocRef { id: string; label: string }

export interface ReplaceHost {
  /** 바꿀 후보 글(휴지통·숨김 폴더 제외). partial: 검색 상한 때문에 일부 글이 빠졌을 수 있다 */
  list(query: string, opts: SearchOpts): Promise<{ refs: DocRef[]; partial: boolean }>;
  /** 읽기 전에 한 번 부른다: 열린 글의 대기 중인 편집을 저장한다 */
  prepare(): Promise<void>;
  /** token 은 write 가 충돌을 알아채는 데 쓴다(서버 mtime, 스탠드얼론은 읽은 레코드) */
  read(ref: DocRef): Promise<{ content: string; token: unknown }>;
  /** 읽은 뒤 바뀌었으면(충돌) 던진다 */
  write(ref: DocRef, content: string, token: unknown): Promise<void>;
  /** '바꾸기 전' 이름의 버전을 이력에 남긴다. 실패하면 던진다(그 글은 바꾸지 않는다) */
  snapshot(ref: DocRef, content: string): Promise<void>;
  /** 글이 열려 있으면 에디터가 새 내용을 다시 읽게 한다(열려 있지 않으면 아무것도 안 한다) */
  reloadOpen(ref: DocRef): Promise<void>;
}

export interface Preview { files: number; count: number; partial: boolean; error?: string }

// 확인창에 보일 대상 계산: 아무것도 쓰지 않는다. 읽지 못한 글은 건너뛴다(적용 때 다시 시도하고 실패로 센다).
export async function previewReplace(host: ReplaceHost, query: string, opts: SearchOpts, replacement: string): Promise<Preview> {
  await host.prepare();
  const { refs, partial } = await host.list(query, opts);
  let files = 0;
  let count = 0;
  for (const ref of refs) {
    let content: string;
    try { content = (await host.read(ref)).content; } catch { continue; }
    const r = replaceInMarkdown(content, query, opts, replacement);
    if (r.error) return { files: 0, count: 0, partial, error: r.error };
    if (r.count) { files++; count += r.count; }
  }
  return { files, count, partial };
}

export interface ReplaceOutcome {
  files: number; // 바꾼 글
  replaced: number; // 바꾼 곳
  failed: { ref: DocRef; error: string }[];
  reloadFailed: DocRef[]; // 저장은 됐지만 열린 글을 다시 읽지 못했다
  partial: boolean;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// 글마다: 읽기 → 치환 → 이력에 '바꾸기 전' 남기기 → 저장. 글 하나가 실패해도 나머지는 계속한다.
export async function replaceEverywhere(host: ReplaceHost, query: string, opts: SearchOpts, replacement: string): Promise<ReplaceOutcome> {
  await host.prepare();
  const { refs, partial } = await host.list(query, opts);
  const out: ReplaceOutcome = { files: 0, replaced: 0, failed: [], reloadFailed: [], partial };
  for (const ref of refs) {
    let wrote = false;
    try {
      const { content, token } = await host.read(ref);
      const r = replaceInMarkdown(content, query, opts, replacement);
      if (r.error) throw new Error(r.error);
      if (!r.count) continue;
      await host.snapshot(ref, content); // 이력에 못 남기면 쓰지 않는다(되돌릴 길이 없어진다)
      await host.write(ref, r.text, token);
      wrote = true;
      out.files++;
      out.replaced += r.count;
      await host.reloadOpen(ref);
    } catch (e) {
      if (wrote) out.reloadFailed.push(ref);
      else out.failed.push({ ref, error: msg(e) });
    }
  }
  return out;
}

// 결과 안내 문구(토스트)
export function outcomeText(o: ReplaceOutcome): { text: string; kind: 'info' | 'error' } {
  let text = `글 ${o.files}개에서 ${o.replaced}곳을 바꿨습니다`;
  if (o.failed.length) text += `. 글 ${o.failed.length}개는 바꾸지 못했습니다`;
  if (o.reloadFailed.length) text += '. 열린 글은 편집 중이라 다시 읽지 못했습니다';
  if (o.partial) text += '. 검색 결과가 많아 일부 글만 바꿨을 수 있으니 다시 실행해 주세요';
  return { text, kind: o.failed.length || o.reloadFailed.length ? 'error' : 'info' };
}
