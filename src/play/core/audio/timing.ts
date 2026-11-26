// 시간 변환(순수 계산): AudioContext 시간과 곡 시간(채보 기준 ms) 사이를 바꾼다. 보정값은 설정에서 받는다.
import type { GameConfig } from '../config/gameConfig';

export type TimingConfig = GameConfig['timing'];

const MS_PER_SEC = 1000;

/**
 * AudioContext 시간(초)을 곡 시간(ms)으로 바꾼다.
 * startContextSec : 음원 재생을 시작한 AudioContext 시간(초)
 * 음원 시작 보정이 + 이면 음원이 채보보다 늦게 나오는 것이므로 곡 시간이 그만큼 작아진다.
 */
export function contextTimeToSongMs(contextTimeSec: number, startContextSec: number, timing: TimingConfig): number {
  return (contextTimeSec - startContextSec) * MS_PER_SEC - timing.audioStartOffsetMs;
}

/** 곡 시간(ms)을 AudioContext 시간(초)으로 바꾼다. (박자 클릭음 등을 미리 예약할 때 사용) */
export function songMsToContextTime(songMs: number, startContextSec: number, timing: TimingConfig): number {
  return startContextSec + (songMs + timing.audioStartOffsetMs) / MS_PER_SEC;
}

/** 입력이 들어온 곡 시간에 입력 지연 보정을 적용한다. 늦게 누르는 느낌이면(+) 그만큼 앞당겨 판정한다. */
export function applyInputDelay(rawSongMs: number, timing: TimingConfig): number {
  return rawSongMs - timing.inputDelayMs;
}
