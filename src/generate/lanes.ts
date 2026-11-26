/**
 * ⑤ 레인 배분: 좌우 교대, 2개씩 교대, 강약 기반, 결정적 랜덤(+ 레퍼런스 규칙 모드용 natural) 과 겹침 정리. (원본 lanes.py)
 * 연타노트는 양쪽 레인 전체 폭의 노트(레인 값 'both')이며 구간 안에 다른 노트가 없다.
 * 롱노트가 쓰는 레인의 구간 안에 다른 노트가 있으면 반대 레인으로 옮기고, 그래도 안 되면 단타로 바꾼다.
 */
import { LANE_BOTH, RESOLUTION, makeNote } from '../core/schema.ts';
import type { ChartNote } from '../core/schema.ts';
import type { BpmMap } from '../core/timing.ts';
import { pyRound } from '../core/util.ts';
import { percentile } from '../analysis/dsp.ts';
import { PyRandom } from './pyRandom.ts';
import { naturalLanes } from './refrules.ts';
import type { NotePlan } from './types.ts';

export const LANE_MODES = ['alternate', 'pair', 'accent', 'random', 'natural'] as const; // natural 은 레퍼런스 규칙 모드 전용
/** 02단계 검증 한계(12회/초)의 80% */
export const MAX_BURST_PER_SEC = 9.6;

/** 계획 순서대로 레인(0=왼쪽, 1=오른쪽)을 정한다. 같은 입력·시드면 항상 같은 결과. */
export function assignLanes(plans: NotePlan[], mode: string, seed: number, rules: Record<string, any> | null = null): number[] {
  const rng = new PyRandom(seed);
  const n = plans.length;
  if (mode === 'alternate') return plans.map((_, i) => i % 2);
  if (mode === 'pair') return plans.map((_, i) => Math.floor(i / 2) % 2);
  if (mode === 'random') return plans.map(() => (rng.random() < 0.5 ? 0 : 1));
  if (mode === 'natural') {
    if (!rules) throw new Error('natural 레인 방식에는 규칙이 필요합니다.');
    return naturalLanes(plans, rules, seed);
  }
  if (mode === 'accent') {
    const threshold = n ? percentile(plans.map((p) => p.strength), 72) : 1.0;
    const lanes: number[] = [];
    let last = 1;
    for (let i = 0; i < n; i++) {
      const p = plans[i]!;
      let lane = p.strength >= threshold || p.tick % 960 === 0 ? 0 : 1;
      if (i > 0 && lane === last && rng.random() < 0.38) lane = 1 - lane;
      lanes.push(lane);
      last = lane;
    }
    return lanes;
  }
  throw new Error(`알 수 없는 레인 배분 방식입니다: ${mode}`);
}

export type LaneInfo = Record<string, number>;

/**
 * 계획 + 레인 → 최종 노트 목록(02단계 형식)과 처리 통계.
 * 롱노트가 시작되면 그 레인은 끝날 때까지 비워 두고, 그 사이의 노트는 반대 레인으로 옮긴다.
 * 두 레인에서 롱노트가 동시에 이어지는 것은 만들지 않는다 (뒤에 오는 롱노트를 단타로 바꿈).
 * 연타노트는 양쪽 레인을 모두 쓰므로 구간 안의 노트를 모두 비운다.
 */
export function buildNotes(
  plans: NotePlan[],
  mode: string,
  seed: number,
  burstDefaultCount: number,
  bpmMap: BpmMap,
  rules: Record<string, any> | null = null,
): [ChartNote[], LaneInfo] {
  const singles = plans.filter((p) => p.type !== 'burst');
  const singleLanes = assignLanes(singles, mode, seed, rules); // 연타노트는 건너뛰고 배분한다
  let laneIdx = 0;
  const busyUntil = [-1, -1];
  const notes: ChartNote[] = [];
  const stats: LaneInfo = { moved: 0, trimmed: 0, to_tap: 0, dropped: 0 };
  const ref = rules !== null; // 레퍼런스 규칙 모드(H6·H7·B2)
  const restTicks = ref ? Math.trunc(Number(rules.burst_rest_beats ?? 0) * RESOLUTION) : 0;
  const innerMax = ref ? Math.trunc(Number(rules.hold_inner_max ?? 0)) : null;
  const inner = new Map<number, number>(); // 진행 중인 롱노트 시작 tick → 그 안에 둔 노트 수
  let burstEnd = -1; // 마지막 연타노트가 끝나는 tick (그 구간에는 다른 노트를 두지 않는다)
  for (const p of plans) {
    if (p.type === 'burst') {
      const length = p.length_tick;
      const lenSec = (bpmMap.tickToMs(p.tick + length) - bpmMap.tickToMs(p.tick)) / 1000.0;
      // 계획에서 정한 횟수(기본 횟수)를 우선한다
      let count = p.count ? p.count : Math.trunc(Math.min(100, Math.max(3, pyRound(burstDefaultCount * lenSec))));
      count = Math.max(3, Math.min(count, Math.trunc(MAX_BURST_PER_SEC * lenSec), 100));
      if (p.tick < Math.max(...busyUntil) || p.tick < burstEnd || Math.trunc(MAX_BURST_PER_SEC * lenSec) < 3) {
        stats.dropped! += 1; // 짧아서 3회도 어렵거나 다른 노트와 겹치면 연타노트를 만들지 않는다
        continue;
      }
      burstEnd = p.tick + length;
      notes.push(makeNote(notes.length + 1, 'burst', LANE_BOTH, p.tick, length, count));
      continue;
    }
    let lane = singleLanes[laneIdx++]!;
    if (p.tick < burstEnd + restTicks) {
      stats.dropped! += 1; // 연타 구간 안의 노트는 연타가 대신한다 (레퍼런스 모드: 연타 뒤 휴지 포함)
      continue;
    }
    if (ref && p.tick < Math.max(...busyUntil)) {
      // 롱노트 진행 중 다른 노트: 허용 개수 제한
      let cur: number | null = null;
      for (const k of inner.keys()) if (k <= p.tick && (cur === null || k > cur)) cur = k; // 진행 중인 롱노트의 시작 tick
      if ((innerMax as number) <= 0 || (cur !== null && (inner.get(cur) ?? 0) >= (innerMax as number))) {
        stats.dropped! += 1;
        continue;
      }
      if (cur !== null) inner.set(cur, (inner.get(cur) ?? 0) + 1);
    }
    if (p.tick < busyUntil[lane]!) {
      // 이 레인은 앞선 긴 노트가 쓰는 중 → 반대 레인으로
      lane = 1 - lane;
      stats.moved! += 1;
    }
    let ntype = p.type;
    let length = p.length_tick;
    if (ntype !== 'tap' && (p.tick < busyUntil[1 - lane]! || length < p.min_length_tick)) {
      ntype = 'tap'; // 반대 레인도 긴 노트 중이면 단타로
      length = 0;
      stats.to_tap! += 1;
    }
    if (ntype !== 'tap') {
      busyUntil[lane] = p.tick + length;
      inner.set(p.tick, 0);
    }
    notes.push(makeNote(notes.length + 1, ntype, lane, p.tick, ntype !== 'tap' ? length : null));
  }
  return [notes, stats];
}
