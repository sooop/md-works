import type { IncomingMessage, ServerResponse } from 'node:http';
export function isWindowsReserved(segment: string): boolean;
export function createApi(root: string, opts?: { templatesDir?: string; allowedHosts?: string[] }): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
