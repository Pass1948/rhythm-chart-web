// [싱크 맞추기] 계산(순수 함수, Node 로 테스트). 08단계.
// 60BPM(1초에 한 번) 박자 소리를 16번 들려주고 사용자가 소리에 맞춰 누른 시각과 박자 시각의 차이(ms, +면 늦게 누름)를 모은다.
// 처음 4번은 버리고 나머지의 중앙값을 입력 보정값으로 제안한다. 흩어짐(사분위 범위)이 크면 다시 하도록 안내한다.

/** 수치(한 곳) */
export const SYNC_CONFIG = {
  bpm: 60,
  /** 들려주는 박 수 */
  beats: 16,
  /** 계산에서 빼는 처음 박 수 */
  skip: 4,
  /** 첫 박까지 기다리는 시간(초) */
  leadSec: 1.4,
  /** 이 사분위 범위(ms)보다 흩어지면 "고르지 않습니다" */
  maxIqrMs: 60,
  /** 계산에 쓸 누름이 이보다 적으면 다시 하도록 안내 */
  minUsed: 6,
  /** 입력 보정 범위(ms) */
  min: -500,
  max: 500,
} as const;

/** 박 사이 간격(초) */
export const BEAT_INTERVAL_SEC = 60 / SYNC_CONFIG.bpm;

/** 박자 시각들(AudioContext 시간, 초) */
export function beatTimes(firstBeatSec: number, beats: number = SYNC_CONFIG.beats): number[] {
  return Array.from({ length: beats }, (_, i) => firstBeatSec + i * BEAT_INTERVAL_SEC);
}

/** 누름 하나를 가장 가까운 박에 붙인다. 박 범위 밖(첫 박 한 칸 전 ~ 끝 박 한 칸 뒤)이면 null */
export function matchPress(heardSec: number, firstBeatSec: number, beats: number = SYNC_CONFIG.beats): { index: number; offsetMs: number } | null {
  const index = Math.round((heardSec - firstBeatSec) / BEAT_INTERVAL_SEC);
  if (index < 0 || index >= beats) return null;
  return { index, offsetMs: (heardSec - firstBeatSec - index * BEAT_INTERVAL_SEC) * 1000 };
}

/** 값 목록에서 분위수(0~1, 선형 보간) */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * 한 박 간격(1000ms) 주기로 돌려 읽은 값들을 한 덩어리로 모아 준다.
 * 박 사이 한가운데(±500ms 근처)에 몰린 값이 서로 반대쪽 끝으로 갈라지지 않게, 원형 평균 방향을 기준으로 다시 감는다.
 */
export function recenter(offsetsMs: readonly number[], periodMs: number = BEAT_INTERVAL_SEC * 1000): number[] {
  if (offsetsMs.length === 0) return [];
  let sx = 0;
  let sy = 0;
  for (const v of offsetsMs) {
    const a = (v / periodMs) * Math.PI * 2;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  const center = (Math.atan2(sy, sx) / (Math.PI * 2)) * periodMs;
  return offsetsMs.map((v) => {
    let d = v - center;
    d -= Math.round(d / periodMs) * periodMs;
    return center + d;
  });
}

/** 계산 결과 */
export interface CalibrationResult {
  ok: boolean;
  /** 제안하는 입력 보정(ms, 정수, 범위 안). ok 가 아니면 null */
  suggestionMs: number | null;
  /** 계산에 쓴 누름 수 */
  used: number;
  /** 사분위 범위(ms) */
  iqrMs: number;
  /** 사용자에게 보여 줄 한 줄 안내 */
  message: string;
}

/**
 * 박마다 모은 차이(누르지 않았으면 null)로 보정값을 제안한다.
 * 처음 skip 박은 버리고, 쓸 수 있는 누름이 minUsed 보다 적거나 흩어짐이 크면 ok:false.
 */
export function computeCalibration(offsetsByBeat: ReadonlyArray<number | null>): CalibrationResult {
  const used: number[] = [];
  for (let i = SYNC_CONFIG.skip; i < offsetsByBeat.length; i++) {
    const v = offsetsByBeat[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) used.push(v);
  }
  if (used.length < SYNC_CONFIG.minUsed) {
    return { ok: false, suggestionMs: null, used: used.length, iqrMs: 0, message: `누른 횟수가 적습니다(${used.length}번). 소리에 맞춰 끝까지 눌러 다시 해 보세요.` };
  }
  const sorted = recenter(used).sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  if (iqr > SYNC_CONFIG.maxIqrMs) {
    return { ok: false, suggestionMs: null, used: used.length, iqrMs: Math.round(iqr), message: '고르지 않습니다. 다시 해 보세요.' };
  }
  const suggestion = Math.max(SYNC_CONFIG.min, Math.min(SYNC_CONFIG.max, Math.round(median)));
  return { ok: true, suggestionMs: suggestion, used: used.length, iqrMs: Math.round(iqr), message: `${used.length}번 중앙값 ${suggestion > 0 ? '+' : ''}${suggestion}ms` };
}

/** 보정값을 범위 안의 정수로 맞춘다. 숫자가 아니면 fallback */
export function clampDelayMs(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(SYNC_CONFIG.min, Math.min(SYNC_CONFIG.max, Math.round(value)));
}

/** 최근 판정 평균(ms): 느림이 +. 비어 있으면 null */
export function recentMeanMs(deltas: readonly number[]): number | null {
  if (deltas.length === 0) return null;
  return deltas.reduce((a, b) => a + b, 0) / deltas.length;
}
