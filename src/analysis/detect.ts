/**
 * ③ 노트 후보 검출: 특징값 계산 → 정규화 → 피크 선택 (+ 시작 지점 보정, 대역, 지속시간).
 * 원본 detect.py 를 브라우저용으로 옮겼다(같은 상수·같은 규칙).
 * - 프레임 간격 약 5ms, 피크 포물선 보간으로 프레임 사이 정밀도 확보
 * - 온셋 시각을 '프레임 중심/피크'가 아니라 '소리가 커지기 시작하는 지점'으로 보정
 * - 민감도·최소 간격 변경은 피크 재선택만 다시 한다(특징값은 따로 보관해 재사용 가능)
 * librosa.stft 대신 직접 만든 FFT(dsp.ts)를 쓴다. 한 번에 프레임 2개를 FFT 1번으로 계산해 속도를 높였다.
 */
import { Fft, biquadFilter, butterHigh2, butterLow2, hannWindow, percentile, throwIfAborted } from './dsp.ts';
import { ANALYSIS_SR } from './prepare.ts';
import { BANDS, BASE_DETECTORS } from './types.ts';
import type { Band, Candidate, DetectorId } from './types.ts';
import { pyRound } from '../core/util.ts';

export const SR = ANALYSIS_SR; // 22050
export const N_FFT = 1024; // 창 길이 46ms
export const HOP = 110; // 5ms (110/22050)
export const FPS = SR / HOP; // 약 200.45 프레임/초
const DIFF_LAG = 4; // 변화량을 비교하는 프레임 간격 (약 20ms)
const RMS_LAG = 9; // 음량 증가 비교 간격 (약 45ms)
const LOCAL_MEAN_SEC = 0.23; // 지역 평균 반경
const LOCAL_MEAN_WEIGHT = 0.7;
const LOW_HZ = 250.0;
const HIGH_HZ = 1800.0;
const MIX_SPLIT_HZ = 754.0; // 종합 가중치 경계
const MIN_HZ = 32.0;

/** 특징값 묶음: 검출 방식마다 정규화된 '새 소리 시작 정도' + 대역별 변화량·에너지 */
export interface Features {
  frames: number;
  /** BASE_DETECTORS 순서의 정규화된 검출 함수(프레임마다 하나) */
  novelty: Float32Array[];
  /** [저음, 중음, 고음] 대역별 스펙트럼 변화량 */
  bandFlux: Float32Array[];
  /** [저음, 중음, 고음] 대역별 에너지(dB) */
  envDb: Float32Array[];
}

/** 지역 평균 대비 보정: max(0, 값 − 0.70 × 지역 평균). 오래 이어지는 큰 소리는 줄이고 새로 시작되는 소리만 남긴다. */
export function normalize(v: ArrayLike<number>): Float32Array {
  const n = v.length;
  const radius = Math.max(5, pyRound(LOCAL_MEAN_SEC * FPS));
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + v[i]!;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n, i + radius + 1);
    const local = (prefix[hi]! - prefix[lo]!) / (hi - lo);
    out[i] = Math.max(0, v[i]! - local * LOCAL_MEAN_WEIGHT);
  }
  return out;
}

/** STFT 한 프레임(2개씩 묶어)의 크기 스펙트럼을 계산해 콜백으로 넘기는 도우미 */
class FrameSpectra {
  private fft = new Fft(N_FFT);
  private win = hannWindow(N_FFT);
  private re = new Float64Array(N_FFT);
  private im = new Float64Array(N_FFT);
  readonly bins = N_FFT / 2 + 1;

  /**
   * 프레임 t1, t2 (t2 < 0 이면 하나만)의 크기(|X|)를 outA, outB 에 채운다.
   * 가운데 맞춤(center=True): 프레임 t는 샘플 [t*HOP - 512, t*HOP + 512) 이고 바깥은 0으로 채운다(librosa 1.0 기본).
   */
  compute(y: Float32Array, t1: number, t2: number, outA: Float32Array, outB: Float32Array): void {
    const re = this.re;
    const im = this.im;
    const s1 = t1 * HOP - N_FFT / 2;
    const s2 = t2 * HOP - N_FFT / 2;
    for (let i = 0; i < N_FFT; i++) {
      const a = s1 + i;
      const b = s2 + i;
      const w = this.win[i]!;
      re[i] = a >= 0 && a < y.length ? y[a]! * w : 0;
      im[i] = t2 >= 0 && b >= 0 && b < y.length ? y[b]! * w : 0;
    }
    this.fft.transform(re, im);
    const n = N_FFT;
    for (let k = 0; k < this.bins; k++) {
      const kk = (n - k) % n;
      // 실수 신호 2개를 합친 FFT에서 각각의 스펙트럼을 분리한다
      const ar = 0.5 * (re[k]! + re[kk]!);
      const ai = 0.5 * (im[k]! - im[kk]!);
      outA[k] = Math.hypot(ar, ai);
      if (t2 >= 0) {
        const br = 0.5 * (im[k]! + im[kk]!);
        const bi = -0.5 * (re[k]! - re[kk]!);
        outB[k] = Math.hypot(br, bi);
      }
    }
  }
}

/** STFT에서 5종 검출 함수(정규화 전→후)와 대역별 변화량·에너지를 한 번에 계산한다. */
export function computeFeatures(y22: Float32Array, onProgress?: (frac: number) => void, signal?: AbortSignal): Features {
  const it = computeFeaturesSteps(y22, onProgress, signal);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/**
 * computeFeatures 의 조각 나눠 실행 버전(05단계): Web Worker 를 못 쓰는 환경에서 화면 스레드가 멈추지 않게,
 * 일정 프레임마다 await yielder() 로 화면에 숨 쉴 틈을 준다. 결과는 computeFeatures 와 완전히 같다.
 */
export async function computeFeaturesAsync(
  y22: Float32Array,
  yielder: () => Promise<void>,
  onProgress?: (frac: number) => void,
  signal?: AbortSignal,
): Promise<Features> {
  const it = computeFeaturesSteps(y22, onProgress, signal);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    await yielder();
  }
}

/** 실제 계산 본체(제너레이터). 512 프레임마다 한 번 yield 한다. */
function* computeFeaturesSteps(y22: Float32Array, onProgress?: (frac: number) => void, signal?: AbortSignal): Generator<void, Features, void> {
  const frames = 1 + Math.floor(y22.length / HOP);
  const bins = N_FFT / 2 + 1;
  const freq = new Float64Array(bins);
  for (let k = 0; k < bins; k++) freq[k] = (k * SR) / N_FFT;
  const wMix = new Float64Array(bins);
  const wBass = new Float64Array(bins);
  const wTreble = new Float64Array(bins);
  const bandOf = new Int8Array(bins); // -1: 쓰지 않음, 0 저음 1 중음 2 고음
  for (let k = 0; k < bins; k++) {
    const f = freq[k]!;
    const valid = f >= MIN_HZ;
    wMix[k] = (f < MIX_SPLIT_HZ ? 1.0 : 0.55) * (valid ? 1 : 0);
    wBass[k] = f <= LOW_HZ && valid ? 1 : 0;
    wTreble[k] = f >= HIGH_HZ ? 1 : 0;
    bandOf[k] = f < LOW_HZ && valid ? 0 : f >= LOW_HZ && f < HIGH_HZ ? 1 : f >= HIGH_HZ ? 2 : -1;
  }

  const fluxMix = new Float32Array(frames);
  const fluxBass = new Float32Array(frames);
  const fluxTreble = new Float32Array(frames);
  const bandFlux = [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)];
  const envDb = [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)];

  // 최근 DIFF_LAG+1 프레임의 크기 스펙트럼만 돌려 쓰며 보관한다(전체를 저장하지 않아 메모리가 적게 든다)
  const ringSize = DIFF_LAG + 2;
  const ring: Float32Array[] = Array.from({ length: ringSize }, () => new Float32Array(bins));
  const spectra = new FrameSpectra();
  const spare = new Float32Array(bins);
  const firstMag = new Float32Array(bins); // 프레임 0 (앞쪽 프레임이 비교 대상일 때)
  const bandAcc = [0, 0, 0];
  const bandPow = [0, 0, 0];

  const handle = (t: number, cur: Float32Array): void => {
    const prev = t - DIFF_LAG <= 0 ? firstMag : ring[(t - DIFF_LAG) % ringSize]!;
    let totMix = 0;
    let totBass = 0;
    let totTreble = 0;
    let dMix = 0;
    let dBass = 0;
    let dTreble = 0;
    bandAcc[0] = bandAcc[1] = bandAcc[2] = 0;
    bandPow[0] = bandPow[1] = bandPow[2] = 0;
    for (let k = 0; k < bins; k++) {
      const c = cur[k]!;
      const d = Math.max(c - prev[k]!, 0);
      totMix += c * wMix[k]!;
      totBass += c * wBass[k]!;
      totTreble += c * wTreble[k]!;
      dMix += d * wMix[k]!;
      dBass += d * wBass[k]!;
      dTreble += d * wTreble[k]!;
      const b = bandOf[k]!;
      if (b >= 0) {
        bandAcc[b]! += d;
        bandPow[b]! += c * c;
      }
    }
    fluxMix[t] = totMix > 1e-8 ? dMix / Math.max(totMix, 1e-8) : 0;
    fluxBass[t] = totBass > 1e-8 ? dBass / Math.max(totBass, 1e-8) : 0;
    fluxTreble[t] = totTreble > 1e-8 ? dTreble / Math.max(totTreble, 1e-8) : 0;
    for (let b = 0; b < 3; b++) {
      bandFlux[b]![t] = bandAcc[b]!;
      envDb[b]![t] = 10.0 * Math.log10(bandPow[b]! + 1e-10);
    }
  };

  const bufA = new Float32Array(bins);
  const bufB = new Float32Array(bins);
  for (let t = 0; t < frames; t += 2) {
    if ((t & 0x1ff) === 0) {
      throwIfAborted(signal);
      onProgress?.(t / frames);
      if (t > 0) yield;
    }
    const hasSecond = t + 1 < frames;
    spectra.compute(y22, t, hasSecond ? t + 1 : -1, bufA, bufB);
    ring[t % ringSize]!.set(bufA);
    if (t === 0) firstMag.set(bufA);
    handle(t, ring[t % ringSize]!);
    if (hasSecond) {
      ring[(t + 1) % ringSize]!.set(bufB);
      handle(t + 1, ring[(t + 1) % ringSize]!);
    }
  }
  void spare;

  // 음량 변화 (RMS 증가분). librosa.feature.rms(center=True): 앞뒤를 0으로 채운 1024 구간의 제곱 평균의 제곱근
  const prefix = new Float64Array(y22.length + 1);
  for (let i = 0; i < y22.length; i++) prefix[i + 1] = prefix[i]! + y22[i]! * y22[i]!;
  const rms = new Float32Array(frames);
  let rmsMax = 0;
  for (let t = 0; t < frames; t++) {
    const a = Math.max(0, t * HOP - N_FFT / 2);
    const b = Math.min(y22.length, t * HOP + N_FFT / 2);
    rms[t] = Math.sqrt(Math.max(0, prefix[b]! - prefix[a]!) / N_FFT);
    if (rms[t]! > rmsMax) rmsMax = rms[t]!;
  }
  const rise = new Float32Array(frames);
  const denom = Math.max(rmsMax, 1e-8);
  for (let t = 0; t < frames; t++) {
    const p = Math.max(t - RMS_LAG, 0);
    rise[t] = Math.max(0, rms[t]! - rms[p]!) / denom;
  }

  const hybrid = new Float32Array(frames);
  for (let t = 0; t < frames; t++) hybrid[t] = 0.75 * fluxMix[t]! + 0.25 * rise[t]!; // 종합
  const raw: Record<string, Float32Array> = { hybrid, flux: fluxMix, bass: fluxBass, treble: fluxTreble, energy: rise };
  const novelty = BASE_DETECTORS.map((name) => normalize(raw[name]!));
  onProgress?.(1);
  return { frames, novelty, bandFlux, envDb };
}

/** 피크 선택 결과: [프레임 위치(소수, 포물선 보간), 값] */
export type Peak = [number, number];

/** 피크 선택. 민감도·최소 간격만 바꿔 다시 부를 수 있다. */
export function pickPeaks(novelty: ArrayLike<number>, sensitivity = 60, minGapMs = 75.0): Peak[] {
  const n = novelty.length;
  const v = Float64Array.from(novelty as ArrayLike<number>);
  let any = false;
  for (let i = 0; i < n; i++) {
    if (v[i]! > 0) {
      any = true;
      break;
    }
  }
  if (n < 10 || !any) return [];
  const p75 = percentile(v, 75);
  const p92 = percentile(v, 92);
  const threshold = p75 + (p92 - p75) * (1 - sensitivity / 100.0) * 0.8;
  const w = Math.max(2, pyRound(0.03 * FPS)); // 앞뒤 30ms 안에서 최댓값
  const avgR = pyRound(0.3 * FPS); // 앞뒤 0.3초 평균과 비교
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + v[i]!;
  const ratio = 1.05 + (100 - sensitivity) * 0.005;
  const sep = Math.max(2, pyRound((minGapMs / 1000.0) * FPS));
  const at = (i: number): number => (i >= 0 && i < n ? v[i]! : 0);
  const peaks: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (v[i]! < threshold) continue;
    // 지역 최댓값: 앞뒤 w 프레임(바깥은 0) 중 최대이고, 양옆(원형 이웃 포함)보다 크거나 같다
    let wmax = 0;
    for (let k = -w; k <= w; k++) wmax = Math.max(wmax, at(i + k));
    const prevV = v[(i - 1 + n) % n]!; // numpy.roll 과 같은 원형 이웃
    const nextV = v[(i + 1) % n]!;
    if (!(v[i]! >= wmax && v[i]! > prevV && v[i]! >= nextV)) continue;
    if (i < 2 || i > n - 3) continue;
    const lo = Math.max(0, i - avgR);
    const hi = Math.min(n, i + avgR + 1);
    if (v[i]! < ((prefix[hi]! - prefix[lo]!) / (hi - lo)) * ratio) continue;
    const last = peaks[peaks.length - 1];
    if (last && i - last[0] < sep) {
      if (v[i]! > last[1]) peaks[peaks.length - 1] = [i, v[i]!];
      continue;
    }
    peaks.push([i, v[i]!]);
  }
  return peaks.map(([i, val]) => {
    const y0 = v[i - 1]!;
    const y1 = v[i]!;
    const y2 = v[i + 1]!;
    const denom = y0 - 2 * y1 + y2;
    const delta = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0.0;
    return [i + Math.min(0.5, Math.max(-0.5, delta)), val] as Peak;
  });
}

/** 시작 지점 보정용 대역 필터 (저음: 낮은 소리만, 고음: 높은 소리만). 종합 계열은 필터 없음. */
function bandFilter(y22: Float32Array, kind: string): Float32Array {
  if (kind === 'bass') return biquadFilter(y22, butterLow2(300.0, SR));
  if (kind === 'treble') return biquadFilter(y22, butterHigh2(1500.0, SR));
  return y22;
}

/**
 * 온셋 시각을 '피크'에서 '소리가 커지기 시작하는 지점'으로 되돌린다.
 * 방법: 피크 앞 backMs ~ 뒤 fwdMs 구간의 짧은(약 2ms) 에너지 포락선을 만들고, 구간 최대점에서 거꾸로 거슬러 올라가
 * 포락선이 (바닥 + 15% × (최대 − 바닥)) 아래로 내려가는 첫 지점을 시작 지점으로 한다.
 */
export function refineOnsetTimes(y22: Float32Array, peakTimesMs: number[], detector: string, backMs = 45.0, fwdMs = 30.0, riseLevel = 0.15): number[] {
  const yf = bandFilter(y22, detector);
  const smooth = Math.max(1, pyRound(0.002 * SR)); // 44
  const len = yf.length;
  // numpy.convolve(power, ones(smooth)/smooth, 'same'): 위치 i 는 [i - smooth/2 .. i + smooth/2 - 1] 평균 (바깥은 0)
  const halfBack = Math.floor((smooth - 1) / 2) + 0; // 21
  const envAtRange = (a: number, b: number): Float64Array => {
    const out = new Float64Array(b - a);
    // 합 구간: [i - (smooth-1-halfBack), i + halfBack]
    const lead = smooth - 1 - halfBack; // 뒤쪽 길이(과거 방향)
    let sum = 0;
    const p = (idx: number): number => (idx >= 0 && idx < len ? yf[idx]! * yf[idx]! : 0);
    for (let j = a - lead; j <= a + halfBack; j++) sum += p(j);
    for (let i = a; i < b; i++) {
      out[i - a] = Math.sqrt(Math.max(sum, 0) / smooth);
      sum += p(i + 1 + halfBack) - p(i - lead);
    }
    return out;
  };
  const out: number[] = [];
  for (const t of peakTimesMs) {
    const center = pyRound((t / 1000.0) * SR);
    const a = Math.max(0, center - Math.trunc((backMs / 1000.0) * SR));
    const b = Math.min(len, center + Math.trunc((fwdMs / 1000.0) * SR));
    if (b - a < 8) {
      out.push(t);
      continue;
    }
    const seg = envAtRange(a, b);
    let k = 0;
    for (let i = 1; i < seg.length; i++) if (seg[i]! > seg[k]!) k = i; // argmax (처음 최댓값)
    let floor = Infinity;
    for (let i = 0; i <= k; i++) if (seg[i]! < floor) floor = seg[i]!;
    const level = floor + riseLevel * (seg[k]! - floor);
    let j = k;
    while (j > 0 && seg[j]! > level) j -= 1;
    out.push(((a + j) / SR) * 1000.0);
  }
  return out;
}

/** 피크 주변 3개 대역 변화량 중 가장 두드러진 대역(low/mid/high). */
export function classifyBand(bandFlux: Float32Array[], frame: number, scale: number[]): Band {
  const total = bandFlux[0]!.length;
  const lo = Math.max(0, Math.trunc(frame) - 3);
  const hi = Math.min(total, Math.trunc(frame) + 4);
  let best = 0;
  let bestVal = -Infinity;
  for (let b = 0; b < 3; b++) {
    let s = 0;
    for (let i = lo; i < hi; i++) s += bandFlux[b]![i]!;
    s /= scale[b]!;
    if (s > bestVal) {
      bestVal = s;
      best = b;
    }
  }
  return BANDS[best]!;
}

/** 온셋 뒤 해당 대역 에너지가 (처음 40ms 최대치 − dropDb) 이상 유지되고 새 공격이 없는 구간의 길이(ms). */
export function sustainMs(envDbBand: Float32Array, onsetMs: number, nextAttackMs: number | null, dropDb = 10.0, capMs = 6000.0): number {
  const f0 = pyRound((onsetMs / 1000.0) * FPS);
  const n = envDbBand.length;
  if (f0 >= n - 2) return 0.0;
  let peak = -Infinity;
  const pEnd = Math.min(n, f0 + Math.trunc(0.04 * FPS) + 1);
  for (let i = f0; i < pEnd; i++) if (envDbBand[i]! > peak) peak = envDbBand[i]!;
  const limit = Math.min(n, f0 + Math.trunc((capMs / 1000.0) * FPS));
  let endF = limit;
  for (let i = f0; i < limit; i++) {
    if (envDbBand[i]! < peak - dropDb) {
      endF = i;
      break;
    }
  }
  let endMs = (endF / FPS) * 1000.0;
  if (nextAttackMs !== null) endMs = Math.min(endMs, nextAttackMs - 20.0);
  return Math.max(0.0, endMs - onsetMs);
}

/** 특징값에서 피크를 다시 뽑아 후보 목록(Candidate)을 만든다. 소수 자릿수는 원본 analysis.json 과 같게 반올림한다. */
export function selectCandidates(y22: Float32Array, feats: Features, detector: DetectorId, sensitivity = 60, minGapMs = 75.0): Candidate[] {
  const di = (BASE_DETECTORS as readonly string[]).indexOf(detector);
  if (di < 0) throw new Error(`01a 에서는 지원하지 않는 검출 방식입니다: ${detector}`);
  const peaks = pickPeaks(feats.novelty[di]!, sensitivity, minGapMs);
  if (!peaks.length) return [];
  // 새 공격 판정용: 선택된 후보 자신
  const attacks = peaks.map((p) => (p[0] / FPS) * 1000.0);
  const vmax = percentile(peaks.map((p) => p[1]), 99) || 1.0;
  const scale = feats.bandFlux.map((bf) => Math.max(percentile(bf, 90), 1e-6));
  const rawMs = attacks;
  const onsetMs = refineOnsetTimes(y22, rawMs, detector);
  const cands: Candidate[] = [];
  for (let idx = 0; idx < peaks.length; idx++) {
    const [frame, val] = peaks[idx]!;
    const tMs = onsetMs[idx]!;
    const band = classifyBand(feats.bandFlux, frame, scale);
    let nxt: number | null = null;
    for (const a of attacks) {
      if (a > tMs + 60.0) {
        nxt = a;
        break;
      }
    }
    const dur = sustainMs(feats.envDb[BANDS.indexOf(band)]!, tMs, nxt);
    cands.push({
      time_ms: Math.round(tMs * 100) / 100,
      strength: Math.round(Math.min(1.0, val / vmax) * 10000) / 10000,
      band,
      duration_ms: Math.round(dur * 10) / 10,
    });
  }
  return cands;
}
