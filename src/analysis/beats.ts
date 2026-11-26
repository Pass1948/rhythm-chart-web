/**
 * ② 박자: BPM·첫 박 위치 찾기. (원본 beats.py)
 * 원본은 librosa 박 추적(모델)을 쓰지만, 이 버전은 '소리 시작 강도의 자기상관(템포그램) + 격자 맞춤'으로 대신한다.
 *  - 자기상관으로 박 간격 추정(120BPM 부근을 약간 선호) → 위상(시작점) 찾기 → 박 위치를 따라가며 직선 맞춤(fit_grid)
 *  - fit_grid, bpm_candidates, refine_with_onsets 는 원본과 같은 방식으로 옮겼다.
 * v0.1은 단일 BPM만 만들고, 마디 첫 박 정보는 없다.
 */
import { autocorrelate } from './dsp.ts';
import { FPS } from './detect.ts';
import type { BpmCandidate, Candidate, GridFit } from './types.ts';

export const MIN_BPM = 40.0;
export const MAX_BPM = 300.0;
const START_BPM = 120.0; // 박 간격 추정에서 살짝 더 선호하는 BPM
const PRIOR_OCTAVES = 1.0; // 선호도의 폭(옥타브)
export const CV_WARNING = 0.04; // 박 간격 변동계수가 이 이상이면 템포 변화 경고

export interface BeatsResult {
  bpm: number;
  phase_ms: number;
  librosa_bpm: number;
  beats_ms: number[];
  interval_cv: number | null;
  bpm_candidates: BpmCandidate[];
  warnings: string[];
  has_downbeats: boolean;
}

/** 박 위치를 가장 잘 설명하는 직선 t = 시작 + 박번호 × 간격 을 구한다(최소제곱). 반환 [기울기 b, 절편 a] */
function polyfit1(k: number[], t: number[]): [number, number] {
  const n = k.length;
  let sk = 0;
  let st = 0;
  for (let i = 0; i < n; i++) {
    sk += k[i]!;
    st += t[i]!;
  }
  const mk = sk / n;
  const mt = st / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (k[i]! - mk) * (t[i]! - mt);
    den += (k[i]! - mk) * (k[i]! - mk);
  }
  const b = den > 0 ? num / den : 0;
  return [b, mt - b * mk];
}

function medianOf(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** 파이썬의 a % b (b>0) : 항상 0 이상 */
function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

/** 박 시각들에 직선 t = 시작 + 박번호 × 간격 을 맞춰 정밀 BPM과 첫 박 위상(ms, 0~간격)을 구한다. (원본 fit_grid) */
export function fitGrid(beatsMs: number[], tempo: number): [number, number] {
  if (beatsMs.length < 4) return [tempo, 0.0];
  const period = 60000.0 / tempo;
  const t = beatsMs;
  const k = t.map((x) => Math.round((x - t[0]!) / period));
  let keep = t.map(() => true);
  let a = t[0]!;
  let b = period;
  for (let iter = 0; iter < 3; iter++) {
    const idx = keep.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 4) break;
    [b, a] = polyfit1(
      idx.map((i) => k[i]!),
      idx.map((i) => t[i]!),
    );
    const resid = t.map((x, i) => x - (a + b * k[i]!));
    const med = medianOf(idx.map((i) => Math.abs(resid[i]!)));
    const limit = Math.max(30.0, 3 * med);
    keep = resid.map((r) => Math.abs(r) < limit);
  }
  if (!Number.isFinite(b) || b <= 0) return [tempo, mod(t[0]!, period)];
  return [60000.0 / b, mod(a, b)];
}

/** BPM 후보 목록: 주 후보 + 반 박 + 두 배 박. 신뢰도는 박자 주기에서의 자기상관 세기(0~1). (원본 bpm_candidates) */
export function bpmCandidates(ac: Float64Array, bpm: number): BpmCandidate[] {
  const score = (x: number): number => {
    const lag = (60.0 * FPS) / x;
    if (lag < 2 || lag >= ac.length - 1) return 0.0;
    const i = Math.trunc(lag);
    return Math.max(0.0, ac[i]! + (lag - i) * (ac[i + 1]! - ac[i]!));
  };
  const out: BpmCandidate[] = [];
  const list: [string, number][] = [
    ['주 후보', bpm],
    ['반 박', bpm / 2.0],
    ['두 배 박', bpm * 2.0],
    // 3박자·셋잇단 느낌의 곡에서 자주 생기는 3/2배·2/3배 혼동 후보(원본에는 없는 호환 추가 항목)
    ['3/2 박', bpm * 1.5],
    ['2/3 박', (bpm * 2.0) / 3.0],
  ];
  for (const [label, value] of list) {
    if (MIN_BPM <= value && value <= MAX_BPM) out.push({ bpm: Math.round(value * 100) / 100, kind: label, confidence: Math.round(score(value) * 1000) / 1000 });
  }
  const top = Math.max(...out.map((c) => c.confidence)) || 1.0;
  for (const c of out) c.confidence = Math.round((c.confidence / top) * 1000) / 1000;
  return out;
}

/** 새 소리 시작 강도(env)의 자기상관 (lag 0 으로 나눠 정규화). 박 간격 추정과 BPM 후보 점수에 쓴다. */
export function normalizedAutocorr(env: ArrayLike<number>): Float64Array {
  const n = env.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i]!;
  mean /= Math.max(n, 1);
  const centered = new Float64Array(n);
  for (let i = 0; i < n; i++) centered[i] = env[i]! - mean;
  const maxSize = Math.trunc((60.0 / MIN_BPM) * FPS) + 4;
  const ac = autocorrelate(centered, Math.min(maxSize * 4, n - 1));
  const z = Math.max(ac[0]!, 1e-9);
  const out = new Float64Array(ac.length);
  for (let i = 0; i < ac.length; i++) out[i] = ac[i]! / z;
  return out;
}

/** 자기상관 값을 소수 위치에서 선형 보간해 읽는다. */
function acAt(ac: Float64Array, x: number): number {
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= ac.length) return 0;
  return ac[i]! + (x - i) * (ac[i + 1]! - ac[i]!);
}

/** 120BPM 선호도(로그 정규 모양): 120에서 1, 한 옥타브 떨어지면 약 0.61 */
function tempoPrior(bpm: number): number {
  return Math.exp(-0.5 * (Math.log2(bpm / START_BPM) / PRIOR_OCTAVES) ** 2);
}

/**
 * 박 간격 후보(씨앗) 찾기: 자기상관을 박 간격의 1~4배 지점까지 가중 합산(1, 0.7, 0.5, 0.35)하고 120BPM 선호를 곱해
 * 점수가 높은 서로 다른 BPM 을 최대 count 개 돌려준다(점수 순). 정확한 BPM 과 2배·반·3/2 혼동은 chooseTempo 가 가른다.
 */
export function tempoSeeds(ac: Float64Array, count = 3): number[] {
  const weights = [1, 0.7, 0.5, 0.35];
  const lagMin = Math.max(2, (60.0 * FPS) / MAX_BPM);
  const lagMax = Math.min((60.0 * FPS) / MIN_BPM, ac.length - 2);
  const lags: number[] = [];
  const scores: number[] = [];
  for (let lag = lagMin; lag <= lagMax; lag += 0.25) {
    let s = 0;
    weights.forEach((w, k) => {
      s += w * acAt(ac, (k + 1) * lag);
    });
    lags.push(lag);
    scores.push(s * tempoPrior((60.0 * FPS) / lag));
  }
  // 지역 최대 중 점수가 높은 순서로, 서로 6% 이상 떨어진 것만
  const peaks: number[] = [];
  for (let i = 1; i < scores.length - 1; i++) if (scores[i]! >= scores[i - 1]! && scores[i]! > scores[i + 1]!) peaks.push(i);
  peaks.sort((a, b) => scores[b]! - scores[a]!);
  const out: number[] = [];
  for (const i of peaks) {
    if (out.every((b) => Math.abs((60.0 * FPS) / lags[i]! / b - 1) > 0.06)) out.push((60.0 * FPS) / lags[i]!);
    if (out.length >= count) break;
  }
  if (!out.length) out.push(START_BPM);
  return out;
}

/** 박 간격 후보에서 만들어 보는 배율: 같음, 2배, 반, 3/2, 2/3, 4/3, 3/4 (3박자·셋잇단 혼동까지 확인) */
const TEMPO_RATIOS = [1, 2, 0.5, 1.5, 2 / 3, 4 / 3, 0.75];

/**
 * 박 간격 추정: 씨앗 BPM 과 그 배율 후보들을 '소리 시작 지점이 격자에 맞는 정도'(refine_with_onsets 와 같은 점수)로 겨뤄
 * 가장 잘 맞는 BPM 을 고른다. 점수에는 120BPM 선호를 곱한다. 후보가 12개 미만이면 첫 씨앗을 그대로 쓴다.
 */
export function chooseTempo(ac: Float64Array, cands: Candidate[]): number {
  const seeds = tempoSeeds(ac, 3);
  if (cands.length < 12) return seeds[0]!;
  const t = Float64Array.from(cands.map((c) => c.time_ms));
  const w = Float64Array.from(cands.map((c) => c.strength));
  const wsum = w.reduce((s, x) => s + x, 0) || 1;
  const hypotheses: number[] = [];
  for (const s of seeds) {
    for (const r of TEMPO_RATIOS) {
      const b = s * r;
      if (b < 55 || b > 240) continue;
      if (hypotheses.every((h) => Math.abs(h / b - 1) > 0.01)) hypotheses.push(b);
    }
  }
  let bestBpm = seeds[0]!;
  let bestScore = -1;
  for (const h of hypotheses) {
    // 씨앗의 BPM 이 조금 어긋나도 공정하게 겨루도록 ±0.5% 안에서 가장 잘 맞는 값을 쓴다
    for (const f of linspaceRange(h * 0.995, h * 1.005, 11)) {
      const period = 60000.0 / f;
      const phases = arange(0.0, period, 4.0);
      const sc = gridScore(t, w, period, phases);
      let mx = 0;
      for (let i = 0; i < sc.length; i++) if (sc[i]! > mx) mx = sc[i]!;
      const v = (mx / wsum) * tempoPrior(f);
      if (v >= bestScore) {
        bestScore = v;
        bestBpm = f;
      }
    }
  }
  return bestBpm;
}

function linspaceRange(a: number, b: number, num: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < num; i++) out.push(a + ((b - a) * i) / (num - 1));
  return out;
}

/**
 * 박 위치 찾기: 간격(period)을 고정하고, 박 위치에서의 시작 강도 합이 가장 큰 위상을 찾은 뒤,
 * 각 박 근처의 가장 센 지점을 따라가며(위상 보정) 실제 박 위치 목록을 만든다.
 */
export function trackBeats(novelty: Float32Array, bpm: number): number[] {
  const periodF = (60.0 * FPS) / bpm; // 프레임 단위 박 간격
  const n = novelty.length;
  // 1) 위상 탐색 (1프레임 간격, 거친 탐색)
  let bestPhase = 0;
  let bestScore = -1;
  for (let ph = 0; ph < periodF; ph += 1) {
    let s = 0;
    for (let pos = ph; pos < n - 1; pos += periodF) s += novelty[Math.round(pos)]!;
    if (s > bestScore) {
      bestScore = s;
      bestPhase = ph;
    }
  }
  // 2) 박 따라가기: 예상 위치 앞뒤에서 가장 센 시작 지점으로 위상을 조금씩 맞춘다
  const win = Math.max(2, Math.round(Math.min(0.12 * periodF, 0.05 * FPS)));
  const found: number[] = [];
  let pos = bestPhase;
  while (pos < n - 1) {
    const c = Math.round(pos);
    let best = -1;
    let bestV = 0;
    for (let i = Math.max(0, c - win); i <= Math.min(n - 1, c + win); i++) {
      if (novelty[i]! > bestV) {
        bestV = novelty[i]!;
        best = i;
      }
    }
    if (best >= 0) {
      found.push((best / FPS) * 1000.0);
      pos = pos + 0.4 * (best - pos);
    }
    pos += periodF;
  }
  return found;
}

/** 박자 분석 전체: 새 소리 시작 강도(종합 검출 함수)에서 BPM·박 위치·후보를 만든다. */
export function analyzeBeats(novelty: Float32Array, tempoCands: Candidate[]): BeatsResult {
  const ac = normalizedAutocorr(novelty);
  const tempo = chooseTempo(ac, tempoCands);
  const beats = trackBeats(novelty, tempo);
  const [bpm, phaseMs] = fitGrid(beats, tempo);
  let cv: number | null = null;
  if (beats.length > 4) {
    const ibi: number[] = [];
    for (let i = 1; i < beats.length; i++) ibi.push(beats[i]! - beats[i - 1]!);
    const m = ibi.reduce((s, x) => s + x, 0) / ibi.length;
    const sd = Math.sqrt(ibi.reduce((s, x) => s + (x - m) * (x - m), 0) / ibi.length);
    cv = sd / m;
  }
  const warnings: string[] = [];
  if (cv !== null && cv >= CV_WARNING) {
    warnings.push('템포가 변하는 곡일 수 있습니다. 분석은 곡 전체의 BPM 하나만 찾으니 결과를 꼭 확인해 주세요. [변속 구간] 카드에서 자동 찾기를 눌러 보세요.');
  }
  if (beats.length < 8) warnings.push('박자를 거의 찾지 못했습니다. BPM을 직접 입력해 주세요.');
  return {
    bpm,
    phase_ms: phaseMs,
    librosa_bpm: tempo,
    beats_ms: beats.map((b) => Math.round(b * 10) / 10),
    interval_cv: cv,
    bpm_candidates: bpmCandidates(ac, bpm),
    warnings,
    has_downbeats: false,
  };
}

// ---------- 격자 맞춤 (원본과 같은 방식) ----------

const GRID_SIGMA_MS = 15.0; // 격자 맞춤 점수의 폭 (허용 오차 30ms 의 절반)

/**
 * phases(여러 시작점) 각각에서 소리 시작 지점들이 격자에 맞는 정도(세기 가중 가우시안 점수의 합).
 * 격자는 8분 단위(박의 절반)를 기본으로 보고, 기본 박(4분음표)에 맞는 것에 가산점을 줘 박 위치가 반 박 밀리는 것을 막는다.
 */
export function gridScore(t: Float64Array, w: Float64Array, period: number, phases: Float64Array, sigma = GRID_SIGMA_MS): Float64Array {
  const score = new Float64Array(phases.length);
  for (const [cell, weight] of [
    [period / 2.0, 1.0],
    [period, 0.5],
  ] as [number, number][]) {
    for (let p = 0; p < phases.length; p++) {
      const ph = phases[p]!;
      let sum = 0;
      for (let i = 0; i < t.length; i++) {
        const d = mod(t[i]! - ph + cell / 2.0, cell) - cell / 2.0;
        sum += w[i]! * Math.exp(-0.5 * (d / sigma) ** 2);
      }
      score[p]! += weight * sum;
    }
  }
  return score;
}

export function arange(start: number, stop: number, step: number): Float64Array {
  const n = Math.max(0, Math.ceil((stop - start) / step));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = start + i * step;
  return out;
}
function linspace(a: number, b: number, num: number): Float64Array {
  const out = new Float64Array(num);
  for (let i = 0; i < num; i++) out[i] = a + ((b - a) * i) / (num - 1);
  return out;
}
function argmax(v: ArrayLike<number>): number {
  let k = 0;
  for (let i = 1; i < v.length; i++) if (v[i]! > v[k]!) k = i;
  return k;
}

/**
 * 소리 시작 지점들이 격자(8분 + 기본 박)에 가장 많이 맞도록 BPM(±2%)과 시작 위치를 정밀하게 다시 찾는다. (원본 refine_with_onsets)
 * 사용자가 고른 난이도와 상관없이 같은 기준으로 평가하고, 같은 입력이면 같은 결과다.
 */
export function refineWithOnsets(candidates: Candidate[], bpm: number, phaseMs: number, span = 0.02, minHits = 12): [number, number] {
  if (candidates.length < minHits) return [bpm, phaseMs];
  const t = Float64Array.from(candidates.map((c) => c.time_ms));
  const w = Float64Array.from(candidates.map((c) => c.strength));
  const bestFor = (b: number, step: number): [number, number] => {
    const period = 60000.0 / b;
    const phases = arange(0.0, period, step);
    const sc = gridScore(t, w, period, phases);
    const i = argmax(sc);
    return [sc[i]!, phases[i]!];
  };
  // 1단계: BPM 을 넓게(±2%) 거칠게 탐색, 2단계: 가장 좋은 BPM 주변을 촘촘히
  const coarse = linspace(bpm * (1 - span), bpm * (1 + span), 81);
  const scores = Array.from(coarse, (b) => bestFor(b, 3.0));
  const b0 = coarse[argmax(scores.map((s) => s[0]))]!;
  const fine = linspace(b0 * 0.9995, b0 * 1.0005, 21);
  const fscores = Array.from(fine, (b) => bestFor(b, 1.0));
  const k = argmax(fscores.map((s) => s[0]));
  const b = fine[k]!;
  // 3단계: 시작 위치를 0.25ms 단위로 다듬는다
  const period = 60000.0 / b;
  const ph = fscores[k]![1];
  const phases = arange(ph - 2.0, ph + 2.0, 0.25);
  const sc = gridScore(t, w, period, phases);
  return [b, mod(phases[argmax(sc)]!, period)];
}

/** 소리 시작 지점 중 박자 칸(기본 8분)에서 허용 오차 안에 드는 지점의 수와 비율. 박자 맞춤 정도를 보여 주는 값이다. */
export function gridFitStats(timesMs: number[], bpm: number, offsetMs: number, toleranceMs = 30.0, division = 8): GridFit {
  const total = timesMs.length;
  if (!total) return { total: 0, fit: 0, percent: 0.0, division, tolerance_ms: toleranceMs };
  const cell = ((60000.0 / bpm) * 4.0) / division;
  let fit = 0;
  for (const tm of timesMs) {
    const d = (tm - offsetMs) / cell;
    const err = Math.abs(d - Math.round(d)) * cell; // numpy round(짝수 규칙)와 0.5 경계 차이는 무시할 수준
    if (err <= toleranceMs) fit += 1;
  }
  return { total, fit, percent: Math.round((1000.0 * fit) / total) / 10, division, tolerance_ms: toleranceMs };
}
