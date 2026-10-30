// 폴더 우클릭 → 내보내기: 호스트에서 만들어 파일로 내려받고 결과를 토스트로 알린다
import { bundleHost } from './bundle/host';
import { exportFolderJson, exportFolderLinked, exportFolderZip, folderLeaf } from './folderExport';
import { downloadBlob, sanitizeName } from './utils';
import { toast } from './store.svelte';
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
