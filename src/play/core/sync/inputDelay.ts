// 손 싱크 계산(순수 함수): 박자음에 맞춰 누른 시각들로 "권장 입력 지연 보정값"을 구한다.
// D:\MusicNoteDesignProgram 의 [지연 측정]과 같은 방식: 연습 구간 제외 → 튀는 값 제거 → 평균.
// 부호: 박자보다 늦게 눌렀으면 + (입력 지연 보정은 "키를 늦게 누르는 느낌이면 + 값").

export interface InputDelayOptions {
  /** 앞에서 계산에서 빼는 박자 수 (연습) */
  practiceCount: number;
  /** 중앙값에서 이 값(ms)을 넘게 벗어난 입력은 튀는 값으로 거른다 */
  outlierMs: number;
  /** 튀는 값을 거른 뒤 남아야 하는 최소 입력 수 */
  minValidCount: number;
  /** 권장값을 이 범위 안으로 맞춘다 */
  minMs: number;
  maxMs: number;
}

export type InputDelayResult =
  | {
      ok: true;
      /** 권장 입력 지연 보정값 (ms, 정수) */
      recommendedMs: number;
      /** 평균에 쓴 입력 수 */
      usedCount: number;
      /** 튀는 값으로 거른 입력 수 */
      removedCount: number;
      /** 연습이라 뺀 입력 수 (실제로 누른 것만 센다) */
      practiceCount: number;
    }
  | { ok: false; reason: string };

/**
 * 누른 시각을 가장 가까운 박자에 짝지어 박자별 차이(ms, 누른 시각 - 박자 시각)를 만든다.
 * - pressMs: 첫 박자를 0으로 한 누른 시각들
 * - 박자 간격의 절반을 넘게 벗어난 입력, 범위 밖 박자의 입력은 버린다
 * - 한 박자에 여러 번 눌렀으면 박자에 가장 가까운 것 하나만 쓴다
 * - 결과는 박자 순서의 배열이고 누르지 않은 박자는 null
 */
export function assignPressesToBeats(pressMs: readonly number[], beatCount: number, intervalMs: number): Array<number | null> {
  const diffs: Array<number | null> = new Array<number | null>(beatCount).fill(null);
  for (const press of pressMs) {
    const index = Math.round(press / intervalMs);
    if (index < 0 || index >= beatCount) continue;
    const diff = press - index * intervalMs;
    if (Math.abs(diff) > intervalMs / 2) continue;
    const current = diffs[index];
    if (current === null || current === undefined || Math.abs(diff) < Math.abs(current)) diffs[index] = diff;
  }
  return diffs;
}

/** 중앙값 (값이 짝수 개면 가운데 두 값의 평균). 빈 배열이면 0 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * 박자별 차이로 권장 입력 지연 보정값을 계산한다.
 * diffs: 박자 순서의 차이(ms). 누르지 않은 박자는 null
 */
export function calcRecommendedDelay(diffs: ReadonlyArray<number | null>, options: InputDelayOptions): InputDelayResult {
  const counted = diffs.slice(options.practiceCount).filter((value): value is number => value !== null);
  const practicePressed = diffs.slice(0, options.practiceCount).filter((value) => value !== null).length;

  if (counted.length < options.minValidCount) {
    return {
      ok: false,
      reason: `박자에 맞춰 누른 횟수가 너무 적어요. 연습을 뺀 ${counted.length}번만 확인됐어요. 소리에 맞춰 ${options.minValidCount}번 이상 눌러 주세요.`,
    };
  }

  const center = median(counted);
  const kept = counted.filter((value) => Math.abs(value - center) <= options.outlierMs);
  if (kept.length < options.minValidCount) {
    return { ok: false, reason: '누른 타이밍이 너무 들쭉날쭉해서 계산할 수 없어요. 박자음에 집중해서 다시 해 주세요.' };
  }

  const mean = kept.reduce((sum, value) => sum + value, 0) / kept.length;
  const recommendedMs = Math.min(options.maxMs, Math.max(options.minMs, Math.round(mean)));
  return { ok: true, recommendedMs, usedCount: kept.length, removedCount: counted.length - kept.length, practiceCount: practicePressed };
}
