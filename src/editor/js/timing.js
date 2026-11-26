// 시간 변환 (서버 app/core/timing.py 와 같은 규칙): tick ↔ 채보 시간(ms) ↔ 음원 시간(ms), 마디:박 표시.
// 화면에서는 항상 '음원 시간(ms)' = 채보 시간 + audio_offset_ms 로 위치를 다룬다.

export const RES = 960; // 1박(4분음표) = 960 tick

export class BpmMap {
  // entries: [{tick, bpm, beats_per_bar, beat_unit}], offsetMs: audio_offset_ms
  constructor(entries, offsetMs = 0) {
    const rows = [...entries].sort((a, b) => a.tick - b.tick).map((e) => ({
      tick: e.tick, bpm: e.bpm, bpb: e.beats_per_bar || 4, unit: e.beat_unit || 4,
    }));
    this.rows = rows;
    this.offsetMs = offsetMs;
    this.startMs = [0];
    for (let i = 1; i < rows.length; i++) {
      this.startMs.push(this.startMs[i - 1] + (rows[i].tick - rows[i - 1].tick) * this.msPerTick(i - 1));
    }
  }

  // 구간 i 에서 1 tick 이 몇 ms 인지
  msPerTick(i) {
    return 60000 / (this.rows[i].bpm * RES);
  }

  segByTick(tick) {
    let i = 0;
    while (i + 1 < this.rows.length && this.rows[i + 1].tick <= tick) i++;
    return i;
  }

  segByMs(ms) {
    let i = 0;
    while (i + 1 < this.rows.length && this.startMs[i + 1] <= ms) i++;
    return i;
  }

  // tick → 채보 시간(ms)
  tickToChartMs(tick) {
    const i = this.segByTick(tick);
    return this.startMs[i] + (tick - this.rows[i].tick) * this.msPerTick(i);
  }

  // 채보 시간(ms) → tick (소수)
  chartMsToTick(ms) {
    const i = this.segByMs(ms);
    return this.rows[i].tick + (ms - this.startMs[i]) / this.msPerTick(i);
  }

  // tick → 음원 시간(ms)
  tickToAudioMs(tick) {
    return this.tickToChartMs(tick) + this.offsetMs;
  }

  // 음원 시간(ms) → tick (소수)
  audioMsToTick(ms) {
    return this.chartMsToTick(ms - this.offsetMs);
  }

  // 한 마디의 tick 수 (구간 i)
  barTicks(i) {
    const r = this.rows[i];
    return (RES * 4 * r.bpb) / r.unit;
  }

  // 마디선 목록 [{tick, bar}] (endTick 까지). 박자가 바뀌는 곳에서 새 마디가 시작된다.
  barLines(endTick) {
    const out = [];
    let bar = 1;
    for (let i = 0; i < this.rows.length; i++) {
      const segEnd = i + 1 < this.rows.length ? this.rows[i + 1].tick : Infinity;
      const step = this.barTicks(i);
      for (let t = this.rows[i].tick; t < segEnd && t <= endTick; t += step) {
        out.push({ tick: t, bar });
        bar++;
      }
    }
    return out;
  }

  // 위치 표시용 "마디:박" (박은 소수 둘째 자리까지, 필요 없으면 생략)
  barBeat(tick) {
    const i = this.segByTick(tick);
    const step = this.barTicks(i);
    let bar = 1;
    for (let k = 0; k < i; k++) {
      const segEnd = this.rows[k + 1].tick;
      bar += Math.ceil((segEnd - this.rows[k].tick) / this.barTicks(k));
    }
    const into = tick - this.rows[i].tick;
    bar += Math.floor(into / step);
    const beat = 1 + (into % step) / RES;
    const text = Number.isInteger(beat) ? String(beat) : String(Math.round(beat * 100) / 100);
    return `${bar}:${text}`;
  }

  get isMulti() {
    return this.rows.length > 1;
  }
}
