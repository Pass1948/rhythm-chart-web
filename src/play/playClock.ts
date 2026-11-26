// 재생 시계 계산(순수 함수): 곡 시간(ms) ↔ AudioContext 시간(초), 재생 속도(rate)·시작 위치(startMs)·입력 지연 보정.
// 브라우저 코드가 없어서 Node 로 자동 테스트한다. 곡 시간은 "음원 0ms = 채보 0ms" 기준이다.

/** 재생 속도의 허용 범위 (계약 6번) */
export const RATE_MIN = 0.5;
export const RATE_MAX = 1.25;

/** 재생 속도를 허용 범위 안으로 맞춘다. 숫자가 아니면 1 */
export function clampRate(rate: number | undefined): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return 1;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, rate));
}

/**
 * AudioContext 시간(초)을 곡 시간(ms)으로 바꾼다.
 * zeroContextSec : 음원 위치 0 이 재생되었을 AudioContext 시간(초)
 * 재생 속도가 rate 이면 같은 실제 시간 동안 곡이 rate 배 흘러간다.
 */
export function songMsFromContext(contextSec: number, zeroContextSec: number, rate: number, audioStartOffsetMs: number): number {
  return (contextSec - zeroContextSec) * 1000 * rate - audioStartOffsetMs;
}

/** 재생 시작 계획 */
export interface StartPlan {
  /** 소리가 실제로 시작되는 AudioContext 시간(초) */
  startContextSec: number;
  /** 음원 안에서 재생을 시작할 위치(초). 곡 시작 전(음수)이면 0 */
  bufferOffsetSec: number;
  /** 음원 위치 0 이 재생되었을(될) AudioContext 시간(초) — 곡 시간 변환의 기준 */
  zeroContextSec: number;
}

/**
 * 곡 시간 songMs 부터 재생을 시작하는 계획을 세운다.
 * 곡 시간이 음수(곡 시작 전)이면 그만큼(실제 시간으로는 rate 로 나눈 만큼) 조용히 기다렸다가 처음부터 재생한다.
 */
export function planStart(songMs: number, rate: number, audioStartOffsetMs: number, nowContextSec: number, leadSec: number): StartPlan {
  const bufferMs = songMs + audioStartOffsetMs;
  const bufferOffsetSec = Math.max(0, bufferMs / 1000);
  const waitSec = Math.max(0, -bufferMs / 1000) / rate;
  const startContextSec = nowContextSec + leadSec + waitSec;
  return { startContextSec, bufferOffsetSec, zeroContextSec: startContextSec - bufferOffsetSec / rate };
}

/**
 * 입력 지연 보정을 적용한 곡 시간. 입력 지연은 "실제 시간(ms)"이므로 느리게(rate<1) 재생할 때는
 * 곡 시간으로는 rate 배만큼만 보정한다.
 */
export function applyInputDelayRate(rawSongMs: number, inputDelayMs: number, rate: number): number {
  return rawSongMs - inputDelayMs * rate;
}

/**
 * 플레이를 시작하는 곡 시간. 시작 위치(startMs)보다 낙하 시간만큼 먼저 시작해서
 * 시작 위치의 첫 노트들이 위에서부터 내려오게 한다. 곡 시작 전이면 음수가 된다.
 */
export function leadInStartMs(startMs: number, fallTimeMs: number): number {
  return startMs - fallTimeMs;
}

/** 플레이를 끝내는 곡 시간: 마지막 노트가 끝난 뒤 tailMs 가 지나면 끝낸다. 노트가 없으면 0 */
export function playEndMs(notes: ReadonlyArray<{ timeMs: number; durationMs: number }>, tailMs: number): number {
  let end = 0;
  for (const n of notes) end = Math.max(end, n.timeMs + n.durationMs);
  return end + tailMs;
}
