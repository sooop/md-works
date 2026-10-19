import type { IncomingMessage, ServerResponse } from 'node:http';
export function createApi(root: string, opts?: { templatesDir?: string }): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
