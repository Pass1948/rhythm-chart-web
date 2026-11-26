import { ticksPerBar } from '../core/schema.ts';
import type { BpmMap } from '../core/timing.ts';
import { pyRound } from '../core/util.ts';
import { median } from '../analysis/dsp.ts';
import type { Candidate } from '../analysis/types.ts';
import type { SnappedCandidate } from './types.ts';

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
    const entry = bpmMap.entryAt(tick);
    const width = ticksPerBar(entry.beats_per_bar, entry.beat_unit);
    const b = entry.tick + Math.floor((tick-entry.tick)/width)*width;
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
    const index = bpmMap.indexByTick(b);
    const meter = bpmMap.entries[index]!;
    const end = Math.min(b + ticksPerBar(meter.beats_per_bar,meter.beat_unit), bpmMap.entries[index+1]?.tick ?? Infinity);
    const barSec = (bpmMap.tickToMs(end) - bpmMap.tickToMs(b)) / 1000;
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
