// ─── Code Together Collaborative IDE Types ───

export type CodeLanguage =
  | 'python'
  | 'cpp'
  | 'java'
  | 'javascript'
  | 'typescript'
  | 'go'
  | 'rust'
  | 'sql';

export interface CodeCursor {
  peerId: string;
  nickname: string;
  color: string;
  line: number;
  ch: number;
  lastActive: number;
}

export interface CodeExecutionResult {
  stdout: string;
  stderr?: string;
  executionTimeMs: number;
  status: 'idle' | 'running' | 'success' | 'error' | 'timeout';
  executedAt?: number;
}

export interface CodeSessionState {
  code: string;
  language: CodeLanguage;
  version: number;
  lastEditedBy: string;
  lastEditedAt: number;
  activeCursors: CodeCursor[];
  isRunning: boolean;
  lastResult: CodeExecutionResult | null;
}

export interface CodeTemplate {
  name: string;
  problemTitle?: string;
  languages: Record<CodeLanguage, string>;
}
