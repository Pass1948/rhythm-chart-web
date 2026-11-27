import { describe, expect, it } from 'vitest';
// @ts-expect-error 편집기 JS 모듈
import { nudgeSelected } from '../src/editor/js/actions.js';
// @ts-expect-error 편집기 JS 모듈
import { S, gridStep, notes, redo, setChart, setSelection, undo } from '../src/editor/js/state.js';

const tap = (id: number, lane: number, tick: number) => ({ id, type: 'tap', lane, tick });
const hold = (id: number, lane: number, tick: number, len: number) => ({ id, type: 'hold', lane, tick, length_tick: len });
const start = (list: ReturnType<typeof tap>[]) => {
  setChart({
    lanes: 2,
    song: { duration_ms: 5000, audio_offset_ms: 100 },
    timing: {
      bpm_map: [
        { tick: 0, bpm: 125, beats_per_bar: 3, beat_unit: 4 },
        { tick: 960, bpm: 250, beats_per_bar: 7, beat_unit: 8 },
      ],
      grid_map: [{ tick: 0, division: 8 }],
    },
    difficulties: [{ notes: list }],
  });
  S.history.clear();
};

describe('선택한 노트 미세 이동', () => {
  it('박자가 바뀌어도 0.1박은 96 tick이며 마디:박 표시가 정확하다', () => {
    start([tap(1, 0, 0), tap(2, 1, 960)]);
    S.gridDiv = 'tenth';
    setSelection([1, 2]);
    expect(gridStep()).toBe(96);
    nudgeSelected(1, 'grid');
    expect(notes().map((n: {tick: number}) => n.tick)).toEqual([96, 1056]);
    expect(S.map.barBeat(96)).toBe('1:1.1');
    expect(S.map.barBeat(1056)).toBe('2:1.1');
    expect(undo()).toBe(true);
    expect(gridStep()).toBe(96);
    expect(notes()).toEqual([tap(1, 0, 0), tap(2, 1, 960)]);
    expect(redo()).toBe(true);
    expect(notes()).toEqual([tap(1, 0, 96), tap(2, 1, 1056)]);
  });

  it('격자가 없으면 1 tick 이동하며 겹치는 위치도 허용한다', () => {
    start([tap(1, 0, 100), tap(2, 0, 101)]);
    S.gridDiv = 'free';
    setSelection([1]);
    nudgeSelected(1, 'grid');
    expect(notes()).toEqual(expect.arrayContaining([tap(1, 0, 101), tap(2, 0, 101)]));
    expect(undo()).toBe(true);
    nudgeSelected(-1, 'grid');
    expect(notes()).toEqual([tap(1, 0, 99), tap(2, 0, 101)]);
  });

  it('변속 전후의 시작과 롱노트 끝을 같은 음원 시간만큼 옮긴다', () => {
    start([hold(1, 0, 950, 300), tap(2, 1, 1200)]);
    setSelection([1, 2]);
    nudgeSelected(10, 'ms');
    expect(notes()).toEqual([hold(1, 0, 980, 310), tap(2, 1, 1240)]);
    expect(undo()).toBe(true);
    expect(notes()).toEqual([hold(1, 0, 950, 300), tap(2, 1, 1200)]);
    nudgeSelected(-10, 'ms');
    expect(notes()).toEqual([hold(1, 0, 930, 280), tap(2, 1, 1160)]);
  });

  it('곡 시작 이전으로 넘어가면 전체 선택을 그대로 두고 취소 기록도 추가하지 않는다', () => {
    const list = [tap(1, 0, 1), tap(2, 1, 1200)];
    start([...list]);
    setSelection([1, 2]);
    nudgeSelected(-10, 'ms');
    expect(notes()).toEqual(list);
    expect(undo()).toBe(false);
  });
});
