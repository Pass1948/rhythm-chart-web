/**
 * [13단계] 4키 전용 노트 배정 (모바일 양손 엄지 기준). 왼손 = 레인 0·1(S D), 오른손 = 레인 2·3(K L).
 * 계획(planNotes 결과: 타이밍·종류·길이·세기)을 받아 4레인·손 기준으로 노트를 놓는다. 2레인 전제로 노트를 빼거나 롱노트를 단타로 바꾸는
 * 2키 단계(lanes.ts / unified.ts 의 buildNotes)는 4키에서 쓰지 않고, 여기서 손 규칙으로 다시 판단한다.
 * 규칙
 *  - 동시 입력은 롱노트 유지까지 포함해 최대 2개, 양손에 하나씩(같은 손 두 레인 동시 금지).
 *  - 롱노트를 누르는 손은 끝날 때까지 다른 노트를 받지 않는다. 다른 롱노트가 진행 중이면 새 롱노트는 단타로.
 *  - 빠른 연속(fast_gap_ms 보다 짧음)은 손 교대 우선, 같은 손 연속은 same_hand_min_gap_ms 이상, 같은 레인 연속 제한.
 *  - 균형은 좌·우 손 비율 우선, 손 안 두 레인은 약하게.
 *  - 패턴: 1~2마디마다 고정 시드로 하나(계단·양손 트릴·손 교대·점프). 빠른 구간은 손 교대·트릴, 느린 구간은 계단·점프. 규칙이 우선.
 *  - 동시 노트: 비율(%)만큼 마디 첫 박·박·세기가 강한 단타에 다른 손 레인 단타를 하나 더.
 * 소리 높낮이는 쓰지 않고, 같은 입력·같은 설정이면 항상 같은 결과다(고정 시드).
 */
import { LANE_BOTH, RESOLUTION } from '../core/schema.ts';
import type { ChartNote } from '../core/schema.ts';
import type { Presets } from '../core/config.ts';
import type { BpmMap } from '../core/timing.ts';
import { pyRound } from '../core/util.ts';
import { PyRandom } from './pyRandom.ts';
import type { NotePlan } from './types.ts';

/** spec: [tick, type, lane, length(롱노트일 때만, 아니면 null)] (unified.ts 의 NoteSpec 과 같은 모양) */
export type Spec4 = [number, string, number, number | null];
/** 연타 spec: [tick, 'burst', 'both', length, count] */
export type BurstSpec4 = [number, string, string, number, number];

const BAR = RESOLUTION * 4;
/** 연타 속도 상한 (lanes.ts 와 같은 값: 검증 한계 12회/초의 80%) */
const MAX_BURST_PER_SEC = 9.6;

/** 레인 → 손 (0 = 왼손, 1 = 오른손) */
export function handOf(lane: number): 0 | 1 {
  return lane < 2 ? 0 : 1;
}

/** 4키 배정 설정 */
export interface FourKeyConfig {
  density: number;
  simultaneousPercent: number;
  fastGapMs: number;
  sameHandMinGapMs: number;
  sameLaneMaxRun: number;
  handBalance: number;
  handTolerance: number;
  patternBars: number[];
  /** 같은 레인 최소 간격(ms). 통합 규칙 모드의 same_lane_gap_ms, 그 밖에는 0 */
  sameLaneGapMs: number;
  /** 연타 뒤 쉬는 길이(tick). 레퍼런스 규칙 모드의 burst_rest_beats */
  burstRestTicks: number;
  /** 계획에 횟수가 없을 때 연타 기본 횟수 */
  burstDefaultCount: number;
}

/** presets.json 의 four_key 와 사용자 값(없으면 난이도 기본값)으로 설정을 만든다. */
export function fourKeyConfig(presets: Presets, difficulty: string, density: number | null | undefined, simultaneousPercent: number | null | undefined): FourKeyConfig {
  const fk: Record<string, any> = presets.four_key ?? {};
  const pick = (table: Record<string, number> | undefined, fallback: number): number => {
    const v = table?.[difficulty] ?? table?.NORMAL;
    return typeof v === 'number' ? v : fallback;
  };
  return {
    density: density ?? pick(fk.density, 1.25),
    simultaneousPercent: simultaneousPercent ?? pick(fk.simultaneous_percent, 5),
    fastGapMs: Number(fk.fast_gap_ms ?? 220),
    sameHandMinGapMs: Number(fk.same_hand_min_gap_ms ?? 150),
    sameLaneMaxRun: Math.trunc(Number(fk.same_lane_max_run ?? 2)),
    handBalance: Number(fk.hand_balance ?? 0.5),
    handTolerance: Number(fk.hand_balance_tolerance ?? 0.06),
    patternBars: Array.isArray(fk.pattern_bars) && fk.pattern_bars.length ? fk.pattern_bars.map(Number) : [1, 2],
    sameLaneGapMs: 0,
    burstRestTicks: 0,
    burstDefaultCount: 8,
  };
}

/** 패턴 (레인 순서를 되풀이한다) */
export const PATTERNS: Record<string, { lanes: number[]; fast: boolean }> = {
  stairUp: { lanes: [0, 1, 2, 3], fast: false }, // 계단 0→1→2→3
  stairDown: { lanes: [3, 2, 1, 0], fast: false }, // 계단 3→2→1→0
  jump: { lanes: [0, 2, 3, 1], fast: false }, // 점프: 바깥 ↔ 안쪽 (양손 번갈아)
  trillOuter: { lanes: [0, 3], fast: true }, // 양손 트릴 0↔3
  trillInner: { lanes: [1, 2], fast: true }, // 양손 트릴 1↔2
  handAlt: { lanes: [0, 2, 1, 3], fast: true }, // 손 교대: 왼·오 번갈아 바깥/안쪽 섞기
  handAlt2: { lanes: [1, 3, 0, 2], fast: true },
};
const FAST_POOL = ['handAlt', 'handAlt2', 'trillOuter', 'trillInner'];
const SLOW_POOL = ['stairUp', 'stairDown', 'jump', 'stairUp', 'stairDown'];

export interface FourKeyInfo {
  /** 손 규칙(같은 손 간격·롱노트 중인 손)을 지킬 레인이 없어 뺀 노트 */
  dropped_no_lane: number;
  /** 다른 롱노트가 진행 중이라 단타로 바꾼 롱노트 */
  hold_to_tap: number;
  /** 연타와 겹치거나 너무 짧아 만들지 않은 연타 / 연타 구간 안이라 뺀 노트 */
  burst_dropped: number;
  in_burst_dropped: number;
  /** 동시 노트로 더한 수와 실제 비율(% = 동시 노트 쌍 ÷ 단타·롱노트 시각 수) */
  simultaneous_added: number;
  simultaneous_percent: number;
  /** 왼손 비율(%) */
  left_hand_percent: number;
  /** 쓴 패턴 구간 수 */
  pattern_segments: number;
}

export interface FourKeyResult {
  specs: Spec4[];
  bursts: BurstSpec4[];
  info: FourKeyInfo;
  /** 구간마다 고른 패턴 이름 (점검용) */
  patterns: string[];
}

/**
 * 계획 → 4키 노트(spec)와 연타. 같은 입력·설정·시드면 항상 같은 결과.
 */
export function buildFourKeyNotes(plans: NotePlan[], bpmMap: BpmMap, cfg: FourKeyConfig, seed: number): FourKeyResult {
  const rng = new PyRandom(seed + 404);
  const info: FourKeyInfo = { dropped_no_lane: 0, hold_to_tap: 0, burst_dropped: 0, in_burst_dropped: 0, simultaneous_added: 0, simultaneous_percent: 0, left_hand_percent: 0, pattern_segments: 0 };
  const specs: Spec4[] = [];
  const bursts: BurstSpec4[] = [];
  const handBusyUntil = [-1, -1]; // 손별: 롱노트가 끝나는 tick
  const handLastMs = [-1e9, -1e9];
  const laneLastMs = [-1e9, -1e9, -1e9, -1e9];
  const laneCounts = [0, 0, 0, 0];
  const handCounts = [0, 0];
  let lastLane = -1;
  let lastHand = -1;
  let lastMs = -1e9;
  let run = 0;
  let burstEnd = -1;
  const strengthAt = new Map<number, number>();

  // ---- 패턴 구간: 1~2마디씩, 구간 안 평균 간격으로 빠른/느린 패턴 묶음에서 고른다
  const singles = plans.filter((p) => p.type !== 'burst');
  const segPattern = new Map<number, { name: string; start: number }>(); // 마디 → 패턴
  const patterns: string[] = [];
  if (singles.length) {
    const firstBar = Math.floor(singles[0]!.tick / BAR);
    const lastBar = Math.floor(singles[singles.length - 1]!.tick / BAR);
    let bar = firstBar;
    while (bar <= lastBar) {
      const len = cfg.patternBars[rng.randrange(cfg.patternBars.length)] ?? 1;
      const inSeg = singles.filter((p) => p.tick >= bar * BAR && p.tick < (bar + len) * BAR);
      let fast = false;
      if (inSeg.length >= 2) {
        const span = bpmMap.tickToMs(inSeg[inSeg.length - 1]!.tick) - bpmMap.tickToMs(inSeg[0]!.tick);
        fast = span / (inSeg.length - 1) < cfg.fastGapMs * 1.15;
      }
      const pool = fast ? FAST_POOL : SLOW_POOL;
      const name = pool[rng.randrange(pool.length)]!;
      for (let b = bar; b < bar + len; b++) segPattern.set(b, { name, start: bar });
      if (inSeg.length) {
        patterns.push(name);
        info.pattern_segments += 1;
      }
      bar += len;
    }
  }
  let curSegStart = -1;
  let patIndex = 0;

  for (const p of plans) {
    strengthAt.set(p.tick, p.strength);
    if (p.type === 'burst') {
      // 연타: 4레인 전체('both'). 진행 중인 롱노트·앞 연타와 겹치거나 3회도 어려우면 만들지 않는다 (lanes.ts 와 같은 횟수 규칙)
      const length = p.length_tick;
      const lenSec = (bpmMap.tickToMs(p.tick + length) - bpmMap.tickToMs(p.tick)) / 1000.0;
      let count = p.count ? p.count : Math.trunc(Math.min(100, Math.max(3, pyRound(cfg.burstDefaultCount * lenSec))));
      count = Math.max(3, Math.min(count, Math.trunc(MAX_BURST_PER_SEC * lenSec), 100));
      if (p.tick < Math.max(...handBusyUntil) || p.tick < burstEnd || Math.trunc(MAX_BURST_PER_SEC * lenSec) < 3) {
        info.burst_dropped += 1;
        continue;
      }
      burstEnd = p.tick + length;
      bursts.push([p.tick, 'burst', LANE_BOTH, length, count]);
      continue;
    }
    if (p.tick < burstEnd + cfg.burstRestTicks) {
      info.in_burst_dropped += 1;
      continue;
    }
    const t = bpmMap.tickToMs(p.tick);
    let ntype = p.type;
    let length = p.length_tick;
    const anyHold = handBusyUntil.some((e) => e > p.tick);
    if (ntype === 'hold' && (anyHold || length < p.min_length_tick)) {
      ntype = 'tap'; // 다른 롱노트 진행 중: 롱노트 유지 2개 + 다른 노트를 피하려고 단타로
      length = 0;
      info.hold_to_tap += 1;
    }
    // 패턴 구간
    const bar = Math.floor(p.tick / BAR);
    const seg = segPattern.get(bar);
    if (seg && seg.start !== curSegStart) {
      curSegStart = seg.start;
      patIndex = 0;
    }
    const pat = seg ? PATTERNS[seg.name]!.lanes : null;
    const desired = pat ? pat[patIndex % pat.length]! : -1;
    const fast = t - lastMs < cfg.fastGapMs;
    const total = handCounts[0]! + handCounts[1]!;
    const pick = (strict: boolean): number => {
      let best = -1;
      let bestCost = Infinity;
      for (let l = 0; l < 4; l++) {
        const h = handOf(l);
        if (handBusyUntil[h]! > p.tick) continue; // 롱노트 누르는 손은 받지 않는다
        if (t - laneLastMs[l]! < cfg.sameLaneGapMs) continue;
        if (strict) {
          if (t - handLastMs[h]! < cfg.sameHandMinGapMs) continue; // 같은 손 연속 최소 간격
          if (l === lastLane && (run >= cfg.sameLaneMaxRun || fast)) continue; // 같은 레인 연타 제한
        }
        let cost = 0;
        if (l === desired) cost -= 3;
        if (fast && h === lastHand) cost += 4; // 빠른 연속은 손 교대 우선
        const share = (handCounts[h]! + 1) / (total + 1);
        const target = h === 0 ? cfg.handBalance : 1 - cfg.handBalance;
        const dev = share - target;
        cost += dev * 10;
        if (dev > cfg.handTolerance) cost += 5; // 한 손에 너무 몰리면 다른 손을 강하게
        cost += (laneCounts[l]! / (handCounts[h]! + 1) - 0.5) * 0.8; // 손 안 두 레인 균형(약하게)
        cost += rng.random() * 0.01;
        if (cost < bestCost) {
          bestCost = cost;
          best = l;
        }
      }
      return best;
    };
    const lane = pick(true);
    if (lane < 0) {
      info.dropped_no_lane += 1;
      continue;
    }
    patIndex += 1;
    const h = handOf(lane);
    run = lane === lastLane ? run + 1 : 1;
    lastLane = lane;
    lastHand = h;
    lastMs = t;
    laneCounts[lane]! += 1;
    handCounts[h]! += 1;
    if (ntype === 'hold') {
      const end = p.tick + length;
      handBusyUntil[h] = end;
      handLastMs[h] = bpmMap.tickToMs(end);
      laneLastMs[lane] = bpmMap.tickToMs(end);
    } else {
      handLastMs[h] = t;
      laneLastMs[lane] = t;
    }
    specs.push([p.tick, ntype, lane, ntype === 'hold' ? length : null]);
  }

  addSimultaneous(specs, bursts, bpmMap, cfg, strengthAt, info);
  specs.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  const left = specs.filter((s) => handOf(s[2]) === 0).length;
  info.left_hand_percent = specs.length ? Math.round((1000 * left) / specs.length) / 10 : 0;
  return { specs, bursts, info, patterns };
}

/**
 * 동시 노트: 단타 중 (마디 첫 박 > 박 위치 > 세기) 순으로 골라 다른 손 레인에 단타를 하나 더 둔다.
 * 어느 롱노트라도 진행 중인 시각, 연타 구간, 다른 손의 앞뒤 노트가 same_hand_min_gap_ms 안인 곳은 건너뛴다.
 */
function addSimultaneous(specs: Spec4[], bursts: BurstSpec4[], bpmMap: BpmMap, cfg: FourKeyConfig, strengthAt: Map<number, number>, info: FourKeyInfo): void {
  const base = specs.length;
  const want = Math.round((base * cfg.simultaneousPercent) / 100);
  if (want <= 0) return;
  const holds = specs.filter((s) => s[1] === 'hold').map((s) => [s[0], s[0] + (s[3] ?? 0)] as [number, number]);
  const score = (tick: number): number => (tick % BAR === 0 ? 2 : 0) + (tick % RESOLUTION === 0 ? 1 : 0) + (strengthAt.get(tick) ?? 0);
  const cands = specs.filter((s) => s[1] === 'tap').map((s) => s).sort((a, b) => score(b[0]) - score(a[0]) || a[0] - b[0]);
  const usedTicks = new Set<number>();
  let added = 0;
  for (const s of cands) {
    if (added >= want) break;
    const tick = s[0];
    if (usedTicks.has(tick)) continue;
    if (holds.some(([a, e]) => a <= tick && tick < e)) continue; // 롱노트 유지 중이면 유지 + 2개가 되므로 금지
    if (bursts.some((b) => b[0] <= tick && tick < b[0] + b[3])) continue;
    const t = bpmMap.tickToMs(tick);
    const other = 1 - handOf(s[2]);
    const tooClose = specs.some((o) => o !== s && handOf(o[2]) === other && Math.abs(bpmMap.tickToMs(o[0]) - t) < cfg.sameHandMinGapMs);
    if (tooClose) continue;
    const mirror = 3 - s[2]; // 거울 레인(0↔3, 1↔2)이 기본, 안 되면 그 손의 다른 레인
    const lanes = [mirror, other === 0 ? 1 - mirror : 5 - mirror];
    let placed = -1;
    for (const l of lanes) {
      const near = specs.some((o) => o[2] === l && Math.abs(bpmMap.tickToMs(o[0]) - t) < Math.max(cfg.sameLaneGapMs, 1));
      if (!near) {
        placed = l;
        break;
      }
    }
    if (placed < 0) continue;
    specs.push([tick, 'tap', placed, null]);
    usedTicks.add(tick);
    added += 1;
  }
  info.simultaneous_added = added;
  const ticks = new Set(specs.map((x) => x[0])).size;
  info.simultaneous_percent = ticks ? Math.round((1000 * added) / ticks) / 10 : 0;
}

/** 4키 생성 후 점검(통합 규칙 모드): 구간 밖, 연타 겹침, 같은 레인 간격, 동시 입력 3개 이상(롱노트 유지 포함), 같은 손 동시. */
export function checkRules4(notes: ChartNote[], bpmMap: BpmMap, offsetMs: number, lo: number, hi: number, sameLaneGapMs: number): string[] {
  const problems: string[] = [];
  const lastEnd = [-1e9, -1e9, -1e9, -1e9];
  let bothEnd = -1e9;
  const sorted = [...notes].sort((a, b) => a.tick - b.tick);
  for (const n of sorted) {
    const t = bpmMap.tickToMs(n.tick) + offsetMs;
    const e = bpmMap.tickToMs(n.tick + (n.length_tick || 0)) + offsetMs;
    if (t < lo || e > hi) problems.push(`노트 #${n.id} 가 노트를 둘 수 있는 구간(시작 2초 뒤~끝 1초 전) 밖입니다.`);
    if (n.lane === LANE_BOTH) {
      if (t < Math.max(...lastEnd) || t < bothEnd) problems.push(`연타 #${n.id} 구간에 다른 노트가 겹칩니다.`);
      bothEnd = e;
      continue;
    }
    const lane = n.lane as number;
    if (t < bothEnd) problems.push(`노트 #${n.id} 가 연타 구간 안에 있습니다.`);
    if (t - lastEnd[lane]! < sameLaneGapMs) problems.push(`노트 #${n.id} 가 같은 레인의 앞 노트와 ${sameLaneGapMs}ms 미만입니다.`);
    lastEnd[lane] = e;
    const held = sorted.filter((o) => o.type === 'hold' && o.tick < n.tick && o.tick + (o.length_tick || 0) > n.tick).length;
    const same = sorted.filter((o) => o.lane !== LANE_BOTH && o.tick === n.tick);
    if (held + same.length > 2) problems.push(`노트 #${n.id} 시각에 동시에 눌러야 하는 노트가 2개를 넘습니다.`);
    if (same.length === 2 && handOf(same[0]!.lane as number) === handOf(same[1]!.lane as number)) problems.push(`노트 #${n.id} 시각에 같은 손 두 레인이 동시입니다.`);
  }
  return [...new Set(problems)];
}
