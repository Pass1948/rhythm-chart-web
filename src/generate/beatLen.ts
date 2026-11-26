/**
 * [04e] 그 위치(tick)의 한 박 길이(ms). 변속(BPM 구간이 여러 개) 곡에서는 구간마다 다르다.
 * BPM 구간이 하나뿐이면 예전 계산(`tickToMs(960) - tickToMs(0)`)과 정확히 같은 값이다.
 */
import { RESOLUTION } from '../core/schema.ts';
import type { BpmMap } from '../core/timing.ts';

export function beatMsAt(bpmMap: BpmMap, tick: number): number {
  return bpmMap.msPerTick(bpmMap.indexByTick(Math.max(0, tick))) * RESOLUTION;
}

/** noteTypes 가 쓰던 `60000 / bpm` 방식 (구간별). 구간이 하나면 예전 값과 같다. */
export function beatMsByBpm(bpmMap: BpmMap, tick: number): number {
  return 60000.0 / bpmMap.entryAt(Math.max(0, tick)).bpm;
}
