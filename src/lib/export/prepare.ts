import { flattenWikiLinks } from '../wikilink/parse';

// 내보내기(docx·HTML·EPUB) 변환 직전 전처리 한 곳.
// 글 사이 링크 `[[글 이름|표시]]` 는 앱 밖에서는 대괄호 글자로만 보이므로 표시 글자로 풀어 준다(코드 안은 그대로).
export function prepareExportMarkdown(md: string): string {
  return flattenWikiLinks(md);
}
