// 표 확대 보기 모달이 보여 줄 표(null 이면 닫힘)
import type { TableData } from './tableTools';

export const tableViewer = $state<{ table: TableData | null }>({ table: null });
