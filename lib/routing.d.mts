export const CAPABILITIES: string[];
export function validateAnalysis(value: any, catalog: any[]): any;
export function selectRoute(analysis: any, catalog: any[], profiles: Record<string, { tier: number; capabilities: string[] }>, forecasts: any[]): any;
export function escalationDecision(task: any, catalog: any[], profiles: Record<string, { tier: number; capabilities: string[] }>, enabled?: boolean): any;
