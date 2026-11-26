// 09단계 단위 테스트: 음원 카드 노트 줄 편집의 순수 계산, 롱노트 캡슐 기하, (싱크 60BPM은 sync08.test.ts)
import { describe, expect, it } from 'vitest';
// @ts-expect-error 편집기 JS 모듈(타입 선언 없음)
import { EDGE_PX, MIN_EDGE_NOTE_PX, hitNote, inLaneArea, laneAtY, layoutFor, marqueeArea, timelineEditEnabled } from '../src/editor/js/timeline_rules.js';
// @ts-expect-error 편집기 JS 모듈
import { movePatch, resizeEndPatch, resizeStartPatch } from '../src/editor/js/note_ops.js';
// @ts-expect-error 편집기 JS 모듈
import { MIN_LONG_TICKS } from '../src/editor/js/edit_rules.js';
import { CAPSULE_ROWS, CAP_SEGMENTS, capsuleExtent, createCapsuleRows, fillCapsuleRows, fillQuadRows } from '../src/play/capsuleGeometry';

const L = layoutFor(230);
/** 1 tick = 0.01px 로 단순화한 좌표 변환 */
const xOfTick = (t: number): number => 100 + t * 0.01;
const tap = (id: number, lane: number, tick: number) => ({ id, type: 'tap', lane, tick });
const hold = (id: number, lane: number, tick: number, len: number) => ({ id, type: 'hold', lane, tick, length_tick: len });
const burst = (id: number, tick: number, len: number) => ({ id, type: 'burst', lane: 'both', tick, length_tick: len, count: 8 });

describe('음원 카드 노트 줄 판정', () => {
  it('노트 줄 영역과 레인: 눈금자·파형·소리 시작 지점 줄은 편집 영역이 아니다', () => {
    expect(inLaneArea(L.RULER / 2, L)).toBe(false);
    expect(inLaneArea(L.WAVE_TOP + 10, L)).toBe(false);
    expect(inLaneArea(L.CAND_Y + 3, L)).toBe(false);
    expect(laneAtY(L.LANE_Y[0] + 5, L)).toBe(0);
    expect(laneAtY(L.LANE_Y[1] + 5, L)).toBe(1);
    expect(laneAtY(L.LANE_Y[1] + L.LANE_H + 30, L)).toBe(-1);
    // 두 줄 사이 빈틈은 가까운 쪽
    expect(laneAtY(L.LANE_Y[0] + L.LANE_H + 1, L)).toBe(0);
    expect(laneAtY(L.LANE_Y[1] - 1, L)).toBe(1);
  });

  it('단타는 같은 레인의 가까운 곳만 맞는다', () => {
    const list = [tap(1, 0, 1000), tap(2, 1, 1000)];
    const yL = L.LANE_Y[0] + L.LANE_H / 2;
    const yR = L.LANE_Y[1] + L.LANE_H / 2;
    expect(hitNote(list, xOfTick(1000), yL, xOfTick, L)?.note.id).toBe(1);
    expect(hitNote(list, xOfTick(1000), yR, xOfTick, L)?.note.id).toBe(2);
    expect(hitNote(list, xOfTick(1000) + 30, yL, xOfTick, L)).toBeNull();
  });

  it('롱노트: 앞·뒤 끝 가장자리는 길이 조절 부위, 가운데는 몸통', () => {
    const list = [hold(1, 0, 0, 4000)]; // 폭 40px
    const y = L.LANE_Y[0] + L.LANE_H / 2;
    const x0 = xOfTick(0);
    const x1 = xOfTick(4000);
    expect(hitNote(list, x0 + 1, y, xOfTick, L)?.part).toBe('start');
    expect(hitNote(list, x1 - 1, y, xOfTick, L)?.part).toBe('end');
    expect(hitNote(list, (x0 + x1) / 2, y, xOfTick, L)?.part).toBe('body');
    expect(hitNote(list, x1 + EDGE_PX, y, xOfTick, L)?.part).toBe('end');
    expect(hitNote(list, x1 + EDGE_PX + 3, y, xOfTick, L)).toBeNull();
  });

  it('너무 좁은 롱노트는 손잡이 없이 몸통만 잡는다', () => {
    const list = [hold(1, 1, 0, 600)]; // 폭 6px < MIN_EDGE_NOTE_PX
    expect(6).toBeLessThan(MIN_EDGE_NOTE_PX);
    const y = L.LANE_Y[1] + L.LANE_H / 2;
    expect(hitNote(list, xOfTick(300), y, xOfTick, L)?.part).toBe('body');
  });

  it('연타는 두 줄 어디에서나 맞고 레인 구분이 없다', () => {
    const list = [burst(5, 0, 4000)];
    const mid = xOfTick(2000);
    expect(hitNote(list, mid, L.LANE_Y[0] + 4, xOfTick, L)?.note.id).toBe(5);
    expect(hitNote(list, mid, L.LANE_Y[1] + 4, xOfTick, L)?.note.id).toBe(5);
  });

  it('영역 선택: 걸친 레인과 틱 범위', () => {
    const area = marqueeArea({ x0: 200, x1: 150, y0: L.LANE_Y[0] + 2, y1: L.LANE_Y[0] + 10 }, L, (x: number) => (x - 100) / 0.01, 20);
    expect(area.lanes).toEqual([0]);
    expect(area.t0).toBeCloseTo(5000, 6);
    expect(area.t1).toBeCloseTo(10000, 6);
    const both = marqueeArea({ x0: 0, x1: 10, y0: L.LANE_Y[0], y1: L.LANE_Y[1] + L.LANE_H }, L, (x: number) => x, 0);
    expect(both.lanes).toEqual([0, 1]);
  });

  it('폭 1024px 이상에서만 편집한다', () => {
    expect(timelineEditEnabled(1024)).toBe(true);
    expect(timelineEditEnabled(1023)).toBe(false);
    expect(timelineEditEnabled(390)).toBe(false);
  });
});

describe('노트 이동·길이 조절 계산 (오른쪽 편집과 공용)', () => {
  it('이동: 시간은 격자에 맞고 레인은 포인터 아래 레인으로, 연타·레인 밖은 레인 유지', () => {
    const n = { id: 1, type: 'tap', lane: 0, tick: 960 };
    expect(movePatch(n, 2000, 0, 1, 240)).toEqual({ tick: 1920, lane: 1 });
    expect(movePatch(n, 2000, 0, -1, 240).lane).toBe(0);
    expect(movePatch(n, -500, 0, 0, 240).tick).toBe(0);
    expect(movePatch({ id: 2, type: 'burst', lane: 'both', tick: 0 }, 480, 0, 1, 240).lane).toBe('both');
  });

  it('뒤 끝 끌기: 최소 길이(1/4박)를 지킨다', () => {
    const n = { id: 1, type: 'hold', lane: 0, tick: 1000, length_tick: 960 };
    expect(resizeEndPatch(n, 3000, 0).length_tick).toBe(2000);
    expect(resizeEndPatch(n, 1000, 0).length_tick).toBe(MIN_LONG_TICKS);
    expect(resizeEndPatch(n, 100, 0).length_tick).toBe(MIN_LONG_TICKS);
  });

  it('앞 끝 끌기: 끝은 그대로, 시작만 움직이고 최소 길이를 지킨다', () => {
    const orig = { id: 1, type: 'hold', lane: 0, tick: 1000, length_tick: 960 }; // 끝 1960
    expect(resizeStartPatch(orig, 500, 0)).toEqual({ tick: 500, length_tick: 1460 });
    const near = resizeStartPatch(orig, 1900, 0);
    expect(near.tick + near.length_tick).toBe(1960);
    expect(near.length_tick).toBe(MIN_LONG_TICKS);
    expect(resizeStartPatch(orig, -300, 0).tick).toBe(0);
  });
});

describe('롱노트 캡슐 기하', () => {
  const base = { topX: 300, topY: 200, topR: 20, capTop: true, bottomX: 320, bottomY: 600, bottomR: 46, capBottom: true };

  it('꼬리·머리 반지름: 가장 넓은 줄의 폭이 각 끝의 지름과 같다(머리 = 단타 크기)', () => {
    const rows = createCapsuleRows();
    fillCapsuleRows(rows, base);
    expect(rows.right[CAP_SEGMENTS]! - rows.left[CAP_SEGMENTS]!).toBeCloseTo(40, 4);
    expect(rows.right[CAP_SEGMENTS + 1]! - rows.left[CAP_SEGMENTS + 1]!).toBeCloseTo(92, 4);
    // 꼭대기·맨 아래 줄은 한 점으로 모인다
    expect(rows.right[0]! - rows.left[0]!).toBeCloseTo(0, 4);
    expect(rows.right[CAPSULE_ROWS - 1]! - rows.left[CAPSULE_ROWS - 1]!).toBeCloseTo(0, 4);
  });

  it('반원은 노트 시각의 위치를 중심으로 반지름만큼 위·아래로 나온다', () => {
    const e = capsuleExtent(base);
    expect(e.top).toBe(180);
    expect(e.bottom).toBe(646);
    const rows = createCapsuleRows();
    fillCapsuleRows(rows, base);
    expect(rows.y[0]).toBeCloseTo(180, 4);
    expect(rows.y[CAP_SEGMENTS]).toBeCloseTo(200, 4);
    expect(rows.y[CAP_SEGMENTS + 1]).toBeCloseTo(600, 4);
    expect(rows.y[CAPSULE_ROWS - 1]).toBeCloseTo(646, 4);
  });

  it('짧은 롱노트(몸통이 반원 높이보다 짧음)도 줄이 거꾸로 가지 않고 폭이 음수가 되지 않는다', () => {
    const rows = createCapsuleRows();
    for (const gap of [0, 3, 20, 60]) {
      fillCapsuleRows(rows, { ...base, topY: 500, topR: 40, bottomY: 500 + gap, bottomR: 46, topX: 300, bottomX: 300 });
      for (let r = 1; r < CAPSULE_ROWS; r += 1) {
        expect(rows.y[r]!).toBeGreaterThanOrEqual(rows.y[r - 1]! - 1e-6);
        expect(rows.right[r]! - rows.left[r]!).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });

  it('잘린 끝은 반원 없이 평평하다', () => {
    const rows = createCapsuleRows();
    fillCapsuleRows(rows, { ...base, capTop: false });
    for (let k = 0; k <= CAP_SEGMENTS; k += 1) {
      expect(rows.y[k]).toBe(200);
      expect(rows.right[k]! - rows.left[k]!).toBeCloseTo(40, 4);
    }
    fillCapsuleRows(rows, { ...base, capBottom: false });
    for (let k = CAP_SEGMENTS + 1; k < CAPSULE_ROWS; k += 1) {
      expect(rows.y[k]).toBe(600);
      expect(rows.right[k]! - rows.left[k]!).toBeCloseTo(92, 4);
    }
    expect(capsuleExtent({ ...base, capTop: false, capBottom: false })).toEqual({ top: 200, bottom: 600 });
  });

  it('연타용 사다리꼴 줄 구조는 위·아래 두 가장자리뿐', () => {
    const rows = createCapsuleRows();
    fillQuadRows(rows, 100, 200, 50, 80, 220, 400);
    expect(rows.y[0]).toBe(50);
    expect(rows.y[CAP_SEGMENTS]).toBe(50);
    expect(rows.y[CAP_SEGMENTS + 1]).toBe(400);
    expect(rows.y[CAPSULE_ROWS - 1]).toBe(400);
    expect(rows.left[CAP_SEGMENTS + 1]).toBe(80);
    expect(rows.right[0]).toBe(200);
  });
});
