/**
 * 판정 규칙. 에디터 플레이 테스트와 향후 Unity 구현이 같은 기준을 참고하도록 한 곳에 둔다. (원본 judge.py)
 * - 단타: 시간 차이로 Perfect / Great / Good, 벗어나면 Miss
 * - 롱노트: 첫 터치의 등급이 노트 전체의 등급. 끝까지 누르고 있으면 성공, 중간에 떼면 Miss. 끝에서 떼는 타이밍은 판정하지 않는다.
 * - 연타노트: 구간 안에서 어느 쪽 키든 누른 횟수를 합쳐 count회 이상이면 성공(clear), 모자라면 Miss.
 * 등급 폭은 config\judge.json 에서 읽는다.
 */
import { loadJudgeConfig } from './config.ts';
import type { JudgeConfig } from './config.ts';

export const PERFECT = 'perfect';
export const GREAT = 'great';
export const GOOD = 'good';
export const MISS = 'miss';
export const CLEAR = 'clear';

export interface JudgeResult {
  result: string; // perfect / great / good / clear / miss
  success: boolean;
  reason: string; // 한국어 설명
  diff_ms: number | null; // 첫 터치와 노트 시간의 차이(있을 때)
  touches: number | null; // 연타노트에서 구간 안 터치 횟수
}

function makeResult(
  r: string,
  success: boolean,
  reason = '',
  diffMs: number | null = null,
  touches: number | null = null,
): JudgeResult {
  return { result: r, success, reason, diff_ms: diffMs, touches };
}

/** 시간 차이(ms, 부호 무관)에 해당하는 등급. 허용 범위 밖이면 null. */
export function gradeForDiff(diffMs: number, cfg: JudgeConfig = loadJudgeConfig()): string | null {
  const d = Math.abs(diffMs);
  if (d <= cfg.perfect_ms) return PERFECT;
  if (d <= cfg.great_ms) return GREAT;
  if (d <= cfg.good_ms) return GOOD;
  return null;
}

/** 단타 판정. pressMs가 null이면 터치하지 못한 것(Miss). */
export function judgeTap(noteMs: number, pressMs: number | null, cfg: JudgeConfig = loadJudgeConfig()): JudgeResult {
  if (pressMs === null) return makeResult(MISS, false, '터치하지 않았습니다.');
  const diff = pressMs - noteMs;
  const grade = gradeForDiff(diff, cfg);
  if (grade === null) return makeResult(MISS, false, '타이밍이 너무 벗어났습니다.', diff);
  return makeResult(grade, true, '', diff);
}

/**
 * 롱노트 판정.
 * pressMs: 첫 터치 시간(없으면 null). releaseMs: 손을 뗀 시간(끝까지 누르고 있었으면 null).
 */
export function judgeHold(
  noteMs: number,
  lengthMs: number,
  pressMs: number | null,
  releaseMs: number | null,
  cfg: JudgeConfig = loadJudgeConfig(),
): JudgeResult {
  if (pressMs === null) return makeResult(MISS, false, '터치하지 않았습니다.');
  const diff = pressMs - noteMs;
  const grade = gradeForDiff(diff, cfg);
  if (grade === null) return makeResult(MISS, false, '시작 타이밍이 너무 벗어났습니다.', diff);
  const endMs = noteMs + lengthMs;
  if (releaseMs !== null && releaseMs < endMs - cfg.hold_end_tolerance_ms) {
    return makeResult(MISS, false, '끝까지 누르지 않고 중간에 손을 뗐습니다.', diff);
  }
  return makeResult(grade, true, '첫 터치 등급이 노트 전체 등급입니다.', diff);
}

/** 연타노트 판정. 구간은 [start, start+length]. pressTimes는 배열 또는 {레인: 배열}(모두 합산). */
export function judgeBurst(
  startMs: number,
  lengthMs: number,
  pressTimes: number[] | Record<string, number[]>,
  count: number,
): JudgeResult {
  const times = Array.isArray(pressTimes) ? pressTimes : Object.values(pressTimes).flat();
  const endMs = startMs + lengthMs;
  const touches = times.filter((t) => startMs <= t && t <= endMs).length;
  if (touches >= count) return makeResult(CLEAR, true, `연타 성공 (${touches}회 / 필요 ${count}회)`, null, touches);
  return makeResult(MISS, false, `연타 횟수가 모자랍니다 (${touches}회 / 필요 ${count}회)`, null, touches);
}

/** 계약 함수 `judge`: 단타·롱노트는 이 함수 하나로 판정한다(연타는 judgeBurst). */
export function judge(
  type: 'tap' | 'hold',
  noteMs: number,
  lengthMs: number,
  pressMs: number | null,
  releaseMs: number | null,
  cfg: JudgeConfig = loadJudgeConfig(),
): JudgeResult {
  return type === 'tap' ? judgeTap(noteMs, pressMs, cfg) : judgeHold(noteMs, lengthMs, pressMs, releaseMs, cfg);
}
