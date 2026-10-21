// 코드 블록 언어 선택기의 키보드 조작 보완. Milkdown 기본은 항목이 Tab 으로만 이동되고, 검색 입력에서 방향키·Enter 가 없으며,
// 항목에서 Enter 로 고르면 언어는 바뀌어도 목록이 닫히지 않는다.
//   검색 입력: ↓ 첫 항목으로 · Enter 입력한 글자에 맞는 첫 언어 선택 · Esc 닫기
//   항목:      ↑↓ 이동(맨 위에서 ↑ 는 검색 입력으로) · Enter 선택 · Esc 닫기
// 고른 언어는 noteLanguage 로 기억해 최근 5개를 목록 위에 둔다.
import { noteLanguage } from './codeLanguages';

const ITEMS = '.language-picker .language-list-item[data-language]';

const items = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>(ITEMS)];

/** 입력한 글자에 맞는 첫 항목. 현재 언어는 맞지 않아도 맨 앞에 끼므로 건너뛴다 */
function firstMatch(root: ParentNode): HTMLElement | undefined {
  const list = items(root);
  return list.find((li) => li.getAttribute('aria-selected') !== 'true') ?? list[0];
}

function mark(root: ParentNode, filter: string) {
  root.querySelectorAll('.kb-target').forEach((e) => e.classList.remove('kb-target'));
  if (filter) firstMatch(root)?.classList.add('kb-target');
}

export function attachCodePicker(host: HTMLElement): () => void {
  const closePicker = (from: HTMLElement) => {
    const wrap = from.closest('.milkdown-code-block, .code-block') ?? host;
    wrap.querySelector<HTMLButtonElement>('.language-button[data-expanded="true"]')?.click();
  };

  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const input = t.closest<HTMLInputElement>('.language-picker .search-input');
    const item = t.closest<HTMLElement>('.language-picker .language-list-item');
    if (!input && !item) return;
    const done = () => { e.preventDefault(); e.stopPropagation(); };
    const root = (input ?? item)!.closest('.language-picker') ?? host;
    if (e.key === 'Escape') { done(); closePicker(t); return; }
    if (input) {
      if (e.key === 'ArrowDown') { done(); firstMatchOrFirst(root)?.focus(); }
      else if (e.key === 'Enter' && input.value.trim()) { done(); firstMatch(root)?.click(); }
      return;
    }
    const list = items(root);
    const i = list.indexOf(item!);
    if (e.key === 'ArrowDown') { done(); list[Math.min(i + 1, list.length - 1)]?.focus(); }
    else if (e.key === 'ArrowUp') { done(); if (i <= 0) root.querySelector<HTMLInputElement>('.search-input')?.focus(); else list[i - 1].focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { done(); item!.click(); }
  };
  const firstMatchOrFirst = (root: ParentNode) => {
    const input = root.querySelector<HTMLInputElement>('.search-input');
    return input?.value.trim() ? firstMatch(root) : items(root)[0];
  };

  // 입력이 바뀔 때마다 Enter 로 선택될 항목을 표시한다(다시 그려진 뒤에)
  const onInput = (e: Event) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('.language-picker .search-input');
    if (!input) return;
    const root = input.closest('.language-picker');
    if (root) requestAnimationFrame(() => mark(root, input.value.trim()));
  };

  // 목록에서 고른 언어를 기억한다(키보드 선택도 click() 으로 들어온다)
  const onClick = (e: MouseEvent) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>(ITEMS);
    if (li?.dataset.language) noteLanguage(li.dataset.language);
  };

  host.addEventListener('click', onClick, true);
  host.addEventListener('keydown', onKey, true);
  host.addEventListener('input', onInput, true);
  return () => {
    host.removeEventListener('click', onClick, true);
    host.removeEventListener('keydown', onKey, true);
    host.removeEventListener('input', onInput, true);
  };
}
