import type { IncomingMessage, ServerResponse } from 'node:http';
export function isWindowsReserved(segment: string): boolean;
export const TRASH_KEEP_MS: number;
export function backupTime(name: string, mtime?: number): number;
export function backupsToDelete(items: { name: string; time: number }[], now: number, opts?: { keepRecent?: number }): string[];
export function createApi(root: string, opts?: { templatesDir?: string; allowedHosts?: string[]; now?: () => number }): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
