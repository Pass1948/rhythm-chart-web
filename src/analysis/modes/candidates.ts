/**
 * 모드 공통: '새 소리 시작 정도'(검출 함수)에서 노트 후보 목록을 만든다.
 * 01a 의 selectCandidates 와 같은 순서(피크 선택 → 시작 지점 보정 → 대역 → 지속 시간)를 따르되,
 * 모드가 직접 만든 검출 함수·보정용 소리를 쓸 수 있게 한 것이다. 01a 의 공개 함수만 가져다 쓴다.
 */
import { FPS, classifyBand, normalize, pickPeaks, refineOnsetTimes, sustainMs } from '../detect.ts';
import type { Features } from '../detect.ts';
import { percentile } from '../dsp.ts';
import { BANDS } from '../types.ts';
import type { Band, Candidate } from '../types.ts';

export interface BuildInput {
  /** 시작 지점 보정에 쓸 소리(모드에 맞게 걸러낸 소리여도 된다) */
  refineSignal: Float32Array;
  /** 정규화 전 검출 함수(프레임마다 하나) */
  rawNovelty: ArrayLike<number>;
  sensitivity: number;
  minGapMs: number;
  /** 대역 판정용 [저음, 중음, 고음] 변화량. 없으면 01a 기본 특징값을 쓴다 */
  bandFlux?: Float32Array[];
  /** 지속 시간 계산용 대역 에너지. 없으면 01a 기본 특징값을 쓴다 */
  features: Features;
  /** 모든 후보의 대역을 이 값으로 고정(보컬 등) */
  forceBand?: Band;
  refineBackMs: number;
  refineFwdMs: number;
}

/** 검출 함수 → 후보 목록(시간순). 소수 자릿수는 01a 와 같다. */
export function buildCandidates(inp: BuildInput): Candidate[] {
  const novelty = normalize(inp.rawNovelty);
  const peaks = pickPeaks(novelty, inp.sensitivity, inp.minGapMs);
  if (!peaks.length) return [];
  const attacks = peaks.map((p) => (p[0] / FPS) * 1000.0);
  const vmax = percentile(peaks.map((p) => p[1]), 99) || 1.0;
  const bandFlux = inp.bandFlux ?? inp.features.bandFlux;
  const scale = bandFlux.map((bf) => Math.max(percentile(bf, 90), 1e-6));
  // 'hybrid' 는 대역 필터를 쓰지 않는다는 뜻(보정용 소리를 이미 모드가 걸러 두었다)
  const onsetMs = refineOnsetTimes(inp.refineSignal, attacks, 'hybrid', inp.refineBackMs, inp.refineFwdMs);
  const out: Candidate[] = [];
  for (let idx = 0; idx < peaks.length; idx++) {
    const [frame, val] = peaks[idx]!;
    const tMs = onsetMs[idx]!;
    const band: Band = inp.forceBand ?? classifyBand(bandFlux, frame, scale);
    // 다음 새 공격(현재보다 60ms 이상 뒤)
    let lo = 0;
    let hi = attacks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (attacks[mid]! <= tMs + 60.0) lo = mid + 1;
      else hi = mid;
    }
    const nxt = lo < attacks.length ? attacks[lo]! : null;
    const dur = sustainMs(inp.features.envDb[BANDS.indexOf(band)]!, tMs, nxt);
    out.push({
      time_ms: Math.round(tMs * 100) / 100,
      strength: Math.round(Math.min(1.0, val / vmax) * 10000) / 10000,
      band,
      duration_ms: Math.round(dur * 10) / 10,
    });
  }
  return out;
}

/** 값 배열의 q 백분위(0이면 1로 대신): 대역별 크기를 맞추는 기준으로 쓴다 */
export function scaleOf(values: ArrayLike<number>, q = 90): number {
  const p = percentile(values, q);
  return p > 1e-9 ? p : 1;
}
