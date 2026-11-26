// 08단계 단위 테스트: 들리는 시계(화면·판정 통일), [싱크 맞추기] 계산.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEARD_CLOCK_CONFIG, HeardClock, NeverBackwards, pickHeardSample } from '../src/play/heardClock';
import { SegmentPlayer } from '../src/play/segmentPlayer';
import { songMsFromContext } from '../src/play/playClock';
import { BEAT_INTERVAL_SEC, SYNC_CONFIG, clampDelayMs, computeCalibration, matchPress, recenter, recentMeanMs } from '../src/play/syncCalibration';

afterEach(() => vi.restoreAllMocks());

/** 가짜 AudioContext: 지연(latency)만큼 늦게 들리는 출력. perf 는 performance.now 흉내(ms) */
function fakeContext(latencySec: number, withStamp = true) {
  const state = { currentTime: 1.0, perf: 5000 };
  const node = () => ({ gain: { value: 1, setTargetAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} });
  const ctx = {
    get currentTime() {
      return state.currentTime;
    },
    state: 'running',
    destination: {},
    createGain: node,
    createBufferSource: () => ({ buffer: null, playbackRate: { value: 1 }, connect() {}, disconnect() {}, start() {}, stop() {} }),
    getOutputTimestamp: withStamp ? () => ({ contextTime: state.currentTime - latencySec, performanceTime: state.perf }) : undefined,
    outputLatency: latencySec,
  };
  /** 소리가 흘러간다: 컨텍스트 시간과 performance.now 가 같이 간다 */
  const advance = (sec: number): void => {
    state.currentTime += sec;
    state.perf += sec * 1000;
  };
  vi.spyOn(performance, 'now').mockImplementation(() => state.perf);
  return { ctx: ctx as unknown as AudioContext, state, advance };
}

function makePlayer(ctx: AudioContext, rate = 1) {
  const timing = { audioStartOffsetMs: 0, inputDelayMs: 0 } as never;
  const buffer = { duration: 10 } as AudioBuffer;
  return new SegmentPlayer(ctx, buffer, timing, 1, rate);
}

describe('들리는 시계 계산', () => {
  it('표본 하나로 정해지고, 지연이 0이면 그 시각의 AudioContext 시간과 같다', () => {
    const c = new HeardClock();
    expect(c.isReady).toBe(false);
    c.feed({ contextSec: 3, perfMs: 7000 });
    expect(c.heardContextSec(7000)).toBeCloseTo(3, 9);
    expect(c.heardContextSec(7500)).toBeCloseTo(3.5, 9);
  });

  it('흔들리는 표본은 부드럽게 다듬는다(평균 근처로 모인다)', () => {
    const c = new HeardClock();
    c.feed({ contextSec: 1, perfMs: 1000 });
    for (let i = 0; i < 200; i++) c.feed({ contextSec: 1 + (i % 2 === 0 ? 0.01 : -0.01), perfMs: 1000 });
    expect(Math.abs(c.heardContextSec(1000) - 1)).toBeLessThan(0.004);
  });

  it('직전 대비 50ms 이상 튀는 값은 버리고, 연속으로 들어오면 실제 변화로 받아들인다', () => {
    const c = new HeardClock();
    c.feed({ contextSec: 1, perfMs: 1000 });
    expect(c.feed({ contextSec: 1.2, perfMs: 1000 })).toBe('rejected');
    expect(c.heardContextSec(1000)).toBeCloseTo(1, 9);
    for (let i = 1; i < HEARD_CLOCK_CONFIG.forceAcceptAfter - 1; i++) c.feed({ contextSec: 1.2, perfMs: 1000 });
    expect(c.feed({ contextSec: 1.2, perfMs: 1000 })).toBe('forced');
    expect(c.heardContextSec(1000)).toBeCloseTo(1.2, 9);
  });

  it('곡 시간은 뒤로 가지 않는다', () => {
    const m = new NeverBackwards();
    expect(m.next(100)).toBe(100);
    expect(m.next(90)).toBe(100);
    expect(m.next(120)).toBe(120);
    m.reset();
    expect(m.next(50)).toBe(50);
  });

  it('대체 경로: 출력 시각이 없거나 0이면 currentTime − 출력 지연을 쓴다', () => {
    expect(pickHeardSample(undefined, 2, 2000, 0.15)).toEqual({ contextSec: 1.85, perfMs: 2000 });
    expect(pickHeardSample({ contextTime: 0, performanceTime: 0 }, 2, 2000, 0)).toEqual({ contextSec: 2, perfMs: 2000 });
    expect(pickHeardSample({ contextTime: 1.7, performanceTime: 1999 }, 2, 2000, 0.15)).toEqual({ contextSec: 1.7, perfMs: 1999 });
  });
});

describe('재생기: 화면과 판정이 같은 들리는 시계를 쓴다', () => {
  it('지연이 0이면 예전 방식(currentTime 기준)과 같은 곡 시간', () => {
    const { ctx, advance, state } = fakeContext(0);
    const p = makePlayer(ctx);
    void p.startAt(0);
    advance(1.1);
    const old = songMsFromContext(state.currentTime, 1.1, 1, 0);
    expect(p.nowSongMs()).toBeCloseTo(old, 3);
    expect(p.inputEventToSongMs(state.perf)).toBeCloseTo(old, 3);
  });

  it('지연이 200ms면 화면과 판정이 같은 값(= 예전보다 200ms 늦은 "들리는" 곡 시간)', async () => {
    const { ctx, advance, state } = fakeContext(0.2);
    const p = makePlayer(ctx);
    await p.startAt(0);
    advance(1.1);
    const heard = 1000 - 200; // 시작 후 1초 지점에서 귀에 들리는 곡 시간
    expect(p.nowSongMs()).toBeCloseTo(heard, 2);
    expect(p.inputEventToSongMs(state.perf)).toBeCloseTo(p.nowSongMs(), 2);
    expect(p.outputDelayMs()).toBeCloseTo(200, 0);
  });

  it('입력 보정(inputDelayMs)은 판정에만 그대로 더해진다(−500~+500)', async () => {
    const { ctx, advance, state } = fakeContext(0);
    const timing = { audioStartOffsetMs: 0, inputDelayMs: 0 };
    const p = new SegmentPlayer(ctx, { duration: 10 } as AudioBuffer, timing as never, 1, 1);
    await p.startAt(0);
    advance(1.1);
    const base = p.inputEventToSongMs(state.perf);
    p.setInputDelay(450);
    expect(p.inputEventToSongMs(state.perf)).toBeCloseTo(base - 450, 3);
    p.setInputDelay(-500);
    expect(p.inputEventToSongMs(state.perf)).toBeCloseTo(base + 500, 3);
  });

  it('getOutputTimestamp 가 없으면 currentTime − outputLatency 로 대신한다', async () => {
    const { ctx, advance, state } = fakeContext(0.1, false);
    const p = makePlayer(ctx);
    await p.startAt(0);
    advance(1.1);
    expect(p.nowSongMs()).toBeCloseTo(1000 - 100, 2);
    expect(p.inputEventToSongMs(state.perf)).toBeCloseTo(900, 2);
  });
});

describe('[싱크 맞추기] 계산', () => {
  /** 박마다 같은 차이를 만든다 */
  const evenOffsets = (value: number): Array<number | null> => Array.from({ length: SYNC_CONFIG.beats }, () => value);

  it('누른 시각 − 박자 시각이 가장 가까운 박에 붙는다(범위 밖은 null)', () => {
    const m = matchPress(10 + 3 * BEAT_INTERVAL_SEC + 0.05, 10);
    expect(m?.index).toBe(3);
    expect(m?.offsetMs).toBeCloseTo(50, 6);
    expect(matchPress(10 - 0.9, 10)).toBeNull();
    expect(matchPress(10 + SYNC_CONFIG.beats * BEAT_INTERVAL_SEC + 0.2, 10)).toBeNull();
  });

  it('중앙값을 제안한다(앞 4번은 버린다)', () => {
    const offsets = evenOffsets(180);
    for (let i = 0; i < SYNC_CONFIG.skip; i++) offsets[i] = -250; // 연습 구간의 튀는 값은 무시
    const r = computeCalibration(offsets);
    expect(r.ok).toBe(true);
    expect(r.suggestionMs).toBe(180);
    expect(r.used).toBe(SYNC_CONFIG.beats - SYNC_CONFIG.skip);
  });

  it('조금 흩어져도 중앙값이 이상값에 끌려가지 않는다', () => {
    const offsets = evenOffsets(120).map((v, i) => (i === 7 ? 280 : (v ?? 0) + (i % 3) * 4));
    const r = computeCalibration(offsets);
    expect(r.ok).toBe(true);
    expect(Math.abs((r.suggestionMs ?? 0) - 124)).toBeLessThan(10);
  });

  it('흩어짐(사분위 범위)이 크면 "고르지 않습니다"', () => {
    const offsets = evenOffsets(0).map((_, i) => (i % 2 === 0 ? -150 : 150));
    const r = computeCalibration(offsets);
    expect(r.ok).toBe(false);
    expect(r.suggestionMs).toBeNull();
    expect(r.message).toContain('고르지 않습니다');
  });

  it('누른 횟수가 너무 적으면 다시 하라고 안내한다', () => {
    const offsets: Array<number | null> = evenOffsets(10).map((v, i) => (i < SYNC_CONFIG.skip + 3 ? v : null));
    const r = computeCalibration(offsets);
    expect(r.ok).toBe(false);
    expect(r.used).toBe(3);
  });

  it('박 사이 한가운데(±500ms 근처)에 몰린 값도 한 덩어리로 본다', () => {
    const wrapped = [490, -495, 485, -490, 492, -488, 491, -493];
    const centered = recenter(wrapped);
    const spread = Math.max(...centered) - Math.min(...centered);
    expect(spread).toBeLessThan(40);
  });

  it('60BPM: 박 간격 1000ms, 누름은 가장 가까운 박에 붙고 ±500ms 어긋남까지 계산한다', () => {
    expect(SYNC_CONFIG.bpm).toBe(60);
    expect(BEAT_INTERVAL_SEC).toBe(1);
    const late = matchPress(10 + 5 + 0.42, 10); // 5번째 박보다 420ms 늦게 누름
    expect(late?.index).toBe(5);
    expect(late?.offsetMs).toBeCloseTo(420, 6);
    const early = matchPress(10 + 7 - 0.45, 10); // 7번째 박보다 450ms 빨리 누름 = 6번째 박보다 550ms 늦음으로 읽히지 않고 7번째 박에 붙음
    expect(early?.index).toBe(7);
    expect(early?.offsetMs).toBeCloseTo(-450, 6);
    const offsets = Array.from({ length: SYNC_CONFIG.beats }, (_, i) => (i < SYNC_CONFIG.skip ? 0 : 420 + (i % 2) * 6));
    const r = computeCalibration(offsets);
    expect(r.ok).toBe(true);
    expect(r.suggestionMs).toBe(423);
  });

  it('보정값 범위는 −500~+500ms 정수', () => {
    expect(clampDelayMs(9999)).toBe(500);
    expect(clampDelayMs(-9999)).toBe(-500);
    expect(clampDelayMs(12.6)).toBe(13);
    expect(clampDelayMs(Number.NaN, 7)).toBe(7);
  });

  it('최근 판정 평균', () => {
    expect(recentMeanMs([])).toBeNull();
    expect(recentMeanMs([-20, 10, 40])).toBeCloseTo(10, 6);
  });
});
