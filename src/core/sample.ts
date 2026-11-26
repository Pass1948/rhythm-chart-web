/**
 * 화면·테스트가 쓸 샘플 채보를 만든다 (단타·롱노트·연타노트가 섞인 형태, 변속 포함). 원본 sample.py 와 같은 내용.
 */
import { NOTE_BURST, NOTE_HOLD, NOTE_TAP, RESOLUTION, laneSortKey, makeNote, newChart, occupies, ticksPerBar } from './schema.ts';
import type { ChartNote, ChartV2 } from './schema.ts';

const BAR = ticksPerBar(4, 4); // 3840
const BEAT = RESOLUTION;

/** 노트를 하나씩 쌓으며 id를 붙이는 도우미. */
class Builder {
  notes: ChartNote[] = [];

  add(type: string, lane: number, bar: number, beat: number, lengthBeats: number | null = null, count: number | null = null): void {
    const tick = bar * BAR + Math.round(beat * BEAT);
    const length = lengthBeats === null ? null : Math.round(lengthBeats * BEAT);
    this.notes.push(makeNote(this.notes.length + 1, type, lane, tick, length, count));
  }

  finish(): ChartNote[] {
    this.notes.sort((a, b) => a.tick - b.tick || laneSortKey(a.lane) - laneSortKey(b.lane));
    this.notes.forEach((n, i) => {
      n.id = i + 1;
    });
    return this.notes;
  }
}

function normalNotes(): ChartNote[] {
  const b = new Builder();
  // 인트로 (0~3마디): 4분 단타 좌우 교대
  for (let bar = 0; bar < 4; bar++) for (let beat = 0; beat < 4; beat++) b.add(NOTE_TAP, (beat + bar) % 2, bar, beat);
  // 벌스 (4~7마디)
  for (let beat = 0; beat < 4; beat++) b.add(NOTE_TAP, beat % 2, 4, beat);
  b.add(NOTE_HOLD, 0, 5, 0, 2);
  b.add(NOTE_TAP, 1, 5, 1);
  b.add(NOTE_TAP, 1, 5, 2);
  b.add(NOTE_TAP, 0, 5, 3);
  for (let i = 0; i < 8; i++) b.add(NOTE_TAP, i % 2, 6, i * 0.5);
  b.add(NOTE_BURST, 1, 7, 0, 2, 12);
  b.add(NOTE_TAP, 0, 7, 2);
  b.add(NOTE_TAP, 0, 7, 3);
  // 후렴 (8~15마디, 140BPM으로 변속)
  for (let bar = 8; bar < 16; bar++) {
    if (bar % 4 === 1) {
      b.add(NOTE_HOLD, 0, bar, 0, 2);
      b.add(NOTE_TAP, 1, bar, 1);
      b.add(NOTE_TAP, 1, bar, 2);
      b.add(NOTE_TAP, 0, bar, 3);
    } else if (bar % 4 === 3) {
      b.add(NOTE_HOLD, 1, bar, 0, 2);
      b.add(NOTE_TAP, 0, bar, 1);
      b.add(NOTE_TAP, 0, bar, 2);
      b.add(NOTE_TAP, 1, bar, 3);
    } else if (bar === 14) {
      b.add(NOTE_BURST, 1, bar, 0, 4, 20);
      for (let beat = 0; beat < 4; beat++) b.add(NOTE_TAP, 0, bar, beat);
    } else {
      for (let i = 0; i < 8; i++) b.add(NOTE_TAP, i % 2, bar, i * 0.5);
    }
  }
  b.add(NOTE_BURST, 0, 12, 2, 2, 10);
  // 아웃트로 (16~17마디)
  for (let beat = 0; beat < 4; beat++) b.add(NOTE_TAP, beat % 2, 16, beat);
  b.add(NOTE_TAP, 0, 17, 0);
  b.add(NOTE_TAP, 1, 17, 0);
  return b.finish();
}

/** 롱노트 구간 안(같은 레인)과 연타노트 구간 안(양쪽 레인)에 들어간 노트를 제거한다(자동으로 겹침이 없게). */
function removeConflicts(notes: ChartNote[]): ChartNote[] {
  const spans = notes.filter((n) => n.length_tick !== undefined).map((n) => ({ lane: n.lane, s: n.tick, e: n.tick + (n.length_tick as number), id: n.id }));
  return notes.filter((n) => {
    for (const sp of spans) {
      if (sp.id === n.id) continue;
      if ((sp.lane === 'both' || sp.lane === n.lane) && occupies(n, sp.s, sp.e) && (sp.lane === 'both' || (sp.s <= n.tick && n.tick < sp.e))) return false;
    }
    return true;
  });
}

/** 샘플 채보를 만든다. */
export function buildSampleChart(): ChartV2 {
  const chart = newChart('샘플 채보', '(예시)', '', 36000);
  chart.timing.bpm_map = [
    { tick: 0, bpm: 120.0, beats_per_bar: 4, beat_unit: 4 },
    { tick: 8 * BAR, bpm: 140.0, beats_per_bar: 4, beat_unit: 4 },
  ];
  chart.timing.grid_map = [
    { tick: 0, division: 16 },
    { tick: 8 * BAR, division: 8 },
    { tick: 16 * BAR, division: 4 },
  ];
  chart.sections = [
    { tick: 0, name: '인트로', kind: 'intro' },
    { tick: 4 * BAR, name: '벌스', kind: 'verse' },
    { tick: 8 * BAR, name: '후렴', kind: 'chorus' },
    { tick: 16 * BAR, name: '아웃트로', kind: 'outro' },
  ];
  const normal = removeConflicts(normalNotes());
  const easyBase = normal.filter((n) => n.type !== NOTE_BURST && Math.floor(n.tick / BEAT) % 2 === 0 && n.tick % BEAT === 0).map((n) => ({ ...n }));
  const easyHold = normal.filter((n) => n.type === NOTE_HOLD).map((n) => ({ ...n }));
  const merged = new Map<number, ChartNote>();
  for (const n of [...easyBase, ...easyHold]) merged.set(n.id, n);
  const easy = removeConflicts([...merged.values()].sort((a, b) => a.tick - b.tick || laneSortKey(a.lane) - laneSortKey(b.lane)));
  easy.forEach((n, i) => {
    n.id = i + 1;
  });
  chart.difficulties = [
    { name: 'EASY', level: 3, notes: easy },
    { name: 'NORMAL', level: 7, notes: normal },
  ];
  chart.meta.created_by_engine = 'sample';
  return chart;
}
