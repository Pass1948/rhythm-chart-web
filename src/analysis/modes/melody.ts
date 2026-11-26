/**
 * 멜로디 중심 모드(근사): HPSS 로 '화음 성분'만 남기고, 거기서 음높이(크로마 12음)가 바뀌는 순간과
 * 화음 스펙트럼이 새로 시작되는 순간을 찾는다. 타악 성분이 강한 프레임은 줄인다.
 */
import { BINS, binHz } from './stft.ts';
import { APPROX_NOTICE, MELODY } from './modeConfig.ts';
import { runHpss } from './hpss.ts';
import { buildCandidates, scaleOf } from './candidates.ts';
import { progressInRange } from './drums.ts';
import type { ModeContext } from '../modeRegistry.ts';
import { percentile } from '../dsp.ts';
import { ANALYSIS_SR } from '../prepare.ts';
import type { Candidate } from '../types.ts';

/** 빈 → 음 이름(0~11, 도=0) 표. 사용하지 않는 빈은 -1 */
function buildPitchClassTable(): Int8Array {
  const table = new Int8Array(BINS).fill(-1);
  for (let k = 0; k < BINS; k++) {
    const f = binHz(k, ANALYSIS_SR);
    if (f < MELODY.chromaHz[0] || f >= MELODY.chromaHz[1]) continue;
    const semis = Math.round(12 * Math.log2(f / 261.6256)); // 가운데 도 기준
    table[k] = ((semis % 12) + 12) % 12;
  }
  return table;
}

/** 멜로디 중심 후보 만들기 */
export function detectMelody(ctx: ModeContext): { candidates: Candidate[]; warnings: string[] } {
  const y = ctx.samples;
  const frames = ctx.features.frames;
  const pc = buildPitchClassTable();
  const lag = MELODY.fluxLag;
  const gamma = MELODY.logGamma;

  const chroma = new Float32Array(frames * 12); // 프레임마다 12음 크기(합이 1이 되게 나눈 값)
  const harmE = new Float32Array(frames); // 화음 성분 에너지(크로마 대역)
  const percE = new Float32Array(frames); // 타악 성분 에너지(크로마 대역)
  const flux = new Float32Array(frames); // 화음 성분의 스펙트럼 변화(로그 압축, 늘어난 양)
  const ring = Array.from({ length: lag + 1 }, () => new Float32Array(BINS));
  const report = progressInRange(ctx, 0.86, 0.97, '타악·화음 나누는 중');

  runHpss(
    y,
    (f) => {
      const cur = ring[f.t % (lag + 1)]!;
      const prev = ring[Math.max(0, f.t - lag) % (lag + 1)]!;
      const row = f.t * 12;
      let sum = 0;
      let eh = 0;
      let ep = 0;
      let fl = 0;
      for (let k = 0; k < BINS; k++) {
        const p = pc[k]!;
        cur[k] = Math.log1p(gamma * f.harm[k]!);
        if (p < 0) continue;
        const h = f.harm[k]!;
        chroma[row + p]! += h;
        sum += h;
        eh += h * h;
        ep += f.perc[k]! * f.perc[k]!;
        const d = cur[k]! - prev[k]!;
        if (d > 0) fl += d;
      }
      if (sum > 1e-9) for (let i = 0; i < 12; i++) chroma[row + i]! /= sum;
      harmE[f.t] = eh;
      percE[f.t] = ep;
      flux[f.t] = fl;
    },
    report,
    ctx.signal,
  );

  // 소리가 거의 없는 프레임은 크로마가 잡음이라서, 화음 에너지 기준값(상위 75%)과 견줘 약하게 만든다
  const eRef = Math.max(percentile(harmE, 75), 1e-12);
  const fluxScale = scaleOf(flux);
  const span = MELODY.chromaSpan;
  const novelty = new Float32Array(frames);
  for (let t = 0; t < frames; t++) {
    // 크로마 변화: 뒤 span 프레임 평균 − 앞 span 프레임 평균 (L1 거리의 절반, 0~1)
    let dist = 0;
    for (let i = 0; i < 12; i++) {
      let after = 0;
      let before = 0;
      for (let s = 1; s <= span; s++) {
        after += chroma[Math.min(frames - 1, t + s) * 12 + i]!;
        before += chroma[Math.max(0, t - s) * 12 + i]!;
      }
      dist += Math.abs(after - before) / span;
    }
    const chromaChange = 0.5 * dist;
    const gate = Math.min(1, harmE[t]! / (MELODY.gateRatio * eRef));
    const raw = MELODY.weightChroma * chromaChange * gate + MELODY.weightFlux * (flux[t]! / fluxScale);
    // 타악 비율이 높은 프레임은 줄인다
    const pr = percE[t]! / (percE[t]! + harmE[t]! + 1e-12);
    let suppress = 1;
    if (pr > MELODY.percLow) {
      const x = Math.min(1, (pr - MELODY.percLow) / (MELODY.percHigh - MELODY.percLow));
      suppress = 1 - (1 - MELODY.percFloor) * x;
    }
    novelty[t] = raw * suppress;
  }
  ctx.report(0.98, '노트 후보를 정리하는 중');
  const candidates = buildCandidates({
    refineSignal: y,
    rawNovelty: novelty,
    sensitivity: ctx.options.sensitivity,
    minGapMs: ctx.options.minGapMs,
    features: ctx.features,
    refineBackMs: MELODY.refineBackMs,
    refineFwdMs: MELODY.refineFwdMs,
  });
  return { candidates, warnings: [APPROX_NOTICE] };
}
