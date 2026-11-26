/**
 * 통합 규칙 디자인 모드 (design_mode = 'unified'). (원본 unified.py)
 * 히트러스 규칙(구간 경계, 같은 레인 100ms, 1초 최대 밀도, 롱노트 중 노트 한도, 연타는 특정 위치에만 등)과
 * 레퍼런스 코퍼스 분석(레인 전환 확률, 곡 구조 램프, 피로도)을 합친 모드다.
 * 숫자는 config\presets.json 의 'unified_rules' 로 바꿀 수 있다.
 */
import { LANE_BOTH, RESOLUTION, makeNote } from '../core/schema.ts';
import type { ChartNote } from '../core/schema.ts';
import type { BpmMap } from '../core/timing.ts';
import { beatMsAt } from './beatLen.ts';
import { cloneJson, pyRound } from '../core/util.ts';
import type { Presets } from '../core/config.ts';
import { AnalysisError } from '../analysis/types.ts';
import type { Candidate } from '../analysis/types.ts';
import { PyRandom } from './pyRandom.ts';
import type { GenerateOptions, NotePlan, ResolvedOptions } from './types.ts';

export const EDGE_START_MS = 2000.0; // 구간 시작 후 노트 금지 (확정)
export const EDGE_END_MS = 1000.0; // 구간 끝 전 노트 금지 (확정)

export const DEFAULT_RULES: Record<string, Record<string, any>> = {
  EASY: {
    nps_base: 1.3, max_nps: 5.0, global_gap_ms: 250, same_lane_gap_ms: 100,
    hold_percent: 8.0, hold_beats: 2.0, hold_cap_multiplier: 2.0,
    hold_inner_cap: 0, hold_inner_avg: 0.0,
    run_dense: 2, run_sparse: 9, trill_8th: 4, trill_16th: 3,
    switch_prob: 0.43, lane_balance: 0.55,
    dense_limits: [[0.5, 2.0, 0]], stream_rest_beats: 0.5,
    burst_rest_beats: 0.5, bursts_per_min: 1.5, burst_min_gap_s: 3.0, burst_max_len_s: 2.0,
  },
  NORMAL: {
    nps_base: 2.0, max_nps: 6.0, global_gap_ms: 150, same_lane_gap_ms: 100,
    hold_percent: 10.0, hold_beats: 1.0, hold_cap_multiplier: 3.0,
    hold_inner_cap: 3, hold_inner_avg: 0.15,
    run_dense: 3, run_sparse: 9, trill_8th: 6, trill_16th: 3,
    switch_prob: 0.44, lane_balance: 0.55,
    dense_limits: [[0.5, 3.0, 5]], stream_rest_beats: 0.5,
    burst_rest_beats: 0.5, bursts_per_min: 1.5, burst_min_gap_s: 3.0, burst_max_len_s: 2.0,
  },
  HARD: {
    nps_base: 2.6, max_nps: 7.0, global_gap_ms: 60, same_lane_gap_ms: 100,
    hold_percent: 10.0, hold_beats: 1.0, hold_cap_multiplier: 3.0,
    hold_inner_cap: 4, hold_inner_avg: 0.5,
    run_dense: 4, run_sparse: 15, trill_8th: 8, trill_16th: 3,
    switch_prob: 0.41, lane_balance: 0.55,
    dense_limits: [[0.5, 9.0, 0], [0.26, 1.5, 0]], stream_rest_beats: 0.5,
    burst_rest_beats: 0.5, bursts_per_min: 1.5, burst_min_gap_s: 3.0, burst_max_len_s: 2.0,
  },
};
DEFAULT_RULES.CUSTOM = DEFAULT_RULES.NORMAL!;

/** 난이도 기준 + presets.json 의 unified_rules 로 덮어쓴 값. */
export function rulesFor(difficulty: string, presets: Presets): Record<string, any> {
  const rules = cloneJson(DEFAULT_RULES[difficulty] ?? DEFAULT_RULES.NORMAL!);
  const custom = presets?.unified_rules;
  if (custom && typeof custom === 'object' && custom[difficulty] && typeof custom[difficulty] === 'object') {
    for (const [k, v] of Object.entries(custom[difficulty])) {
      if (k in rules) rules[k] = v;
    }
  }
  return rules;
}

function num(value: unknown, dflt: number | null = null): number | null {
  if (value === undefined || value === null || value === '') return dflt;
  const f = Number(value);
  return Number.isNaN(f) ? dflt : f;
}

/** 곡(구간) 위치 0~1 에 따른 마디 가중: 도입부 낮게, 뒤로 갈수록 최대 +20%. */
export function rampUnified(pos: number): number {
  if (pos < 0.1) return 0.75 + 0.25 * (pos / 0.1);
  if (pos < 0.5) return 1.0;
  return 1.0 + (0.2 * (pos - 0.5)) / 0.5;
}

/** resolve_options 결과에 통합 규칙을 덮어쓴다. 구간·목표 밀도·연타 허용은 사용자 입력을 받는다. */
export function applyToOptions(opt: ResolvedOptions, rules: Record<string, any>, options: GenerateOptions | undefined, durationMs: number, _offsetMs: number): ResolvedOptions {
  const o = options ?? {};
  const start = num(o.range_start_ms, 0.0) || 0.0;
  let end = num(o.range_end_ms, null);
  end = !end ? durationMs : Math.min(end, durationMs);
  if (start < 0 || end - start < EDGE_START_MS + EDGE_END_MS + 5000) {
    throw new AnalysisError('노트를 놓을 구간이 너무 짧습니다. 시작·끝 시각을 확인해 주세요. (최소 8초)');
  }
  const target = num(o.target_nps);
  if (target !== null && !(target >= 0.3 && target <= 8)) throw new AnalysisError('목표 초당 노트 수는 0.3~8 사이로 입력해 주세요.');
  const holdPct = Number(rules.hold_percent);
  opt.design_mode = 'unified';
  opt.rules = rules;
  opt.lane_mode = 'natural';
  opt.ratios = { tap: 100.0 - holdPct, hold: holdPct, burst: 0.0 }; // 롱노트는 '상한'으로만 쓴다
  opt.hold_beats = Number(rules.hold_beats);
  opt.hold_cap_multiplier = Number(rules.hold_cap_multiplier);
  opt.hold_music_only = true; // 늘어지는 소리에서만 롱노트
  opt.nps_base = target !== null ? target : Number(rules.nps_base);
  opt.max_nps = target !== null ? Math.max(Number(rules.max_nps), opt.nps_base * 1.5) : Number(rules.max_nps);
  opt.min_gap_ms = Number(rules.global_gap_ms);
  opt.range_start_ms = start;
  opt.range_end_ms = end;
  opt.allow_burst = Boolean(o.allow_burst);
  opt.ramp = rampUnified;
  opt.ramp_relative = true;
  return opt;
}

/** 구간 규칙: 시작 후 2초 이전과 끝 1초 전 이후의 후보는 쓰지 않는다. */
export function filterCandidates(cands: Candidate[], startMs: number, endMs: number): Candidate[] {
  const lo = startMs + EDGE_START_MS;
  const hi = endMs - EDGE_END_MS;
  return cands.filter((c) => lo <= c.time_ms && c.time_ms <= hi);
}

/** 격자에 붙이면서 구간 경계(시작 2초 뒤 ~ 끝 1초 전) 밖으로 밀린 계획을 뺀다. 반환: [계획, 뺀 개수] */
export function clipPlans(plans: NotePlan[], bpmMap: BpmMap, offsetMs: number, startMs: number, endMs: number): [NotePlan[], number] {
  const lo = startMs + EDGE_START_MS;
  const hi = endMs - EDGE_END_MS;
  const kept = plans.filter(
    (p) => bpmMap.tickToMs(p.tick) + offsetMs >= lo && bpmMap.tickToMs(p.tick + (p.type !== 'tap' ? p.length_tick : 0)) + offsetMs <= hi,
  );
  return [kept, plans.length - kept.length];
}

// ---------- 피로도: 촘촘한 연속 제한 + 뒤에 쉼 ----------

/** 간격이 짧은 단타가 허용 시간·개수보다 길게 이어지면 뒤의 단타를 빼서 쉼(stream_rest_beats)을 만든다. 롱노트·연타는 건드리지 않는다. */
export function limitRuns(plans: NotePlan[], bpmMap: BpmMap, rules: Record<string, any>): [NotePlan[], number] {
  const limits = (rules.dense_limits ?? []) as number[][];
  if (!limits.length || !plans.length) return [plans, 0];
  const restMsAt = (k: number): number => Number(rules.stream_rest_beats ?? 0.5) * beatMsAt(bpmMap, plans[k]!.tick); // 변속 곡은 그 위치의 박 길이
  const times = plans.map((p) => bpmMap.tickToMs(p.tick));
  const keep = plans.map(() => true);
  let removed = 0;
  for (const [gapBeats, maxSec, maxNotes] of limits) {
    const gapMsAt = (k: number): number => Number(gapBeats) * beatMsAt(bpmMap, plans[k]!.tick) * 1.05;
    let runStart: number | null = null;
    let runN = 0;
    let lastT: number | null = null;
    for (let i = 0; i < plans.length; i++) {
      if (!keep[i]) continue;
      const t = times[i]!;
      if (plans[i]!.type !== 'tap') {
        runStart = null;
        runN = 0;
        lastT = t;
        continue;
      }
      if (lastT === null || t - lastT > gapMsAt(i)) {
        runStart = t;
        runN = 1;
      } else {
        runN += 1;
        const tooLong = runStart !== null && t - runStart > Number(maxSec) * 1000.0;
        const tooMany = Boolean(maxNotes) && runN > Math.trunc(Number(maxNotes));
        if (tooLong || tooMany) {
          if (t - lastT < restMsAt(i)) {
            // 쉼이 생길 때까지 이 단타를 뺀다
            keep[i] = false;
            removed += 1;
            continue;
          }
          runStart = t;
          runN = 1;
        }
      }
      lastT = t;
    }
  }
  return [plans.filter((_, k) => keep[k]), removed];
}

// ---------- 레인 배치 + 규칙 점검 ----------

/** spec: [tick, type, lane, length(롱노트일 때만, 아니면 null)] */
export type NoteSpec = [number, string, number, number | null];
/** 연타 spec: [tick, 'burst', 'both', length, count] */
export type BurstSpec = [number, string, string, number, number];

/**
 * 계획(단타·롱노트) → 노트 목록. 노트마다 규칙을 검사해 레인을 정한다. 어느 레인도 안 되면 그 노트는 뺀다.
 * 규칙: 같은 레인 최소 간격 · 롱노트가 쓰는 레인 비우기 · 롱노트 중 다른 노트 한도(1개당 최대, 평균) ·
 *       롱노트 두 개 연속 금지 · 촘촘한 구간의 같은 레인 연속/좌우 번갈아(트릴) 한도 · 좌우 균형
 */
export function buildNotes(plans: NotePlan[], bpmMap: BpmMap, rules: Record<string, any>, seed: number, _step: number): [NoteSpec[], Record<string, number>] {
  const rng = new PyRandom(seed);
  const sameGap = Number(rules.same_lane_gap_ms);
  const trill16Base = Math.trunc(Number(rules.trill_16th));
  const trill8 = Math.trunc(Number(rules.trill_8th));
  const runDenseCap = Math.trunc(Number(rules.run_dense));
  const runSparseCap = Math.trunc(Number(rules.run_sparse));
  const innerCap = Math.trunc(Number(rules.hold_inner_cap));
  const innerAvg = Number(rules.hold_inner_avg);
  const pSwitch = Number(rules.switch_prob);
  const balance = Number(rules.lane_balance);
  const stats = { dropped_no_lane: 0, hold_to_tap: 0, inner_dropped: 0, inner_total: 0 };

  const specs: NoteSpec[] = [];
  const lastEndMs = [-1e9, -1e9]; // 레인별 마지막 노트가 끝난 시각
  const busyUntil = [-1, -1]; // 롱노트가 레인을 쓰는 동안(tick)
  const counts = [0, 0];
  let lastLane: number | null = null;
  let runTotal = 0;
  let runDense = 0;
  let zig = 0;
  let prevMs: number | null = null;
  let holdsStarted = 0;
  let innerCur = 0;
  let lastHoldEnd = -(10 ** 9);
  for (const p of plans) {
    const t = bpmMap.tickToMs(p.tick);
    const beatMs = beatMsAt(bpmMap, p.tick); // 변속 곡은 그 위치의 박 길이
    const trill16 = beatMs / 4.0 < sameGap ? Math.min(trill16Base, 2) : trill16Base; // 16분이 같은 레인 최소 간격보다 짧은 BPM: 번갈아 쌍(2개)까지만
    const gapBeats = prevMs !== null ? (t - prevMs) / beatMs : 99.0;
    const dense = gapBeats <= 0.55;
    const veryDense = gapBeats <= 0.26;
    let ntype = p.type;
    let length = p.length_tick;
    const inHold = p.tick < Math.max(...busyUntil);
    if (ntype === 'hold' && (inHold || p.tick - lastHoldEnd < RESOLUTION)) {
      // 롱노트 동시/연속 금지
      ntype = 'tap';
      length = 0;
      stats.hold_to_tap += 1;
    }
    // 롱노트 진행 중 다른 노트: 한도 검사
    if (inHold) {
      if (innerCap <= 0 || innerCur >= innerCap || stats.inner_total + 1 > innerAvg * Math.max(holdsStarted, 1) + 1) {
        stats.inner_dropped += 1;
        continue;
      }
    }
    // 후보 레인 평가
    let allowed: number[] = [];
    for (const lane of [0, 1]) {
      if (p.tick < busyUntil[lane]! || t - lastEndMs[lane]! < sameGap) continue;
      if (lastLane !== null && lane === lastLane) {
        const rTotal = runTotal + 1;
        const rDense = dense ? runDense + 1 : 1;
        if (rTotal > runSparseCap || (dense && rDense > runDenseCap)) continue;
      } else if (lastLane !== null && dense) {
        const cap = veryDense ? trill16 : trill8;
        if (zig + 1 > cap) continue;
      }
      allowed.push(lane);
    }
    if (ntype === 'hold' && allowed.length) allowed = allowed.filter((l) => p.tick >= busyUntil[1 - l]!);
    if (!allowed.length) {
      stats.dropped_no_lane += 1;
      continue;
    }
    let lane: number;
    if (allowed.length === 1) {
      lane = allowed[0]!;
    } else {
      // 파이썬 식의 평가 순서를 지킨다: lastLane 이 있을 때만 random() 을 부르고, 없으면 randrange(2)
      let want: number;
      if (lastLane !== null && rng.random() < pSwitch) want = 1 - lastLane;
      else if (lastLane !== null) want = lastLane;
      else want = rng.randrange(2);
      const n = counts[0]! + counts[1]!;
      if (n >= 20 && counts[want]! + 1 > balance * (n + 1)) want = 1 - want;
      lane = allowed.includes(want) ? want : allowed[0]!;
    }
    // 상태 갱신
    if (inHold) {
      innerCur += 1;
      stats.inner_total += 1;
    }
    if (ntype === 'hold') {
      const endTick = p.tick + length;
      busyUntil[lane] = endTick;
      lastEndMs[lane] = bpmMap.tickToMs(endTick);
      lastHoldEnd = endTick;
      holdsStarted += 1;
      innerCur = 0;
    } else {
      lastEndMs[lane] = t;
    }
    if (lastLane !== null && lane === lastLane) {
      runTotal += 1;
      runDense = dense ? runDense + 1 : 1;
      zig = 0;
    } else {
      runTotal = 1;
      runDense = 1;
      zig = lastLane !== null && dense ? zig + 1 : 0;
    }
    lastLane = lane;
    prevMs = t;
    counts[lane]! += 1;
    specs.push([p.tick, ntype, lane, ntype === 'hold' ? length : null]);
  }
  return [specs, stats];
}

// ---------- 연타: 노트가 오래 비는 곳에만 ----------

/**
 * 노트 사이(또는 마지막 노트와 구간 끝 사이)가 오래 비는 곳의 가운데에 연타를 둔다. 횟수 = max(4, 길이(초)×8−2).
 * 앞뒤로 연타 휴지(burst_rest_beats)를 남기고, 가장 오래 빈 곳부터 maxCount 개까지.
 */
export function placeBursts(specs: NoteSpec[], bpmMap: BpmMap, rules: Record<string, any>, rangeEndLocalMs: number, step: number, maxCount: number): BurstSpec[] {
  if (maxCount <= 0 || !specs.length) return [];
  const minGapMs = Number(rules.burst_min_gap_s) * 1000.0;
  const maxLenMs = Number(rules.burst_max_len_s) * 1000.0;
  const ordered = [...specs].sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  for (let i = 0; i + 1 < ordered.length; i++) {
    const a = ordered[i]!;
    const b = ordered[i + 1]!;
    gaps.push([bpmMap.tickToMs(a[0] + (a[3] || 0)), bpmMap.tickToMs(b[0])]);
  }
  const last = ordered[ordered.length - 1]!;
  gaps.push([bpmMap.tickToMs(last[0] + (last[3] || 0)), rangeEndLocalMs]); // 피니시
  // (빈 길이, 시작, 끝) 내림차순. 튜플 비교와 같은 순서로 정렬한다.
  const cand = gaps
    .filter(([s, e]) => e - s >= minGapMs)
    .map(([s, e]) => [e - s, s, e] as [number, number, number])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
  const out: BurstSpec[] = [];
  for (const [size, s, e] of cand.slice(0, maxCount)) {
    const beatMs = beatMsAt(bpmMap, bpmMap.msToTickInt((s + e) / 2.0)); // 변속 곡은 빈 구간 가운데의 박 길이
    const restMs = Number(rules.burst_rest_beats) * beatMs;
    const usable = size - 2 * (restMs + beatMs);
    const lengthMs = Math.min(maxLenMs, usable);
    if (lengthMs < 700) continue;
    const mid = (s + e) / 2.0;
    const tick = pyRound(bpmMap.msToTick(mid - lengthMs / 2) / step) * step;
    const length = Math.max(step, Math.floor((bpmMap.msToTickInt(bpmMap.tickToMs(tick) + lengthMs) - tick) / step) * step);
    const lenS = (bpmMap.tickToMs(tick + length) - bpmMap.tickToMs(tick)) / 1000.0;
    let count = Math.max(4, Math.trunc(lenS * 8 - 2));
    count = Math.min(count, Math.trunc(9.6 * lenS));
    if (count < 3) continue;
    out.push([tick, 'burst', LANE_BOTH, length, count]);
  }
  return out;
}

/** spec 목록(+연타)을 tick 순서로 정렬해 노트 목록으로. */
export function toNotes(specs: NoteSpec[], bursts: BurstSpec[]): ChartNote[] {
  const items: { tick: number; s: NoteSpec | BurstSpec }[] = [...specs.map((s) => ({ tick: s[0], s })), ...bursts.map((b) => ({ tick: b[0], s: b }))];
  items.sort((a, b) => a.tick - b.tick); // 안정 정렬: 같은 tick 은 단타 쪽이 먼저(파이썬과 같다)
  const notes: ChartNote[] = [];
  for (const { s } of items) {
    if (s[1] === 'burst') notes.push(makeNote(notes.length + 1, 'burst', LANE_BOTH, s[0], s[3] as number, (s as BurstSpec)[4]));
    else notes.push(makeNote(notes.length + 1, s[1], s[2] as number, s[0], s[3] as number | null));
  }
  return notes;
}

// ---------- 생성 후 규칙 점검 (올 퍼펙트가 가능한 배치인가) ----------

/** 위반 항목 목록(한국어). 같은 시각 양쪽 노트, 같은 레인 간격, 구간 밖, 롱노트/연타 겹침을 본다. */
export function checkRules(notes: ChartNote[], bpmMap: BpmMap, offsetMs: number, startMs: number, endMs: number, rules: Record<string, any>): string[] {
  const problems: string[] = [];
  const sameGap = Number(rules.same_lane_gap_ms);
  const lo = startMs + EDGE_START_MS - 1;
  const hi = endMs - EDGE_END_MS + 1;
  const lastEnd: Record<number, number> = { 0: -1e9, 1: -1e9 };
  let bothEnd = -1e9;
  let prevT: number | null = null;
  let prevLane: unknown = null;
  for (const n of [...notes].sort((a, b) => a.tick - b.tick)) {
    const t = bpmMap.tickToMs(n.tick) + offsetMs;
    const e = bpmMap.tickToMs(n.tick + (n.length_tick || 0)) + offsetMs;
    if (t < lo || e > hi) problems.push(`노트 #${n.id} 가 노트를 둘 수 있는 구간(시작 2초 뒤~끝 1초 전) 밖입니다.`);
    if (n.lane === LANE_BOTH) {
      if (t < Math.max(lastEnd[0]!, lastEnd[1]!) || t < bothEnd) problems.push(`연타 #${n.id} 구간에 다른 노트가 겹칩니다.`);
      bothEnd = e;
      continue;
    }
    const lane = n.lane as number;
    if (t < bothEnd) problems.push(`노트 #${n.id} 가 연타 구간 안에 있습니다.`);
    if (t - lastEnd[lane]! < sameGap) problems.push(`노트 #${n.id} 가 같은 레인의 앞 노트와 ${sameGap}ms 미만입니다.`);
    if (prevT !== null && Math.abs(t - prevT) < 1 && lane !== prevLane) problems.push(`노트 #${n.id} 가 반대 레인 노트와 같은 시각입니다.`);
    lastEnd[lane] = e;
    prevT = t;
    prevLane = lane;
  }
  return problems;
}
