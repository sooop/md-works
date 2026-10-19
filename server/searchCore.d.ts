export const MAX_QUERY: number;
export interface SearchOpts { caseSensitive?: boolean; regex?: boolean }
export interface LineMatch { line: number; text: string; ranges: [number, number][]; nth: number }
export function buildMatcher(query: string, opts?: SearchOpts): { re: RegExp; error?: undefined } | { error: string; re?: undefined };
export function searchText(text: string, re: RegExp, opts?: { maxMatches?: number; window?: number }): { matches: LineMatch[]; truncated: boolean };
