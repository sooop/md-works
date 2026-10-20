// 두 모드가 공유하는 가져오기/내보내기 흐름 (.md/.txt 및 pandoc 이 읽는 형식 가져오기, markdown → docx 내려받기)
import { ensurePandoc } from './pandoc/client';
import { docxToMarkdown, importToMarkdown, markdownToDocx, swapExt } from './pandoc/docx';
import { pandocFormatOf } from './pandoc/importFormats';
import { status, toast, withStatus } from './store.svelte';
import { downloadBlob, stripExt } from './utils';

export interface ImportedDoc {
  /** 확장자가 .md 인 문서 이름 */
  name: string;
  content: string;
  /** pandoc 변환을 거쳤는지 (본문에 Base64 이미지가 들어 있을 수 있다) */
  converted: boolean;
}

export const isDocxFile = (f: File) => /\.docx$/i.test(f.name);
export const isTextDocFile = (f: File) => /\.(md|markdown|txt)$/i.test(f.name) || f.type === 'text/markdown';
export const isPandocFile = (f: File) => !!pandocFormatOf(f.name);
export const isImportable = (f: File) => isTextDocFile(f) || isPandocFile(f);

// pandoc 엔진 준비(스탠드얼론은 첫 사용 때 내려받기)를 진행 표시와 함께 기다린다
async function prepareEngine(set: (t: string) => void) {
  await ensurePandoc((p) => {
    set(`pandoc 엔진을 내려받는 중… ${Math.min(99, Math.round((p.loaded / p.total) * 100))}%`);
  });
  set('변환하는 중…');
}

export async function readImport(file: File): Promise<ImportedDoc> {
  const stem = stripExt(file.name) || '새 문서';
  const fmt = pandocFormatOf(file.name);
  if (!fmt) {
    return { name: `${stem}.md`, content: await file.text(), converted: false };
  }
  return withStatus('pandoc 엔진을 준비하는 중…', async (set) => {
    await prepareEngine(set);
    const r = fmt.from === 'docx' ? await docxToMarkdown(file) : await importToMarkdown(file, fmt.from);
    if (r.skippedImageCount > 0) toast(`브라우저가 표시할 수 없는 이미지 ${r.skippedImageCount}개는 제외했습니다`);
    return { name: `${stem}.md`, content: r.markdown, converted: true };
  });
}

// markdown → docx 로 변환해 내려받는다. 이미지는 호출 전에 data URI 로 바뀌어 있어야 한다.
export async function exportDocx(markdown: string, docName: string, template: Blob | null) {
  await withStatus('pandoc 엔진을 준비하는 중…', async (set) => {
    await prepareEngine(set);
    const { blob, warningCount } = await markdownToDocx(markdown, template);
    downloadBlob(swapExt(docName, 'docx'), blob);
    if (warningCount > 0) console.info(`pandoc 경고 ${warningCount}건`);
  });
  toast('DOCX 파일을 내려받았습니다');
}

export { status };
