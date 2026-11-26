/**
 * ④ 노트 종류 판별: 노트 후보에서 단타·롱노트·연타노트를 정한다. (원본 note_types.py 를 그대로 옮김)
 * 결과는 '노트 계획'(NotePlan) 목록이다. 레인은 ⑤(lanes.ts)에서 정하고, 같은 레인 겹침 때문에 길이가 줄거나
 * 단타로 바뀌는 최종 처리도 ⑤에서 한다.
 *
 * 규칙 요약
 * 1. 마디별 노트 예산으로 후보를 고른다 (곡 전체 상위 N개 방식 금지, 구간 밀도 최댓값 제한)
 * 2. 격자에 붙이되 허용 오차(기본 30ms) 초과 후보는 버린다
 * 3. 지속시간이 긴 후보를 우선 롱노트로 (길이는 지속시간에 맞추되 '기본 길이 × 상한 배수' 이내)
 * 4. 밀집한 같은 대역 후보 묶음은 연타노트로 (양쪽 레인 전체 폭 노트)
 * 5. 비율은 최종 노트 개수 기준이다. 재료가 모자라면 단타를 묶어(연타) 또는 늘려서(롱노트) 목표 비율에 수렴시킨다.
 */
import { RESOLUTION, ticksPerBar } from '../core/schema.ts';
import type { BpmMap } from '../core/timing.ts';
import { beatMsByBpm } from './beatLen.ts';
import { pyRound } from '../core/util.ts';
import { median } from '../analysis/dsp.ts';
import type { Candidate } from '../analysis/types.ts';
import { MAX_BURST_PER_SEC } from './lanes.ts';
import type { NotePlan, ResolvedOptions, SnappedCandidate } from './types.ts';

const BAR = ticksPerBar(4, 4);
export const MIN_BURST_MS = 600.0;

function mean(values: number[]): number {
  return values.reduce((s, x) => s + x, 0) / values.length;
}

function makePlan(tick: number, type: string, strength: number, band: string, lengthTick = 0, minLengthTick = 0, count = 0, origin = 'music'): NotePlan {
  return { tick, type, strength, band, length_tick: lengthTick, min_length_tick: minLengthTick, count, origin };
}

/** 후보를 격자에 붙인다. 허용 오차를 넘으면 버린다. 같은 격자 칸에 여럿이면 가장 센 것만 남긴다. 반환: [칸 tick → 후보, 버린 개수] */
export function snapCandidates(
  cands: Candidate[],
  bpmMap: BpmMap,
  offsetMs: number,
  durationMs: number,
  step: number,
  toleranceMs: number,
): [Map<number, SnappedCandidate>, number] {
  const kept = new Map<number, SnappedCandidate>();
  let dropped = 0;
  for (const c of cands) {
    const localMs = c.time_ms - offsetMs;
    const tick = pyRound(bpmMap.msToTick(localMs) / step) * step;
    if (tick < 0) {
      dropped += 1;
      continue;
    }
    const err = Math.abs(bpmMap.tickToMs(tick) - localMs);
    const finalMs = bpmMap.tickToMs(tick) + offsetMs;
    if (err > toleranceMs || (durationMs && finalMs > durationMs - 30)) {
      dropped += 1;
      continue;
    }
    const prev = kept.get(tick);
    if (!prev || c.strength > prev.strength) kept.set(tick, { ...c, tick, err_ms: err });
  }
  return [kept, dropped];
}

/** 마디마다 노트 예산을 두고 센 후보부터 고른다. 마디의 소리 세기에 따라 예산을 늘리고 줄이되 최댓값을 제한한다. */
export function selectByBarBudget(
  snapped: Map<number, SnappedCandidate>,
  bpmMap: BpmMap,
  npsBase: number,
  maxNps: number,
  minGapMs: number,
  ramp: ((pos: number) => number) | null = null,
  relative = false,
): [SnappedCandidate[], { budget: number; gap: number }] {
  const bars = new Map<number, SnappedCandidate[]>();
  for (const [tick, c] of snapped) {
    const b = Math.floor(tick / BAR);
    const list = bars.get(b);
    if (list) list.push(c);
    else bars.set(b, [c]);
  }
  if (!bars.size) return [[], { budget: 0, gap: 0 }];
  const sums = new Map<number, number>();
  for (const [b, lst] of bars) sums.set(b, lst.reduce((s, c) => s + c.strength, 0));
  const medianSum = median([...sums.values()]) || 1.0;
  let chosen: SnappedCandidate[] = [];
  let droppedBudget = 0;
  const barKeys = [...bars.keys()];
  const lastBar = Math.max(...barKeys);
  const firstBar = Math.min(...barKeys);
  for (const b of [...barKeys].sort((x, y) => x - y)) {
    const barSec = (bpmMap.tickToMs((b + 1) * BAR) - bpmMap.tickToMs(b * BAR)) / 1000.0;
    let rel = Math.min(1.6, Math.max(0.4, sums.get(b)! / medianSum));
    if (ramp !== null) {
      // 레퍼런스 모드: 곡 위치에 따른 가중 (도입부 낮게, 후반 높게)
      rel *= ramp(relative ? (b - firstBar) / Math.max(lastBar - firstBar, 1) : b / Math.max(lastBar, 1));
    }
    const budget = Math.trunc(Math.min(maxNps * barSec, Math.max(1, pyRound(npsBase * barSec * rel))));
    const ranked = [...bars.get(b)!].sort((x, y) => y.strength - x.strength || x.tick - y.tick);
    const take = ranked.slice(0, budget);
    droppedBudget += ranked.length - take.length;
    chosen = chosen.concat(take);
  }
  chosen.sort((x, y) => x.tick - y.tick);
  // 최소 간격 (마디 경계를 넘는 이웃까지 확인): 약한 쪽을 버린다
  const out: SnappedCandidate[] = [];
  let droppedGap = 0;
  for (const c of chosen) {
    const t = bpmMap.tickToMs(c.tick);
    if (out.length && t - bpmMap.tickToMs(out[out.length - 1]!.tick) < minGapMs) {
      droppedGap += 1;
      if (c.strength > out[out.length - 1]!.strength) out[out.length - 1] = c;
      continue;
    }
    out.push(c);
  }
  return [out, { budget: droppedBudget, gap: droppedGap }];
}

/** 원래 후보(격자에 붙이기 전)에서 간격이 좁고 같은 대역인 연속 후보 묶음을 찾는다. */
export function findBurstRuns(cands: Candidate[], burstGapMs: number, minHits: number): Candidate[][] {
  const runs: Candidate[][] = [];
  let cur: Candidate[] = [];
  for (const c of [...cands].sort((a, b) => a.time_ms - b.time_ms)) {
    const last = cur[cur.length - 1];
    if (last && c.time_ms - last.time_ms <= burstGapMs && c.band === last.band) {
      cur.push(c);
    } else {
      if (cur.length >= minHits) runs.push(cur);
      cur = [c];
    }
  }
  if (cur.length >= minHits) runs.push(cur);
  return runs;
}

/** value 이상인 step 의 배수. */
function ceilStep(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/** 연타 기본 횟수를 채우는 데 필요한 구간 길이(tick): 600ms 이상이고 필요 속도가 안전 한계 이하. */
export function burstWindowTicks(bpmMap: BpmMap, tick: number, count: number, step: number): number {
  const needMs = Math.max(MIN_BURST_MS, (count / MAX_BURST_PER_SEC) * 1000.0);
  const endTick = bpmMap.msToTickInt(bpmMap.tickToMs(tick) + needMs);
  return Math.max(step, ceilStep(endTick - tick, step));
}

/** 노트들의 연속 간격의 중앙값을 격자 칸(step)의 배수로 맞춘 값. 노트가 2개 미만이면 fallback. */
export function localGapTicks(ticks: number[], step: number, fallback: number): number {
  const gaps: number[] = [];
  for (let i = 1; i < ticks.length; i++) if (ticks[i]! > ticks[i - 1]!) gaps.push(ticks[i]! - ticks[i - 1]!);
  if (!gaps.length) return fallback;
  const med = median(gaps);
  return Math.max(step, pyRound(med / step) * step);
}

/** 구간 길이에 맞는 연타 횟수: 기본 횟수를 쓰되 속도 한계를 넘으면 줄인다(3 미만이면 0). */
export function burstCountFor(bpmMap: BpmMap, tick: number, length: number, defaultCount: number): number {
  const lenSec = (bpmMap.tickToMs(tick + length) - bpmMap.tickToMs(tick)) / 1000.0;
  const count = Math.min(Math.trunc(defaultCount), Math.trunc(MAX_BURST_PER_SEC * lenSec), 100);
  return count >= 3 ? count : 0;
}

/**
 * 연타 길이 = 횟수 × 노트 간격 (= 횟수 ÷ 박당 노트 수). 안전 한계를 지킨 (길이 tick, 횟수, 표시) 를 돌려준다.
 * - 길이는 격자에 맞추고, 필요 연타 속도가 안전 한계를 넘으면 길이를 늘린다 (표시 'speed')
 * - 길이가 상한(burst_max_beats 박)을 넘으면 횟수를 줄인다, 3회 미만은 만들지 않는다 (표시 'reduced')
 */
export function burstShape(
  bpmMap: BpmMap,
  tick: number,
  gapTicks: number,
  defaultCount: number,
  step: number,
  maxBeats: number,
): [number, number, string[]] | null {
  const flags: string[] = [];
  const gap = Math.max(step, pyRound(gapTicks / step) * step);
  let count = Math.min(Math.trunc(defaultCount), 100);
  const maxLen = Math.trunc(maxBeats * RESOLUTION);
  if (count * gap > maxLen) {
    const reduced = Math.max(3, Math.floor(maxLen / gap));
    if (reduced < count) {
      count = reduced;
      flags.push('reduced');
    }
  }
  let length = count * gap;
  const floorLen = burstWindowTicks(bpmMap, tick, 3, step); // 600ms 이상
  length = Math.max(length, floorLen);
  const need = burstWindowTicks(bpmMap, tick, count, step); // 속도 한계를 지키는 길이
  if (need > length) {
    length = need;
    flags.push('speed');
  }
  if (length > maxLen) {
    length = Math.floor(maxLen / step) * step;
    count = burstCountFor(bpmMap, tick, length, count);
    if (!flags.includes('reduced')) flags.push('reduced');
  }
  if (count < 3) return null;
  return [length, count, flags];
}

/** plan_notes 가 돌려주는 처리 통계 */
export type PlanInfo = Record<string, number>;

/**
 * ④ 전체: 후보 → 노트 계획 목록과 통계.
 * 순서: 격자·예산으로 노트 고르기 → 연타(음악에서 나온 것 → 단타 묶기) → 롱노트(음악에서 나온 것 → 단타 늘리기) → 나머지 단타.
 * 같은 입력이면 같은 결과다.
 */
export function planNotes(cands: Candidate[], bpmMap: BpmMap, offsetMs: number, durationMs: number, opts: ResolvedOptions): [NotePlan[], PlanInfo] {
  const step = Math.floor((RESOLUTION * 4) / opts.grid_division);
  const beatMsAtTick = (tick: number): number => beatMsByBpm(bpmMap, tick); // 변속 곡은 그 위치의 박 길이
  const [snapped, droppedGrid] = snapCandidates(cands, bpmMap, offsetMs, durationMs, step, opts.grid_tolerance_ms);
  const [selected, dropped0] = selectByBarBudget(snapped, bpmMap, opts.nps_base, opts.max_nps, opts.min_gap_ms, opts.ramp, Boolean(opts.ramp_relative));
  const dropped = { ...dropped0, grid: droppedGrid };
  const nSelected = selected.length;
  const r = opts.ratios;
  const targetBurst = 0; // [2.2] 새 채보는 연타를 만들지 않는다(옛 옵션의 연타 비율은 무시) — 아래 연타 단계가 모두 건너뛰어진다
  const targetHold = r.hold / 100.0;
  const defaultCount = Math.trunc(opts.burst_count);
  const maxBeats = Number(opts.burst_max_beats ?? 8);
  const shapeLog: [number, number, string[]][] = []; // 연타마다 (길이 tick, 노트 간격 tick, 표시)
  const endLimit = durationMs ? bpmMap.msToTickInt(durationMs - offsetMs - 30) : null;
  const plans = new Map<number, NotePlan>(); // tick → NotePlan
  const spans: [number, number][] = []; // 연타 구간 (시작, 끝)
  const state = { remaining: [...selected] as SnappedCandidate[] }; // 아직 단타로 남아 있는 노트 (tick 순서)

  const total = (): number => state.remaining.length + spans.length;
  /** 연타 비율이 아직 목표보다 낮은가. */
  const burstShort = (): boolean => targetBurst > 0 && spans.length < targetBurst * Math.max(1, total()) - 1e-9;
  /** 곡 안에 들어가는 구간인가. */
  const fits = (tick: number, length: number): boolean => {
    if (tick < 0) return false;
    return !(durationMs && bpmMap.tickToMs(tick + length) + offsetMs > durationMs - 30);
  };
  /** 연타 구간을 확정하고 구간 안의 단타를 (양쪽 레인 모두) 흡수한다. */
  const addBurst = (tick: number, length: number, count: number, strength: number, band: string, origin: string): void => {
    spans.push([tick, tick + length]);
    const minLen = pyRound(bpmMap.msToTick(bpmMap.tickToMs(tick) + MIN_BURST_MS) - tick);
    plans.set(tick, makePlan(tick, 'burst', strength, band, length, minLen, count, origin));
    state.remaining = state.remaining.filter((c) => !(tick <= c.tick && c.tick < tick + length));
  };

  // ---- 연타노트 1단계: 음악에서 나온 밀집 묶음 (점수 큰 순서, 서로 겹치지 않게)
  let musicBursts = 0;
  if (targetBurst > 0) {
    const runs = findBurstRuns(cands, opts.burst_gap_ms, opts.burst_min_hits);
    runs.sort((a, b) => b.reduce((s, c) => s + c.strength, 0) - a.reduce((s, c) => s + c.strength, 0));
    for (const run of runs) {
      if (!burstShort()) break;
      const first = run[0]!.time_ms;
      const localMs = first - offsetMs;
      const tick = pyRound(bpmMap.msToTick(localMs) / step) * step;
      if (tick < 0 || Math.abs(bpmMap.tickToMs(tick) - localMs) > 60) continue;
      const times = run.map((c) => c.time_ms);
      let medMs = beatMsAtTick(tick) / 4;
      if (times.length > 1) {
        const diffs: number[] = [];
        for (let i = 1; i < times.length; i++) diffs.push(times[i]! - times[i - 1]!);
        medMs = median(diffs);
      }
      const gap = bpmMap.msToTickInt(bpmMap.tickToMs(tick) + medMs) - tick; // 묶음의 후보 간격 → 박당 노트 수
      const shape = burstShape(bpmMap, tick, gap, defaultCount, step, maxBeats);
      if (shape === null) continue;
      const [length, count, flags] = shape;
      if (spans.some(([s, e]) => tick < e && s < tick + length) || !fits(tick, length)) continue;
      addBurst(tick, length, count, mean(run.map((c) => c.strength)), run[0]!.band, 'music');
      shapeLog.push([length, gap, flags]);
      musicBursts += 1;
    }
  }

  // ---- 연타노트 2단계: 부족하면 단타가 가장 촘촘히 몰린 구간부터 묶는다 (간격을 넓게 시작해 점점 줄인다)
  if (burstShort()) {
    for (const spacing of [2 * BAR, BAR, RESOLUTION, step]) {
      if (!burstShort()) break;
      const wins: [number, number, number, number, number][] = [];
      const ticks = state.remaining.map((c) => c.tick);
      const fallbackGap = localGapTicks(ticks, step, Math.floor(RESOLUTION / 2));
      for (let i = 0; i < ticks.length; i++) {
        const tick = ticks[i]!;
        const near = ticks.slice(i, i + defaultCount + 1); // 이 자리부터 이어지는 노트들의 간격 = 그 자리의 노트 밀도
        const gap = near.length >= 3 ? localGapTicks(near, step, fallbackGap) : fallbackGap;
        const shape = burstShape(bpmMap, tick, gap, defaultCount, step, maxBeats);
        if (shape === null || !fits(tick, shape[0])) continue;
        const k = ticks.slice(i).filter((t) => t < tick + shape[0]).length;
        wins.push([gap, -k, tick, shape[0], gap]);
      }
      wins.sort((a, b) => {
        for (let i = 0; i < 5; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
        return 0;
      }); // 가장 촘촘한 곳부터
      for (const [, , tick, lengthPre, gap] of wins) {
        if (!burstShort()) break;
        if (spans.some(([s, e]) => tick < e + spacing && s < tick + lengthPre + spacing)) continue;
        const inside = state.remaining.filter((c) => tick <= c.tick && c.tick < tick + lengthPre);
        if (!inside.length) continue;
        const [length, count, flags] = burstShape(bpmMap, tick, gap, defaultCount, step, maxBeats)!;
        addBurst(tick, length, count, mean(inside.map((c) => c.strength)), inside[0]!.band, 'made');
        shapeLog.push([length, gap, flags]);
      }
    }
  }

  // ---- 롱노트: 다음 노트(또는 연타 시작·곡 끝) 앞에서 끝나게 해서 다른 노트와 겹치지 않게 한다
  const remaining = state.remaining;
  const nFinal = total();
  const wantHold = targetHold > 0 ? pyRound(nFinal * targetHold) : 0;
  const baseLen = pyRound(opts.hold_beats * RESOLUTION);
  const capLen = pyRound(opts.hold_cap_multiplier * baseLen);
  const minLen = Math.max(step, Math.floor(RESOLUTION / 2));
  // H4: 레퍼런스 모드는 롱노트 길이를 반박(8분) 단위로
  const unit = (opts.design_mode === 'reference' || opts.design_mode === 'unified') && (RESOLUTION / 2) % step === 0 ? Math.floor(RESOLUTION / 2) : step;
  const starts = [...remaining.map((c) => c.tick), ...spans.map(([s]) => s)].sort((a, b) => a - b);
  const nxt = new Map<number, number>();
  starts.forEach((t, i) => {
    nxt.set(t, i + 1 < starts.length ? starts[i + 1]! : endLimit !== null ? endLimit : t + capLen);
  });
  /** 이 노트 뒤로 다른 노트 시작 전까지 쓸 수 있는 길이(tick). */
  const room = (tick: number): number => (nxt.has(tick) ? nxt.get(tick)! : tick) - tick;

  let musicHolds = 0;
  let madeHolds = 0;
  const minDurAt = (tick: number): number => Math.max(250.0, 0.5 * opts.hold_beats * beatMsAtTick(tick));
  if (wantHold) {
    const longOnes = remaining.filter((c) => c.duration_ms >= minDurAt(c.tick)).sort((a, b) => b.duration_ms - a.duration_ms || a.tick - b.tick);
    for (const c of longOnes) {
      if (musicHolds >= wantHold) break;
      const durTicks = bpmMap.msToTick(bpmMap.tickToMs(c.tick) + c.duration_ms) - c.tick;
      const length = Math.trunc(Math.floor(Math.min(durTicks, capLen, room(c.tick)) / unit) * unit);
      if (length < minLen) continue;
      plans.set(c.tick, makePlan(c.tick, 'hold', c.strength, c.band, length, minLen, 0, 'music'));
      musicHolds += 1;
    }
    // 부족하면: 다음 노트까지 간격이 큰 단타부터 롱노트로 늘린다
    if (musicHolds < wantHold && !opts.hold_music_only) {
      const roomy = remaining.filter((c) => !plans.has(c.tick) && room(c.tick) >= minLen).sort((a, b) => room(b.tick) - room(a.tick) || a.tick - b.tick);
      for (const c of roomy) {
        if (musicHolds + madeHolds >= wantHold) break;
        const gap = room(c.tick);
        const usable = gap - step >= minLen ? gap - step : gap; // 가능하면 다음 노트와 한 칸 띄운다
        const length = Math.trunc(Math.floor(Math.min(usable, Math.max(baseLen, minLen)) / unit) * unit);
        if (length < minLen) continue;
        plans.set(c.tick, makePlan(c.tick, 'hold', c.strength, c.band, length, minLen, 0, 'made'));
        madeHolds += 1;
      }
    }
  }

  // ---- 나머지는 단타
  for (const c of remaining) {
    if (!plans.has(c.tick)) plans.set(c.tick, makePlan(c.tick, 'tap', c.strength, c.band));
  }
  const ordered = [...plans.keys()].sort((a, b) => a - b).map((t) => plans.get(t)!);
  const round2 = (x: number): number => Math.round(x * 100) / 100;
  const info: PlanInfo = {
    candidates: cands.length,
    after_grid: snapped.size,
    selected: nSelected,
    dropped_grid: dropped.grid,
    dropped_budget: dropped.budget,
    dropped_gap: dropped.gap,
    wanted_hold: wantHold,
    wanted_burst: pyRound(nFinal * targetBurst),
    burst_runs_used: spans.length,
    burst_music: musicBursts,
    burst_made: spans.length - musicBursts,
    hold_music: musicHolds,
    hold_made: madeHolds,
    burst_avg_beats: shapeLog.length ? round2(mean(shapeLog.map(([l]) => l)) / RESOLUTION) : 0.0,
    burst_avg_per_beat: shapeLog.length ? round2(mean(shapeLog.map(([, g]) => RESOLUTION / g))) : 0.0,
    burst_speed_extended: shapeLog.filter(([, , f]) => f.includes('speed')).length,
    burst_count_reduced: shapeLog.filter(([, , f]) => f.includes('reduced')).length,
  };
  return [ordered, info];
}
