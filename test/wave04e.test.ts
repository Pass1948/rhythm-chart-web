/**
 * 04e 단위 테스트: 음원 파형 데이터(길이·범위·용량·대역 분리)와 파형 띠 그리기 계산(정렬·대칭·색). 테스트 음원은 모두 코드로 합성한 소리다.
 */
import { describe, expect, it } from 'vitest';
import { WAVE_CHANNELS, WAVE_HOP_MS, computeWave, isValidWave, waveFrameCount } from '../src/analysis/wave.ts';
// @ts-ignore 편집기 쪽 JS(타입 검사 제외 대상)
import { ampOf, fillWavePixels, mixBandColor, stripWidth, valueInRange, waveColors } from '../src/editor/js/wave_strip.js';

const SR = 22050;

function sine(hz: number, seconds: number, amp = 0.5): Float32Array {
  const y = new Float32Array(Math.floor(seconds * SR));
  for (let i = 0; i < y.length; i++) y[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return y;
}

/** 프레임 범위의 채널별 평균 */
function avg(w: { data: Uint8Array }, from: number, to: number): number[] {
  const out = [0, 0, 0, 0];
  for (let f = from; f < to; f++) for (let c = 0; c < 4; c++) out[c]! += w.data[f * 4 + c]!;
  return out.map((v) => v / (to - from));
}

describe('파형 데이터(wave)', () => {
  it('길이·범위가 맞고, 4분 곡도 곡당 50KB 이하', async () => {
    const y = sine(440, 240);
    const w = await computeWave(y, SR);
    expect(w.hop_ms).toBe(WAVE_HOP_MS);
    expect(w.frames).toBe(waveFrameCount(y.length, SR));
    expect(w.frames).toBe(12000); // 240초 ÷ 20ms
    expect(w.data.length).toBe(w.frames * WAVE_CHANNELS);
    expect(w.data).toBeInstanceOf(Uint8Array);
    expect(w.data.length).toBeLessThanOrEqual(50 * 1024);
    expect(isValidWave(w)).toBe(true);
    expect(isValidWave({ ...w, data: new Uint8Array(3) })).toBe(false);
    // 진폭 0.5 의 사인파: 전체 크기 약 128
    expect(Math.abs(avg(w, 100, 200)[0]! - 127.5)).toBeLessThan(6);
  }, 30000);

  it('저음·중음·고음이 합성 사인파(100Hz / 1kHz / 5kHz)에서 맞는 대역에 가장 크게 나온다', async () => {
    const dominant = async (hz: number): Promise<number> => {
      const w = await computeWave(sine(hz, 3), SR);
      const a = avg(w, 50, 140);
      const bands = [a[1]!, a[2]!, a[3]!];
      return bands.indexOf(Math.max(...bands));
    };
    expect(await dominant(100)).toBe(0);
    expect(await dominant(1000)).toBe(1);
    expect(await dominant(5000)).toBe(2);
    // 다른 대역은 훨씬 작다(100Hz 는 중음·고음이 절반 이하)
    const w100 = avg(await computeWave(sine(100, 3), SR), 50, 140);
    expect(w100[2]!).toBeLessThan(w100[1]! * 0.5);
    expect(w100[3]!).toBeLessThan(w100[1]! * 0.1);
    const w5k = avg(await computeWave(sine(5000, 3), SR), 50, 140);
    expect(w5k[1]!).toBeLessThan(w5k[3]! * 0.1);
  });

  it('무음은 0, 소리가 있는 시각에서만 커진다', async () => {
    expect(Math.max(...(await computeWave(new Float32Array(SR * 2), SR)).data)).toBe(0);
    const y = new Float32Array(SR * 4);
    for (let i = 0; i < 4000; i++) y[2 * SR + i] = 0.8 * Math.sin((2 * Math.PI * 200 * i) / SR);
    const w = await computeWave(y, SR);
    let best = 0;
    for (let f = 0; f < w.frames; f++) if (w.data[f * 4]! > w.data[best * 4]!) best = f;
    expect(Math.abs(best * w.hop_ms - 2000)).toBeLessThan(60);
    expect(w.data[10 * 4]).toBe(0);
  });
});

describe('파형 띠 그리기 계산', () => {
  const colors = waveColors('#ff9a3d', '#3fd6a0', '#8fd8ff', '#161618');
  const mk = (frames: number, fn: (f: number) => [number, number, number, number]) => {
    const data = new Uint8Array(frames * 4);
    for (let f = 0; f < frames; f++) data.set(fn(f), f * 4);
    return { version: 1 as const, hop_ms: 20, frames, data };
  };

  it('소리 위치가 타임라인 y 좌표(msOfY)와 어긋나지 않는다 (보기 3가지)', () => {
    const PAD_TOP = 14;
    const PAD_BOTTOM = 22;
    const h = 700;
    const innerH = h - PAD_TOP - PAD_BOTTOM;
    const W = 40;
    for (const [start, span] of [[0, 6000], [12345, 3000], [-500, 40000]] as const) {
      const msOfY = (y: number): number => start + ((h - PAD_BOTTOM - y) / innerH) * span;
      const yOfMs = (ms: number): number => h - PAD_BOTTOM - ((ms - start) / span) * innerH;
      const T = start + span * 0.37;
      const f0 = Math.round(T / 20);
      const w = mk(Math.ceil((start + span + 1000) / 20) + 5, (f) => (f === f0 && f >= 0 ? [255, 0, 255, 0] : [0, 0, 0, 0]));
      const rows = Math.round(innerH);
      const out = new Uint8ClampedArray(rows * W * 4);
      fillWavePixels(out, w, W, rows, (r: number) => msOfY(PAD_TOP + (r * innerH) / rows), colors);
      let bright = -1;
      for (let r = 0; r < rows; r++) if (out[(r * W + W / 2) * 4 + 1]! > 150) bright = r;
      expect(bright).toBeGreaterThanOrEqual(0);
      const y = PAD_TOP + ((bright + 0.5) * innerH) / rows;
      expect(Math.abs(y - yOfMs(f0 * 20))).toBeLessThanOrEqual(Math.max(2, (20 / span) * innerH + 1));
    }
  });

  it('가운데 세로선 기준 좌우 대칭이고, 큰 소리는 넓고 작은 소리는 가늘다', () => {
    const w = mk(10, (f) => (f < 5 ? [255, 255, 0, 0] : [30, 30, 0, 0]));
    const W = 40;
    const out = new Uint8ClampedArray(2 * W * 4);
    // 0번 줄 = 100~190ms (프레임 5~9, 작음), 1번 줄 = 10~100ms (프레임 1~5, 큼)
    fillWavePixels(out, w, W, 2, (r: number) => 190 - 90 * r, colors);
    const row = (r: number): number[] => Array.from({ length: W }, (_, x) => out[(r * W + x) * 4 + 3]! && out[(r * W + x) * 4]! + out[(r * W + x) * 4 + 1]! + out[(r * W + x) * 4 + 2]!);
    const bgSum = colors.bg[0] + colors.bg[1] + colors.bg[2];
    const widthOf = (r: number): number => row(r).filter((v) => Math.abs(v - bgSum) > 12).length;
    // 대칭
    for (const r of [0, 1]) {
      const px = row(r);
      for (let x = 0; x < W / 2; x++) expect(px[x]).toBe(px[W - 1 - x]);
    }
    // 큰 소리(255) 줄이 작은 소리(30) 줄보다 넓다
    const wide = widthOf(1);
    const thin = widthOf(0);
    expect(wide).toBeGreaterThan(thin);
    expect(thin).toBeGreaterThan(0);
    expect(wide).toBeGreaterThanOrEqual(W - 2);
    expect(ampOf(30)).toBeGreaterThan(30 / 255); // 제곱근 보정: 작은 소리도 눈에 띈다
  });

  it('저음은 주황, 중음은 초록 계열, 고음은 하늘 계열로 구분된다', () => {
    const low = mixBandColor(200, 5, 5, colors);
    const mid = mixBandColor(5, 200, 5, colors);
    const high = mixBandColor(5, 5, 200, colors);
    expect(low[0]).toBeGreaterThan(low[2] + 40); // 빨강·주황 쪽
    expect(mid[1]).toBeGreaterThan(mid[0] + 40); // 초록 쪽
    expect(high[2]).toBeGreaterThan(high[0] + 40); // 파랑 쪽
    expect(mixBandColor(0, 0, 0, colors)).toEqual(colors.high);
    // 섞이면 중간 색
    const mixed = mixBandColor(100, 100, 0, colors);
    expect(mixed[0]).toBeLessThan(low[0] + 1);
    expect(mixed[1]).toBeGreaterThan(low[1]);
  });

  it('범위 밖은 0, 폭은 화면 폭에 맞춰 좁아진다', () => {
    const w = mk(10, () => [100, 0, 0, 0]);
    expect(valueInRange(w, 0, -5000, -4000)).toBe(0);
    expect(valueInRange(w, 0, 20, 60)).toBe(100);
    expect(stripWidth(1000)).toBe(84);
    expect(stripWidth(400)).toBe(64);
    expect(stripWidth(300)).toBe(44);
  });
});
