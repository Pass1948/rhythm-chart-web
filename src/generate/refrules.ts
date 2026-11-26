/**
 * 레퍼런스 규칙 디자인 모드 (design_mode = 'reference'). (원본 refrules.py)
 * 실제 채보 코퍼스 분석에서 얻은 기준을 적용한다. 기존 방식(classic)은 건드리지 않고, 이 모드를 고른 때만 아래 규칙이 켜진다.
 * 적용 규칙: T1 비율 / H1~H4 롱노트 길이 / B1·B2 연타 길이·휴지 / L1~L3 레인 / L6·F4 지그재그 / S1·S2 곡 구조 / F1~F3 고밀도 시간 제한
 * 숫자는 config\presets.json 의 'reference_rules' 로 바꿀 수 있다(없으면 아래 기본값).
 */
import { RESOLUTION } from '../core/schema.ts';
import type { BpmMap } from '../core/timing.ts';
import { beatMsAt } from './beatLen.ts';
import { cloneJson } from '../core/util.ts';
import type { Presets } from '../core/config.ts';
import { PyRandom } from './pyRandom.ts';
import type { NotePlan, ResolvedOptions } from './types.ts';

export const DESIGN_MODES = ['classic', 'reference', 'unified'] as const; // unified 는 unified.ts

export const DEFAULT_RULES: Record<string, Record<string, any>> = {
  EASY: {
    ratios: { tap: 87.0, hold: 10.0, burst: 3.0 },
    hold_beats: 2.0, hold_cap_multiplier: 2.0, burst_count: 8, burst_max_beats: 6.0,
    switch_prob: 0.43, max_same_lane_run: 9, max_zigzag: 3, lane_balance: 0.55,
    hold_inner_max: 0, burst_rest_beats: 0.5,
    dense_limits: [[0.5, 2.0]], // [간격 상한(박), 연속 허용 시간(초)]
  },
  NORMAL: {
    ratios: { tap: 89.0, hold: 10.0, burst: 1.0 },
    hold_beats: 1.0, hold_cap_multiplier: 3.0, burst_count: 8, burst_max_beats: 5.0,
    switch_prob: 0.44, max_same_lane_run: 9, max_zigzag: 3, lane_balance: 0.55,
    hold_inner_max: 0, burst_rest_beats: 0.5,
    dense_limits: [[0.5, 3.0]],
  },
  HARD: {
    ratios: { tap: 91.0, hold: 8.0, burst: 1.0 },
    hold_beats: 1.0, hold_cap_multiplier: 3.0, burst_count: 8, burst_max_beats: 4.0,
    switch_prob: 0.41, max_same_lane_run: 15, max_zigzag: 3, lane_balance: 0.55,
    hold_inner_max: 1, burst_rest_beats: 0.5,
    dense_limits: [[0.5, 9.0], [0.26, 1.5]],
  },
};
DEFAULT_RULES.CUSTOM = DEFAULT_RULES.NORMAL!;

/** 난이도에 맞는 규칙 (presets.json 의 reference_rules 로 덮어쓴 값). */
export function rulesFor(difficulty: string, presets: Presets): Record<string, any> {
  const rules = cloneJson(DEFAULT_RULES[difficulty] ?? DEFAULT_RULES.NORMAL!);
  const custom = presets?.reference_rules;
  if (custom && typeof custom === 'object' && custom[difficulty] && typeof custom[difficulty] === 'object') {
    for (const [k, v] of Object.entries(custom[difficulty])) {
      if (k in rules) rules[k] = v;
    }
  }
  return rules;
}

/** S1·S2: 곡 위치(0~1)에 따른 마디 예산 가중. 도입부(앞 10%)는 낮게, 뒤로 갈수록 최대 +20% 까지 높인다. */
export function structureRamp(pos: number): number {
  if (pos < 0.1) return 0.75 + 0.25 * (pos / 0.1); // 0.75 → 1.0
  if (pos < 0.5) return 1.0;
  return 1.0 + (0.2 * (pos - 0.5)) / 0.5; // 1.0 → 1.2
}

/** resolve_options 결과에 레퍼런스 규칙의 비율·길이·레인 방식을 덮어쓴다. (밀도·격자·박자 맞춤은 그대로) */
export function applyToOptions(opt: ResolvedOptions, rules: Record<string, any>): ResolvedOptions {
  opt.ratios = { ...rules.ratios };
  opt.hold_beats = Number(rules.hold_beats);
  opt.hold_cap_multiplier = Number(rules.hold_cap_multiplier);
  opt.burst_count = Math.trunc(Number(rules.burst_count));
  opt.burst_max_beats = Number(rules.burst_max_beats);
  opt.lane_mode = 'natural';
  opt.design_mode = 'reference';
  opt.rules = rules;
  opt.ramp = structureRamp;
  return opt;
}

/**
 * 확률 전환 레인 배분. 같은 입력·시드면 항상 같은 결과.
 * 직전과 다른 레인으로 바꿀 확률 switch_prob, 같은 레인 연속이 한도에 닿으면 강제 전환,
 * 촘촘한 구간(간격 ≤ 8분)에서 교차가 max_zigzag 번 연속되면 같은 레인 유지, 한쪽이 lane_balance 를 넘으면 반대쪽으로.
 */
export function naturalLanes(plans: NotePlan[], rules: Record<string, any>, seed: number): number[] {
  const rng = new PyRandom(seed);
  const pSwitch = Number(rules.switch_prob);
  const maxRun = Math.trunc(Number(rules.max_same_lane_run));
  const maxZig = Math.trunc(Number(rules.max_zigzag));
  const balance = Number(rules.lane_balance);
  const lanes: number[] = [];
  const counts = [0, 0];
  let run = 0;
  let zig = 0;
  let prevTick: number | null = null;
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i]!;
    let lane: number;
    if (i === 0) {
      lane = rng.randrange(2);
      run = 1;
    } else {
      const last = lanes[lanes.length - 1]!;
      const dense = prevTick !== null && p.tick - prevTick <= Math.floor(RESOLUTION / 2);
      if (run >= maxRun) lane = 1 - last;
      else if (dense && zig >= maxZig) lane = last;
      else lane = rng.random() < pSwitch ? 1 - last : last;
      const n = i;
      if (n >= 20 && lane === last && counts[last]! + 1 > balance * (n + 1)) lane = 1 - last;
      zig = lane !== last ? zig + 1 : 0;
      run = lane !== last ? 1 : run + 1;
    }
    counts[lane]! += 1;
    lanes.push(lane);
    prevTick = p.tick;
  }
  return lanes;
}

/**
 * 고밀도(간격이 짧은) 구간이 허용 시간 이상 이어지면 단타를 빼서 쉬는 틈을 만든다.
 * 롱노트·연타는 건드리지 않고, 그 노트에서 연속 구간이 끊긴 것으로 본다. 반환: [새 계획 목록, 뺀 개수]
 */
export function limitDensity(plans: NotePlan[], bpmMap: BpmMap, rules: Record<string, any>): [NotePlan[], number] {
  const limits: [number, number][] = ((rules.dense_limits ?? []) as number[][]).map(([g, s]) => [Number(g), Number(s) * 1000.0]);
  if (!limits.length || !plans.length) return [plans, 0];
  const times = plans.map((p) => bpmMap.tickToMs(p.tick));
  const keep = plans.map(() => true);
  let removed = 0;
  for (const [gapBeats, maxMs] of limits) {
    const gapMsAt = (k: number): number => gapBeats * beatMsAt(bpmMap, plans[k]!.tick) * 1.05; // 변속 곡은 그 위치의 박 길이
    let runStart: number | null = null;
    let lastT: number | null = null;
    let i = 0;
    while (i < plans.length) {
      if (!keep[i]) {
        i += 1;
        continue;
      }
      const t = times[i]!;
      if (plans[i]!.type !== 'tap') {
        runStart = null;
        lastT = t;
        i += 1;
        continue;
      }
      if (lastT === null || t - lastT > gapMsAt(i)) {
        runStart = t;
      } else if (runStart !== null && t - runStart > maxMs) {
        // 한도 초과: 이 노트부터 간격이 열릴 때까지 단타를 뺀다
        let j = i;
        while (j < plans.length && (!keep[j] || (plans[j]!.type === 'tap' && times[j]! - lastT <= gapMsAt(j) * 1.5))) {
          if (keep[j] && plans[j]!.type === 'tap') {
            keep[j] = false;
            removed += 1;
          }
          j += 1;
        }
        runStart = null;
        i = j;
        continue;
      }
      lastT = t;
      i += 1;
    }
  }
  return [plans.filter((_, k) => keep[k]), removed];
}
