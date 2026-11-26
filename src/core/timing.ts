/**
 * tick ↔ 시간(ms) 변환과 격자(스냅). 시간 변환은 반드시 이 파일의 함수만 사용한다.
 * - 1박(4분음표) = RESOLUTION(960) tick
 * - 채보 시간: tick 0 = 0ms 에서 BPM 맵을 따라 누적한 시간
 * - 음원 시간: 채보 시간 + audio_offset_ms (내보낼 때 최종 시간)
 * 원본: app\core\timing.py
 */
import { GRID_DIVISIONS, RESOLUTION, ticksPerBar } from './schema.ts';
import type { BpmEntry, ChartV2, GridEntry } from './schema.ts';
import { pyRound } from './util.ts';

/** BPM 맵이나 격자 정보가 올바르지 않을 때. */
export class TimingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimingError';
  }
}

export interface BpmRow {
  tick: number;
  bpm: number;
  beats_per_bar: number;
  beat_unit: number;
}

/** 오른쪽 이분 탐색: 값 x 이하인 마지막 위치 + 1 (Python bisect_right). */
function bisectRight(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x < arr[mid]!) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** BPM 맵 (변속·박자 변경 지원). */
export class BpmMap {
  resolution: number;
  entries: BpmRow[];
  private ticks: number[];
  private msStarts: number[];

  constructor(entries: BpmEntry[] | undefined | null, resolution: number = RESOLUTION) {
    if (!entries || entries.length === 0) throw new TimingError('BPM 정보가 비어 있습니다.');
    this.resolution = Math.trunc(resolution);
    const rows: BpmRow[] = entries.map((e) => ({
      tick: Math.trunc(Number(e.tick)),
      bpm: Number(e.bpm),
      beats_per_bar: Math.trunc(Number(e.beats_per_bar ?? 4)),
      beat_unit: Math.trunc(Number(e.beat_unit ?? 4)),
    }));
    for (const r of rows) {
      if (Number.isNaN(r.tick) || Number.isNaN(r.bpm)) throw new TimingError('BPM 정보의 숫자가 올바르지 않습니다.');
    }
    rows.sort((a, b) => a.tick - b.tick);
    if (rows[0]!.tick !== 0) throw new TimingError('BPM 정보의 첫 항목은 시작 위치(tick 0)여야 합니다.');
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]!.tick === rows[i - 1]!.tick) throw new TimingError(`같은 위치에 BPM 정보가 두 개 있습니다. (tick ${rows[i]!.tick})`);
    }
    for (const r of rows) {
      if (!(r.bpm > 0 && r.bpm <= 1000)) throw new TimingError(`BPM 값이 올바르지 않습니다: ${r.bpm}`);
      if (r.beats_per_bar <= 0 || ![1, 2, 4, 8, 16].includes(r.beat_unit)) {
        throw new TimingError(`박자 표시가 올바르지 않습니다: ${r.beats_per_bar}/${r.beat_unit}`);
      }
    }
    this.entries = rows;
    this.ticks = rows.map((r) => r.tick);
    this.msStarts = [0];
    for (let i = 1; i < rows.length; i++) {
      const span = rows[i]!.tick - rows[i - 1]!.tick;
      this.msStarts.push(this.msStarts[this.msStarts.length - 1]! + span * this.msPerTick(i - 1));
    }
  }

  /** 구간 index에서 1 tick이 몇 ms인지. */
  msPerTick(index: number): number {
    return 60000.0 / (this.entries[index]!.bpm * this.resolution);
  }

  indexByTick(tick: number): number {
    return Math.max(0, bisectRight(this.ticks, tick) - 1);
  }

  private indexByMs(ms: number): number {
    return Math.max(0, bisectRight(this.msStarts, ms) - 1);
  }

  /** tick → 채보 시간(ms). 소수 tick도 허용. */
  tickToMs(tick: number): number {
    const i = this.indexByTick(tick);
    return this.msStarts[i]! + (tick - this.ticks[i]!) * this.msPerTick(i);
  }

  /** 채보 시간(ms) → tick (소수). */
  msToTick(ms: number): number {
    const i = this.indexByMs(ms);
    return this.ticks[i]! + (ms - this.msStarts[i]!) / this.msPerTick(i);
  }

  /** 채보 시간(ms) → 가장 가까운 정수 tick (Python round 와 같은 규칙). */
  msToTickInt(ms: number): number {
    return pyRound(this.msToTick(ms));
  }

  /** 해당 tick이 속한 BPM 구간. */
  entryAt(tick: number): BpmRow {
    return this.entries[this.indexByTick(tick)]!;
  }

  /** endTick까지의 마디선 목록 [tick, 마디번호(1부터)]. 박자가 바뀌면 그 위치에서 새 마디가 시작. */
  barLines(endTick: number): [number, number][] {
    const lines: [number, number][] = [];
    let barNo = 1;
    for (let i = 0; i < this.entries.length; i++) {
      const r = this.entries[i]!;
      const segEnd = i + 1 < this.entries.length ? this.entries[i + 1]!.tick : endTick + 1;
      const step = ticksPerBar(r.beats_per_bar, r.beat_unit);
      let t = r.tick;
      while (t < segEnd && t <= endTick) {
        lines.push([t, barNo]);
        barNo += 1;
        t += step;
      }
    }
    return lines;
  }

  /** 저장용 목록. */
  toList(): BpmRow[] {
    return this.entries.map((r) => ({ ...r }));
  }
}

/** 구간별 격자 분할. division은 한 마디(4박)를 나누는 칸 수이고 'free'는 격자 없음. */
export class GridMap {
  resolution: number;
  entries: { tick: number; division: number | 'free' }[];
  private ticks: number[];

  constructor(entries?: GridEntry[] | null, resolution: number = RESOLUTION) {
    this.resolution = resolution;
    const rows: { tick: number; division: number | 'free' }[] = [];
    const source: GridEntry[] = entries && entries.length ? entries : [{ tick: 0, division: 16 }];
    for (const e of source) {
      if (!GRID_DIVISIONS.includes(e.division)) throw new TimingError(`지원하지 않는 격자입니다: ${String(e.division)}`);
      rows.push({ tick: Math.trunc(e.tick), division: e.division });
    }
    rows.sort((a, b) => a.tick - b.tick);
    if (rows[0]!.tick !== 0) rows.unshift({ tick: 0, division: rows[0]!.division });
    this.entries = rows;
    this.ticks = rows.map((r) => r.tick);
  }

  entryAt(tick: number): { tick: number; division: number | 'free' } {
    return this.entries[Math.max(0, bisectRight(this.ticks, tick) - 1)]!;
  }

  /** 해당 위치의 격자 한 칸 크기(tick). 격자 없음이면 null. */
  stepAt(tick: number): number | null {
    const div = this.entryAt(tick).division;
    return div === 'free' ? null : Math.floor((this.resolution * 4) / div);
  }

  /** 가장 가까운 격자선으로 맞춘 정수 tick. 격자 없음이면 반올림만. */
  snap(tick: number): number {
    const entry = this.entryAt(tick);
    const step = this.stepAt(tick);
    if (step === null) return pyRound(tick);
    const anchor = entry.tick;
    return anchor + pyRound((tick - anchor) / step) * step;
  }

  toList(): { tick: number; division: number | 'free' }[] {
    return this.entries.map((r) => ({ ...r }));
  }
}

/** 채보에서 BpmMap, GridMap을 만든다. */
export function buildTiming(chart: ChartV2): { bpmMap: BpmMap; gridMap: GridMap } {
  const timing = chart.timing;
  const res = timing.resolution ?? RESOLUTION;
  return { bpmMap: new BpmMap(timing.bpm_map, res), gridMap: new GridMap(timing.grid_map, res) };
}

/** 최종 음원 시간(ms) = 채보 시간 + audio_offset_ms. */
export function chartMs(bpmMap: BpmMap, tick: number, audioOffsetMs = 0): number {
  return bpmMap.tickToMs(tick) + audioOffsetMs;
}

/** 계약 함수: tick → ms */
export function ticksToMs(tick: number, bpmMap: BpmMap): number {
  return bpmMap.tickToMs(tick);
}

/** 계약 함수: ms → tick(소수 허용) */
export function msToTicks(ms: number, bpmMap: BpmMap): number {
  return bpmMap.msToTick(ms);
}
