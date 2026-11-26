/**
 * [04e] 변속 자동 찾기: 분석이 구한 박 위치(`beats.beats_ms`, 음원 ms) 목록에서 BPM 이 바뀌는 곳을 찾는다.
 *
 * 1. 박 간격 열을 만든다. 절반·두 배로 잡힌 옥타브 오류(박을 하나 놓치거나 반 박을 잡은 것)는 같은 BPM 계열로 맞춘다.
 * 2. 앞 구간 박 간격의 중앙값과 비교해 민감도 비율 이상 다른 상태가 8박 이상 같은 방향으로 이어지는 지점을 후보로 삼는다.
 *    서서히 변하는 곡(연속 가감속)은 쪼개지 않고 "연속 변화 가능성"만 알린다.
 * 3. 경계는 가장 가까운 실제 박 위치에 붙이고, 구간 BPM 은 정수 박 수로 역산한다: BPM = 박 수 × 60000 ÷ (구간 끝ms − 구간 시작ms).
 *    그래서 경계가 소리와 어긋나지 않는다.
 * 4. 4박 미만 구간은 이웃에 합치고 구간 수는 32 이하. 후보마다 신뢰도(박 간격 변동 크기)를 붙인다.
 * 이 파일은 계산만 한다(화면·저장과 무관). 같은 입력이면 같은 결과다.
 */
import { fitGrid, MAX_BPM, MIN_BPM } from './beats.ts';
import { MAX_TEMPO_SECTIONS } from '../core/tempoSections.ts';
import type { BpmEntry } from '../core/schema.ts';

export type TempoSensitivity = 'strict' | 'normal' | 'sensitive';

/** 민감도 → 박 간격 변화 비율 (엄격 5% / 보통 3% / 민감 2%) */
export const SENSITIVITY_RATIO: Record<TempoSensitivity, number> = { strict: 0.05, normal: 0.03, sensitive: 0.02 };
export const SENSITIVITY_NAMES: Record<TempoSensitivity, string> = { strict: '엄격 5%', normal: '보통 3%', sensitive: '민감 2%' };

/** 변화가 이만큼(박) 이어져야 후보로 본다 */
export const RUN_BEATS = 8;
/** 구간 최소 길이(박): 이보다 짧으면 이웃에 합친다 */
export const MIN_FOUND_BEATS = 4;
/** 옥타브(2배·1/2) 보정을 하는 허용 범위 */
const OCTAVE_TOL = 0.18;
/** 박이 이 개수보다 적으면 찾지 않는다 */
export const MIN_BEATS_FOR_SEARCH = 16;

/** 박 간격이 같은 구간 하나 */
export interface FoundSection {
  /** 시작·끝 박 번호(beats 배열의 위치) */
  startBeat: number;
  endBeat: number;
  /** 시작·끝 시각(음원 ms). 끝은 다음 구간의 시작(마지막 구간은 마지막 박) */
  startMs: number;
  endMs: number;
  /** 구간의 박 수(정수) */
  beats: number;
  /** 정수 박 수로 역산한 BPM (소수 셋째 자리) */
  bpm: number;
}

/** 후보(변속 지점) 하나 = 두 번째 구간부터의 시작 */
export interface TempoCandidate {
  /** 구간 번호(1부터. 0번은 곡 처음 구간이라 후보가 아니다) */
  section: number;
  timeMs: number;
  beatIndex: number;
  bpm: number;
  beats: number;
  /** 0~1 (박 간격 변화가 크고 구간 안이 고를수록 높다) */
  confidence: number;
}

export interface TempoFindResult {
  sections: FoundSection[];
  candidates: TempoCandidate[];
  /** 서서히 변하는 구간(연속 가감속)이 보였는가 */
  continuous: boolean;
  /** 화면에 그대로 보여 줄 쉬운 한국어 설명 */
  message: string;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** 박 간격을 옥타브 오류 없이 맞춘다(같은 BPM 계열로). 반환: 맞춘 간격과 맞춘 곳 표시 */
export function normalizeIntervals(beats: number[]): { ni: number[]; adjusted: boolean[] } {
  const raw: number[] = [];
  for (let i = 1; i < beats.length; i++) raw.push(beats[i]! - beats[i - 1]!);
  const ni: number[] = [];
  const adjusted: boolean[] = [];
  if (!raw.length) return { ni, adjusted };
  let ref = median(raw.slice(0, 9));
  const hist: number[] = [];
  for (const r of raw) {
    let v = r;
    let did = false;
    if (Math.abs(r / ref - 1) >= OCTAVE_TOL) {
      const cands = [r * 2, r / 2].filter((c) => Math.abs(c / ref - 1) < OCTAVE_TOL);
      if (cands.length) {
        v = cands.reduce((best, c) => (Math.abs(Math.log(c / ref)) < Math.abs(Math.log(best / ref)) ? c : best));
        did = true;
      }
    }
    ni.push(v);
    adjusted.push(did);
    hist.push(v);
    if (hist.length > 8) hist.shift();
    ref = median(hist);
  }
  return { ni, adjusted };
}

function sse(values: number[]): number {
  if (!values.length) return 0;
  const m = values.reduce((s, x) => s + x, 0) / values.length;
  return values.reduce((s, x) => s + (x - m) * (x - m), 0);
}

/** 박 위치(음원 ms)에서 변속 지점을 찾는다. */
export function findTempoChanges(beatsMs: number[], sensitivity: TempoSensitivity = 'normal'): TempoFindResult {
  const sens = SENSITIVITY_RATIO[sensitivity] ?? SENSITIVITY_RATIO.normal;
  const beats = [...beatsMs].filter((b) => Number.isFinite(b)).sort((a, b) => a - b);
  if (beats.length < MIN_BEATS_FOR_SEARCH) {
    return { sections: [], candidates: [], continuous: false, message: '박 위치가 충분하지 않아 변속을 찾지 못했습니다. 먼저 [분석]을 하거나 수동으로 구간을 추가하세요.' };
  }
  const { ni, adjusted } = normalizeIntervals(beats);
  const n = ni.length;
  const W = RUN_BEATS;
  // 박 위치 흔들림이 만드는 박 간격의 잡음(표준편차 추정): 이웃한 간격 차이의 중앙값 절대편차로 구한다(변속·가감속의 영향을 거의 받지 않는다)
  const diffs: number[] = [];
  for (let i = 0; i + 1 < n; i++) diffs.push(ni[i + 1]! - ni[i]!);
  const dMed = median(diffs);
  const noise = (1.4826 * median(diffs.map((x) => Math.abs(x - dMed)))) / Math.sqrt(3);

  // ---- 변화 지점 찾기
  const bounds: number[] = [0];
  const confs: number[] = [0];
  let segStart = 0;
  let continuous = false;
  let j = 4;
  while (j <= n - W) {
    const lo = Math.max(segStart, j - 16);
    if (j - lo < 4) {
      j++;
      continue;
    }
    const ref = median(ni.slice(lo, j));
    let dir = 0;
    let run = true;
    for (let i = j; i < j + W; i++) {
      const d = (ni[i]! - ref) / ref;
      if (Math.abs(d) < sens || (dir !== 0 && Math.sign(d) !== dir)) {
        run = false;
        break;
      }
      dir = Math.sign(d);
    }
    if (!run) {
      j++;
      continue;
    }
    // 계단(한 번에 바뀜)인가, 서서히 변하는가: 변하기 전·후 4박씩 묶은 중앙값이 평평해야 계단이다
    const flat = Math.max(0.012 * ref, 2.2 * noise);
    const post = [median(ni.slice(j, j + 4)), median(ni.slice(j + 4, j + 8)), j + 12 <= n ? median(ni.slice(j + 8, j + 12)) : median(ni.slice(j + 4, j + 8))];
    const postFlat = Math.abs(post[2]! - post[0]!) <= flat && Math.abs(post[1]! - post[0]!) <= flat;
    const preFlat = j - 8 < segStart || Math.abs(median(ni.slice(j - 8, j - 4)) - median(ni.slice(j - 4, j))) <= flat;
    if (!postFlat || !preFlat) {
      continuous = true;
      j += W;
      continue;
    }
    // 경계 다듬기: 앞뒤 값을 두 수준으로 가장 잘 나누는 박 위치
    let bestB = j;
    let bestCost = Infinity;
    for (let b = Math.max(segStart + 2, j - 5); b <= Math.min(n - 2, j + 3); b++) {
      const cost = sse(ni.slice(Math.max(segStart, b - 12), b)) + sse(ni.slice(b, Math.min(n, b + 12)));
      if (cost < bestCost - 1e-9 || (Math.abs(cost - bestCost) <= 1e-9 && Math.abs(b - j) < Math.abs(bestB - j))) {
        bestCost = cost;
        bestB = b;
      }
    }
    const before = ni.slice(Math.max(segStart, bestB - 8), bestB);
    const after = ni.slice(bestB, Math.min(n, bestB + 8));
    const change = Math.abs(median(after) - median(before)) / median(before);
    const spread = (median(before.map((x) => Math.abs(x - median(before)))) + median(after.map((x) => Math.abs(x - median(after))))) / 2 / median(before);
    bounds.push(bestB);
    confs.push(Math.min(0.99, Math.round((change / (change + 3 * spread + 0.01)) * 100) / 100));
    segStart = bestB;
    j = bestB + 4;
  }
  bounds.push(n);
  confs.push(0);

  // ---- 구간 만들기: 4박 미만은 이웃에 합친다
  const build = (): FoundSection[] => {
    const out: FoundSection[] = [];
    for (let k = 0; k + 1 < bounds.length; k++) {
      const s = bounds[k]!;
      const e = bounds[k + 1]!;
      const dur = beats[e]! - beats[s]!;
      const m = median(ni.slice(s, e));
      let count = Math.max(1, Math.round(dur / m));
      // 소리 위치를 직선으로 맞춘 BPM 이 간격 중앙값과 비슷하면 그 값으로 박 수를 정한다(박 수는 정수)
      if (e - s >= 4 && !adjusted.slice(s, e).some(Boolean)) {
        const [fb] = fitGrid(beats.slice(s, e + 1), 60000 / m);
        if (Math.abs(fb / (60000 / m) - 1) < 0.05) count = Math.max(1, Math.round((dur * fb) / 60000));
      }
      let bpm = (count * 60000) / dur;
      while (bpm > MAX_BPM && count > 1) {
        count = Math.max(1, Math.round(count / 2));
        bpm = (count * 60000) / dur;
      }
      while (bpm < MIN_BPM) {
        count *= 2;
        bpm = (count * 60000) / dur;
      }
      out.push({ startBeat: s, endBeat: e, startMs: beats[s]!, endMs: beats[e]!, beats: count, bpm: Math.round(bpm * 1000) / 1000 });
    }
    return out;
  };
  let sections = build();
  for (;;) {
    const k = sections.findIndex((s) => s.beats < MIN_FOUND_BEATS);
    if (k < 0 || sections.length === 1) break;
    bounds.splice(k === 0 ? 1 : k, 1);
    confs.splice(k === 0 ? 1 : k, 1);
    sections = build();
  }
  // 구간 수 한도: 신뢰도가 낮은 경계부터 합친다
  while (sections.length > MAX_TEMPO_SECTIONS) {
    let weakest = 1;
    for (let k = 2; k < sections.length; k++) if (confs[k]! < confs[weakest]!) weakest = k;
    bounds.splice(weakest, 1);
    confs.splice(weakest, 1);
    sections = build();
  }

  const candidates: TempoCandidate[] = sections.slice(1).map((s, i) => ({
    section: i + 1,
    timeMs: Math.round(s.startMs * 10) / 10,
    beatIndex: s.startBeat,
    bpm: s.bpm,
    beats: s.beats,
    confidence: confs[i + 1] ?? 0,
  }));
  let message: string;
  if (candidates.length) {
    message = `변속 ${candidates.length}곳을 찾았습니다. 확인하고 쓸 곳만 체크한 뒤 [적용]을 누르세요.`;
    if (continuous) message += ' 서서히 변하는 부분도 있어 보입니다(연속 변화 가능성). 그 부분은 나누지 않았으니 필요하면 수동으로 나누세요.';
  } else if (continuous) {
    message = '박 간격이 서서히 변하는 곡으로 보입니다(연속 변화 가능성). 자동으로 나누지 않았으니 필요하면 수동으로 구간을 나누세요.';
  } else {
    message = '변속이 확인되지 않았습니다. 필요하면 수동으로 구간을 추가하세요.';
  }
  return { sections, candidates, continuous, message };
}

/**
 * 고른 후보(구간 번호)만 적용한 BPM 구간 목록과 시작점(ms)을 만든다. 고르지 않은 경계는 앞 구간에 합쳐진다.
 * 곡의 첫 박(찾은 박 중 첫 번째)이 tick 960 이 되도록 시작점(audio_offset_ms)을 정하고, 구간 시작은 정수 박 수로 이어 붙인다.
 * 각 구간의 BPM = (박 수 × 60000) ÷ (구간 길이 ms) 이므로 구간 경계가 찾은 박 위치와 어긋나지 않는다.
 */
export function buildTempoEntries(result: TempoFindResult, selected: number[], meter: { beats_per_bar: number; beat_unit: number } = { beats_per_bar: 4, beat_unit: 4 }): { entries: BpmEntry[]; audio_offset_ms: number } {
  const keep = new Set(selected);
  const groups: { startMs: number; endMs: number; beats: number }[] = [];
  result.sections.forEach((s, k) => {
    if (k === 0 || keep.has(k)) groups.push({ startMs: s.startMs, endMs: s.endMs, beats: s.beats });
    else {
      const g = groups[groups.length - 1]!;
      g.endMs = s.endMs;
      g.beats += s.beats;
    }
  });
  // 첫 구간은 tick 0(= 첫 박 한 칸 앞)에서 시작하고, 두 번째 구간부터의 tick = 첫 박(960) + 앞 구간들의 박 수 × 960
  const entries: BpmEntry[] = [];
  let tick = 960;
  groups.forEach((g, i) => {
    const bpm = Math.round(((g.beats * 60000) / (g.endMs - g.startMs)) * 1000) / 1000;
    entries.push({ tick: i === 0 ? 0 : tick, bpm, beats_per_bar: meter.beats_per_bar, beat_unit: meter.beat_unit });
    tick += g.beats * 960;
  });
  const audioOffset = Math.round((groups[0]!.startMs - 60000 / entries[0]!.bpm) * 100) / 100;
  return { entries, audio_offset_ms: audioOffset };
}
