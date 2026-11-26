/**
 * 드럼 중심 모드(근사): HPSS 로 '타악 성분'만 남기고, 거기서 소리가 새로 시작되는 지점을 찾는다.
 * 저음(킥)·중음(스네어)·고음(하이햇) 대역의 변화량을 따로 재서 가중치를 곱해 합친다.
 */
import { BINS, binRange } from './stft.ts';
import { APPROX_NOTICE, DRUMS } from './modeConfig.ts';
import { runHpss } from './hpss.ts';
import { buildCandidates, scaleOf } from './candidates.ts';
import type { ModeContext } from '../modeRegistry.ts';
import { ANALYSIS_SR } from '../prepare.ts';
import type { Candidate } from '../types.ts';

/** 모드 진행률을 '0.85~0.99' 구간에 단계 이름과 함께 알리는 도우미 */
export function progressInRange(ctx: ModeContext, from: number, to: number, label: string): (frac: number) => void {
  let last = -1;
  return (frac: number): void => {
    const pct = Math.floor(frac * 100);
    if (pct === last) return;
    last = pct;
    ctx.report(from + (to - from) * frac, `${label} ${pct}%`);
  };
}

/** 드럼 중심 후보 만들기 */
export function detectDrums(ctx: ModeContext): { candidates: Candidate[]; warnings: string[] } {
  const y = ctx.samples;
  const frames = ctx.features.frames;
  const lowR = binRange(DRUMS.lowHz, ANALYSIS_SR);
  const midR = binRange(DRUMS.midHz, ANALYSIS_SR);
  const highR = binRange(DRUMS.highHz, ANALYSIS_SR);
  const ranges = [lowR, midR, highR];
  const lag = DRUMS.lag;

  // 타악 성분을 로그로 눌러 둔 최근 프레임(lag+1 개)을 돌려 쓰며 대역별 '늘어난 양'을 합한다
  const ring = Array.from({ length: lag + 1 }, () => new Float32Array(BINS));
  const flux = [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)];
  const gamma = DRUMS.logGamma;
  const report = progressInRange(ctx, 0.86, 0.97, '타악·화음 나누는 중');

  runHpss(
    y,
    (f) => {
      const cur = ring[f.t % (lag + 1)]!;
      for (let k = 0; k < BINS; k++) cur[k] = Math.log1p(gamma * f.perc[k]!);
      const prev = ring[Math.max(0, f.t - lag) % (lag + 1)]!;
      for (let b = 0; b < 3; b++) {
        const [from, to] = ranges[b]!;
        let sum = 0;
        for (let k = from; k < to; k++) {
          const d = cur[k]! - prev[k]!;
          if (d > 0) sum += d;
        }
        flux[b]![f.t] = sum;
      }
    },
    report,
    ctx.signal,
  );

  // 대역마다 크기가 달라서 상위 90% 값으로 맞춘 뒤 가중치를 곱해 합친다
  const w = [DRUMS.weight.low, DRUMS.weight.mid, DRUMS.weight.high];
  const scales = flux.map((fl) => scaleOf(fl));
  const novelty = new Float32Array(frames);
  for (let t = 0; t < frames; t++) {
    let v = 0;
    for (let b = 0; b < 3; b++) v += (w[b]! * flux[b]![t]!) / scales[b]!;
    novelty[t] = v;
  }
  ctx.report(0.98, '노트 후보를 정리하는 중');
  const candidates = buildCandidates({
    refineSignal: y,
    rawNovelty: novelty,
    sensitivity: ctx.options.sensitivity,
    minGapMs: ctx.options.minGapMs,
    bandFlux: flux,
    features: ctx.features,
    refineBackMs: DRUMS.refineBackMs,
    refineFwdMs: DRUMS.refineFwdMs,
  });
  return { candidates, warnings: [APPROX_NOTICE] };
}
