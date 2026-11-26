// 10단계 단위 테스트(편집기 순수 규칙): ④ 4키 편집 규칙(동시 3개 거절, 레인 뒤집기 i↔3-i, 연타 4레인) + 음원 카드 4줄 판정
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error 편집기 JS 모듈(타입 선언 없음)
import { flipClip, healthStats, makeClip, setKeyMode, swapLane, tryAdd, tryMoveGroup, tryPaste, tryUpdate, idsInArea, laneText } from '../src/editor/js/edit_rules.js';
// @ts-expect-error 편집기 JS 모듈
import { hitNote, inLaneArea, laneAtY, layoutFor, marqueeArea } from '../src/editor/js/timeline_rules.js';
// @ts-expect-error 편집기 JS 모듈
import { noteDrawWidth } from '../src/editor/js/note_shape.js';
// @ts-expect-error 편집기 JS 모듈
import { FOUR_KEY_CODES, laneForCode, laneOfRelativeX } from '../src/editor/js/test_rules.js';

const tap = (id: number, lane: number, tick: number) => ({ id, type: 'tap', lane, tick });
const hold = (id: number, lane: number, tick: number, len: number) => ({ id, type: 'hold', lane, tick, length_tick: len });
const burst = (id: number, tick: number, len: number) => ({ id, type: 'burst', lane: 'both', tick, length_tick: len, count: 8 });

afterEach(() => setKeyMode(2));

describe('④ 4키 편집 규칙', () => {
  it('레인 0~3 추가, 4는 거절 / 2키에서는 레인 2 거절', () => {
    setKeyMode(4);
    expect(tryAdd([], { type: 'tap', lane: 3, tick: 0 }).ok).toBe(true);
    expect(tryAdd([], { type: 'tap', lane: 4, tick: 0 }).ok).toBe(false);
    setKeyMode(2);
    expect(tryAdd([], { type: 'tap', lane: 2, tick: 0 }).ok).toBe(false);
    expect(tryAdd([], { type: 'tap', lane: 1, tick: 0 }).ok).toBe(true);
  });
  it('같은 시각 3번째 노트는 거절하고 이유를 알린다 (2키는 제한 없음)', () => {
    const base = [tap(1, 0, 960), tap(2, 3, 960)];
    setKeyMode(4);
    const r = tryAdd(base, { type: 'tap', lane: 1, tick: 960 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('최대 2개');
    expect(tryAdd(base, { type: 'tap', lane: 1, tick: 1920 }).ok).toBe(true);
    // 이동으로 3번째가 되는 경우도 거절
    const moved = tryUpdate([...base, tap(3, 1, 1920)], 3, { tick: 960 });
    expect(moved.ok).toBe(false);
    // 같은 레인 같은 위치는 기존 규칙대로 거절
    expect(tryAdd(base, { type: 'tap', lane: 0, tick: 960 }).ok).toBe(false);
  });
  it('롱노트 유지 포함 동시 입력 합 2개까지만 (롱노트를 새로 얹는 경우도 검사, [13])', () => {
    setKeyMode(4);
    const notes = [hold(1, 0, 0, 4000), tap(2, 1, 960), tap(3, 2, 960)];
    expect(tryAdd(notes, { type: 'tap', lane: 3, tick: 960 }).ok).toBe(false); // 같은 시각 3개
    expect(tryAdd([hold(1, 0, 0, 4000), hold(2, 2, 0, 4000)], { type: 'tap', lane: 3, tick: 960 }).ok).toBe(false); // 유지 2 + 시작 1 = 3
    expect(tryAdd([hold(1, 0, 0, 4000)], { type: 'tap', lane: 3, tick: 960 }).ok).toBe(true); // 유지 1 + 시작 1 = 2
    const two = [hold(1, 0, 0, 4000), hold(2, 1, 0, 4000), tap(3, 2, 960), tap(4, 3, 960)];
    expect(tryAdd([hold(1, 0, 0, 4000), tap(3, 2, 960), tap(4, 3, 960)], { type: 'hold', lane: 1, tick: 0, length_tick: 4000 }).ok).toBe(false); // 롱노트를 얹으면 합 4
    expect(two.length).toBe(4);
    // 롱노트 진행 중인 레인에는 다른 노트 금지(기존 규칙)
    expect(tryAdd([hold(1, 0, 0, 4000)], { type: 'tap', lane: 0, tick: 960 }).ok).toBe(false);
  });
  it('좌우 뒤집기: 4키 i ↔ 3-i, 연타는 그대로 / 2키 0↔1', () => {
    setKeyMode(4);
    const list = [tap(1, 0, 0), tap(2, 1, 960), tap(3, 2, 1920), tap(4, 3, 2880)];
    expect([0, 1, 2, 3].map((i) => swapLane([tap(9, i, 0)], 9).note.lane)).toEqual([3, 2, 1, 0]);
    expect(swapLane([burst(5, 5000, 960)], 5).ok).toBe(false);
    const clip = makeClip([...list, burst(5, 6000, 960)], [1, 2, 3, 4, 5]);
    expect(flipClip(clip).items.map((it: { lane: unknown }) => it.lane)).toEqual([3, 2, 1, 0]); // 2.2: 연타는 복사 대상에서 빠진다
    setKeyMode(2);
    expect(swapLane([tap(9, 0, 0)], 9).note.lane).toBe(1);
  });
  it('붙여넣기·그룹 이동도 4키 규칙을 따른다 (전체 성공 또는 전체 취소)', () => {
    setKeyMode(4);
    const notes = [tap(1, 0, 960), tap(2, 3, 960), tap(3, 1, 2880)];
    const clip = makeClip(notes, [3]);
    const bad = tryPaste(notes, clip, 960);
    expect(bad.ok).toBe(false);
    const ok = tryPaste(notes, clip, 4800, null, true);
    expect(ok.ok).toBe(true);
    expect(ok.notes.find((n: { tick: number }) => n.tick === 4800).lane).toBe(2); // 1 → 3-1
    expect(tryMoveGroup(notes, [3], -1920).ok).toBe(false); // 같은 시각 3번째
  });
  it('연타는 4레인 전체: 구간 안 어느 레인 노트도 거절, 영역 선택·건강검진은 4레인', () => {
    setKeyMode(4);
    const notes = [burst(1, 1000, 1920), tap(2, 2, 5000)];
    expect(tryAdd(notes, { type: 'tap', lane: 3, tick: 1500 }).ok).toBe(false);
    expect(tryAdd(notes, { type: 'burst', lane: 'both', tick: 3000, length_tick: 960, count: 8 }).ok).toBe(false); // 2.2: 새 연타는 만들 수 없다
    expect(idsInArea(notes, { t0: 1500, t1: 1600, lanes: [3], pad: 0 })).toEqual([1]);
    const h = healthStats([tap(1, 0, 0), tap(2, 3, 960), tap(3, 3, 1920), burst(4, 4000, 960)], (t: number) => t);
    expect(h.lane).toEqual([1, 0, 0, 2]);
    expect(h.laneTotal).toBe(3);
    expect(laneText(2)).toBe('3레인(K)');
    expect(noteDrawWidth({ type: 'burst' }, 50, 'circle', 4)).toBe(184);
    expect(noteDrawWidth({ type: 'burst' }, 50, 'circle')).toBe(84);
  });
});

describe('음원 카드 4줄 / 테스트 팝업 입력', () => {
  it('노트 줄 4개가 같은 영역을 4등분하고 줄 판정이 맞는다 (2키 배치는 그대로)', () => {
    const L2 = layoutFor(230);
    const L4 = layoutFor(230, 4);
    expect(L2.LANE_Y).toEqual([134, 178]);
    expect(L4.LANE_Y.length).toBe(4);
    expect(L4.LANE_Y[0]).toBe(L2.LANE_Y[0]);
    expect(L4.LANE_Y[3]! + L4.LANE_H).toBeLessThanOrEqual(L2.LANE_Y[1]! + L2.LANE_H + 1);
    expect([0, 1, 2, 3].map((l) => laneAtY(L4.LANE_Y[l]! + 2, L4))).toEqual([0, 1, 2, 3]);
    expect(inLaneArea(L4.LANE_Y[3]! + L4.LANE_H - 1, L4)).toBe(true);
    expect(laneAtY(L4.LANE_Y[3]! + L4.LANE_H + 20, L4)).toBe(-1);
    const xOfTick = (t: number): number => 100 + t * 0.01;
    const y3 = L4.LANE_Y[3]! + L4.LANE_H / 2;
    expect(hitNote([tap(1, 3, 1000), tap(2, 0, 1000)], xOfTick(1000), y3, xOfTick, L4)?.note.id).toBe(1);
    const area = marqueeArea({ x0: 90, x1: 200, y0: L4.LANE_Y[1]! + 1, y1: L4.LANE_Y[2]! + 1 }, L4, (x: number) => x, 0);
    expect(area.lanes).toEqual([1, 2]);
  });
  it('테스트 팝업: 4키는 S D K L 고정, 화면 4등분', () => {
    expect(FOUR_KEY_CODES.map((c: string) => laneForCode(c, { key_left: 'KeyS', key_right: 'KeyF' }, 4))).toEqual([0, 1, 2, 3]);
    expect(laneForCode('KeyF', { key_left: 'KeyS', key_right: 'KeyF' }, 4)).toBe(-1);
    expect(laneForCode('KeyF', { key_left: 'KeyS', key_right: 'KeyF' })).toBe(1);
    expect([0, 0.24, 0.26, 0.5, 0.74, 0.99].map((x) => laneOfRelativeX(x, 4))).toEqual([0, 0, 1, 2, 2, 3]);
    expect([0.1, 0.9].map((x) => laneOfRelativeX(x, 2))).toEqual([0, 1]);
  });
});
