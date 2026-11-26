/**
 * 분석 모드 등록소: 01b가 `src\analysis\modes\` 안에서 드럼·멜로디·보컬 같은 새 분석 방식을 '등록'만 하면
 * `analyzeAudio` 가 그 방식을 쓸 수 있다. (01b가 analyze.ts 를 고치지 않아도 되게 01a가 만들어 둔 자리)
 */
import type { Features } from './detect.ts';
import type { AnalyzeOptions, Candidate, DetectorId, ProgressFn } from './types.ts';

/** 모드가 받는 재료: 소리, 이미 계산된 기본 특징값, 사용자 옵션 */
export interface ModeContext {
  samples: Float32Array;
  features: Features;
  options: AnalyzeOptions;
  report: ProgressFn;
  signal?: AbortSignal;
}

/** 모드 함수: 노트 후보 목록(시간순)을 돌려준다. 안내할 말이 있으면 warnings 에 쉬운 한국어로 넣는다. */
export type ModeFn = (ctx: ModeContext) => Candidate[] | { candidates: Candidate[]; warnings?: string[] } | Promise<Candidate[] | { candidates: Candidate[]; warnings?: string[] }>;

const registry = new Map<string, ModeFn>();

/** 새 분석 모드를 등록한다(같은 이름이면 덮어쓴다). */
export function registerMode(id: DetectorId, fn: ModeFn): void {
  registry.set(id, fn);
}

/** 등록된 모드 함수(없으면 undefined). */
export function getMode(id: string): ModeFn | undefined {
  return registry.get(id);
}

/** 지금 등록된 모드 이름 목록 */
export function registeredModes(): string[] {
  return [...registry.keys()];
}
