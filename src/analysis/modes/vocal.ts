/**
 * 보컬 근사 모드: 목소리는 보통 왼쪽·오른쪽에 같은 크기로 들어 있으므로(가운데 위치),
 * 스테레오면 '가운데 성분'((L+R)/2 에서 (L-R)/2 를 뺀 것)만 남기고, 사람 목소리가 많은 300~3400Hz 대역의
 * 스펙트럼 변화와 에너지 증가로 소리 시작 지점을 찾는다. 진짜 보컬 분리가 아니라 근사다.
 * 모노 음원은 가운데 성분을 만들 수 없어서 대역(300~3400Hz)만 쓰고 "정확도가 낮다"는 안내를 남긴다.
 */
import { BINS, CenterSpectrumStream, MonoSpectrumStream, binRange } from './stft.ts';
import type { CenterFrame } from './stft.ts';
import { APPROX_NOTICE, MONO_VOCAL_NOTICE, VOCAL } from './modeConfig.ts';
import { buildCandidates, scaleOf } from './candidates.ts';
import { progressInRange } from './drums.ts';
import type { ModeContext } from '../modeRegistry.ts';
import { biquadFilter, butterHigh2, butterLow2, throwIfAborted } from '../dsp.ts';
import { ANALYSIS_SR } from '../prepare.ts';
import type { AnalyzeOptions, Candidate } from '../types.ts';

/** 스테레오 입력(왼쪽·오른쪽 22050Hz). decodeStereo22k 가 만든다. */
export interface StereoInput {
  left: Float32Array;
  right: Float32Array;
}

/** 모드가 받는 확장 옵션: 보컬 모드는 stereo 가 있으면 가운데 성분을 쓴다. */
export type ModeAnalyzeOptions = AnalyzeOptions & { stereo?: StereoInput | null };

/** 분석 옵션에 스테레오 입력을 붙여 돌려준다(타입 도우미) */
export function withStereo(opts: Partial<AnalyzeOptions>, left: Float32Array, right: Float32Array): Partial<AnalyzeOptions> {
  return { ...opts, stereo: { left, right } } as Partial<AnalyzeOptions>;
}

/** 목소리 대역(300~3400Hz)만 남긴 소리: 시작 지점 보정에 쓴다 */
function bandpassVoice(x: Float32Array): Float32Array {
  const hp = biquadFilter(x, butterHigh2(VOCAL.bandHz[0], ANALYSIS_SR));
  return biquadFilter(hp, butterLow2(VOCAL.bandHz[1], ANALYSIS_SR));
}

/** 보컬 근사 후보 만들기 */
export function detectVocal(ctx: ModeContext): { candidates: Candidate[]; warnings: string[] } {
  const stereo = (ctx.options as ModeAnalyzeOptions).stereo ?? null;
  const y = ctx.samples;
  const frames = ctx.features.frames;
  const [from, to] = binRange(VOCAL.bandHz, ANALYSIS_SR);
  const lag = VOCAL.lag;
  const gamma = VOCAL.logGamma;
  const ring = Array.from({ length: lag + 1 }, () => new Float32Array(BINS));
  const flux = new Float32Array(frames);
  const bandDb = new Float32Array(frames);
  const report = progressInRange(ctx, 0.86, 0.97, '가운데 소리 뽑는 중');
  let midSum = 0;
  let sideSum = 0;
  let stereoUsed = false;
  let refineSource = y;

  /** 한 프레임에서 대역 변화량·에너지를 잰다 */
  const handle = (t: number, mag: Float32Array): void => {
    const cur = ring[t % (lag + 1)]!;
    const prev = ring[Math.max(0, t - lag) % (lag + 1)]!;
    let fl = 0;
    let pow = 0;
    for (let k = 0; k < BINS; k++) cur[k] = Math.log1p(gamma * mag[k]!);
    for (let k = from; k < to; k++) {
      const d = cur[k]! - prev[k]!;
      if (d > 0) fl += d;
      pow += mag[k]! * mag[k]!;
    }
    flux[t] = fl;
    bandDb[t] = 10 * Math.log10(pow + 1e-10);
  };

  if (stereo && stereo.left.length === y.length) {
    const stream = new CenterSpectrumStream(stereo.left, stereo.right, VOCAL.sideSuppress);
    const frame: CenterFrame = { center: new Float32Array(BINS), midEnergy: 0, sideEnergy: 0 };
    for (let t = 0; stream.read(frame); t++) {
      if ((t & 0x1ff) === 0) {
        throwIfAborted(ctx.signal);
        report(t / frames);
      }
      handle(t, frame.center);
      midSum += frame.midEnergy;
      sideSum += frame.sideEnergy;
    }
    stereoUsed = midSum > 0 && sideSum / midSum >= VOCAL.monoSideRatio;
    // 시작 지점 보정용: 가운데 소리((L+R)/2)의 목소리 대역
    const mid = new Float32Array(y.length);
    for (let i = 0; i < mid.length; i++) mid[i] = 0.5 * (stereo.left[i]! + stereo.right[i]!);
    refineSource = bandpassVoice(mid);
  } else {
    const stream = new MonoSpectrumStream(y);
    const mag = new Float32Array(BINS);
    for (let t = 0; stream.read(mag); t++) {
      if ((t & 0x1ff) === 0) {
        throwIfAborted(ctx.signal);
        report(t / frames);
      }
      handle(t, mag);
    }
    refineSource = bandpassVoice(y);
  }
  report(1);

  const fluxScale = scaleOf(flux);
  const novelty = new Float32Array(frames);
  for (let t = 0; t < frames; t++) {
    const rise = Math.min(1, Math.max(0, bandDb[t]! - bandDb[Math.max(0, t - VOCAL.riseLag)]!) / VOCAL.riseDb);
    novelty[t] = VOCAL.weightFlux * (flux[t]! / fluxScale) + VOCAL.weightRise * rise * VOCAL.riseGain;
  }
  ctx.report(0.98, '노트 후보를 정리하는 중');
  const candidates = buildCandidates({
    refineSignal: refineSource,
    rawNovelty: novelty,
    sensitivity: ctx.options.sensitivity,
    minGapMs: ctx.options.minGapMs,
    features: ctx.features,
    forceBand: 'mid',
    refineBackMs: VOCAL.refineBackMs,
    refineFwdMs: VOCAL.refineFwdMs,
  });
  const warnings = [APPROX_NOTICE];
  if (!stereoUsed) warnings.push(MONO_VOCAL_NOTICE);
  return { candidates, warnings };
}
