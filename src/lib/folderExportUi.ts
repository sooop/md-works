// 폴더 우클릭 → 내보내기: 호스트에서 만들어 파일로 내려받고 결과를 토스트로 알린다
import { bundleHost } from './bundle/host';
import {
  exportFolderJson, exportFolderLinked, exportFolderZip, folderLeaf, exportRootsJson, exportRootsLinked, exportRootsZip, selectionFileName, type ExportRoot,
} from './folderExport';
import { downloadBlob, sanitizeName } from './utils';
import { toast, withStatus } from './store.svelte';
import type { DocNode } from './docTree';

export type FolderExportKind = 'json' | 'zip' | 'md';

/** 폴더 노드를 화면 순서대로 깊이 우선으로 훑어 host 글 이름의 순서를 만든다(host 이름 = 폴더경로/파일명) */
export function treeOrder(node: DocNode): string[] {
  const out: string[] = [];
  const walk = (dir: DocNode) => {
    for (const c of dir.children ?? []) {
      if (c.type === 'dir') walk(c);
      else out.push(`${dir.path}/${c.name}`);
    }
  };
  walk(node);
  return out;
}

export async function exportFolder(kind: FolderExportKind, node: DocNode): Promise<void> {
  try {
    const host = bundleHost();
    const base = sanitizeName(folderLeaf(node.path)) || 'folder';
    if (kind === 'json') {
      const { text, count } = await exportFolderJson(host, node.path);
      if (!count) return void toast('내보낼 글이 없습니다');
      downloadBlob(`${base}.json`, new Blob([text], { type: 'application/json;charset=utf-8' }));
      toast(`${count}개 글을 내보냈습니다`);
    } else if (kind === 'zip') {
      const { bytes, count } = await exportFolderZip(host, node.path);
      if (!count) return void toast('내보낼 글이 없습니다');
      downloadBlob(`${base}.zip`, new Blob([bytes as BlobPart], { type: 'application/zip' }));
      toast(`${count}개 글을 내보냈습니다`);
    } else {
      const { text, count } = await exportFolderLinked(host, node.path, treeOrder(node));
      if (!count) return void toast('내보낼 글이 없습니다');
      downloadBlob(`${base}.md`, new Blob([text], { type: 'text/markdown;charset=utf-8' }));
      toast(`${count}개 글을 내보냈습니다`);
    }
  } catch (e) {
    toast(`내보내기 실패: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

export interface SelectionExportOpts {
  /** 노드 → host 글 이름(글은 .md 를 포함한 경로, 폴더는 폴더 경로). 서버는 node.path 가 그대로 host 이름이라 생략한다. 스탠드얼론은 글의 키가 id 라 넘겨야 한다 */
  hostName?: (node: DocNode) => string;
}

/**
 * 선택한 글·폴더(여러 뿌리)를 하나의 파일로 내려받는다. 폴더 구조와 이미지는 공통 상위 폴더 기준으로 유지한다.
 * 파일 이름: 뿌리가 하나면 그 이름(글 하나의 'md' 는 글 이름 그대로, 본문만·이미지는 Base64), 여럿이면 md-works-선택-YYYYMMDD-HHmm.확장자
 */
export async function exportSelection(kind: FolderExportKind, nodes: DocNode[], opts: SelectionExportOpts = {}): Promise<void> {
  if (!nodes.length) return;
  const nameOf = opts.hostName ?? ((n: DocNode) => n.path);
  const roots: ExportRoot[] = nodes.map((n) => ({ path: nameOf(n), type: n.type }));
  const single = nodes.length === 1 ? nodes[0] : null;
  // 파일 이름의 뼈대(확장자 제외)
  const stem = single ? sanitizeName(single.type === 'file' ? single.name.replace(/\.md$/i, '') : folderLeaf(single.path)) || 'export' : '';
  const fname = (ext: string) => (single ? `${stem}.${ext}` : selectionFileName(ext));
  try {
    await withStatus('내려받을 파일을 만드는 중…', async () => {
      const host = bundleHost();
      if (kind === 'json') {
        const { text, count } = await exportRootsJson(host, roots);
        if (!count) return void toast('내보낼 글이 없습니다');
        downloadBlob(fname('json'), new Blob([text], { type: 'application/json;charset=utf-8' }));
        toast(`${count}개 글을 내보냈습니다`);
      } else if (kind === 'zip') {
        const { bytes, count } = await exportRootsZip(host, roots);
        if (!count) return void toast('내보낼 글이 없습니다');
        downloadBlob(fname('zip'), new Blob([bytes as BlobPart], { type: 'application/zip' }));
        toast(`${count}개 글을 내보냈습니다`);
      } else {
        // 연결된 MD 의 순서: 선택한 순서(트리 순서)대로, 폴더는 안의 글을 화면 순서대로
        const order = nodes.flatMap((n, i) => (n.type === 'file' ? [roots[i].path] : treeOrder(n)));
        const { text, count } = await exportRootsLinked(host, roots, order);
        if (!count) return void toast('내보낼 글이 없습니다');
        const mdName = single?.type === 'file' ? (/\.md$/i.test(single.name) ? single.name : `${single.name}.md`) : fname('md');
        downloadBlob(mdName, new Blob([text], { type: 'text/markdown;charset=utf-8' }));
        toast(`${count}개 글을 내보냈습니다`);
      }
    });
  } catch (e) {
    toast(`내보내기 실패: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}
