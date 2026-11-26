// 게임 플레이 옵션의 순수 로직(화면·소리 장치 없음): 판정 설정(폭·점수 비율)과 볼륨 곡선.
// 적용 범위는 "게임 화면 테스트" 하나뿐이다. 편집기 [테스트] 팝업·채보 파일·Unity 내보내기는 이 값을 읽지 않는다.
// 수치(범위·프리셋)는 모두 이 파일 한 곳에서 읽는다. 원본 기본값은 gameConfig.ts 에서 가져온다(복사해 적지 않는다).
import { GAME_CONFIG, type GameConfig } from './core/config/gameConfig';

/** 점수 비율(%) : 판정 등급별 점수 가중치 */
export interface PlayJudgeWeights {
  perfect: number;
  great: number;
  good: number;
  bad: number;
  miss: number;
}

/** 저장되는 판정 설정(settingsStore 의 playJudge) */
export interface PlayJudgeOptions {
  /** 단계별 허용 시간 폭(ms) */
  perfectMs: number;
  greatMs: number;
  goodMs: number;
  badMs: number;
  /** 점수 비율(%) */
  weights: PlayJudgeWeights;
}

/** 폭(ms) 항목 이름 */
export type JudgeMsKey = 'perfectMs' | 'greatMs' | 'goodMs' | 'badMs';
/** 편집할 수 있는 점수 비율 항목 이름 (PERFECT 100 고정, MISS 0 고정) */
export type WeightKey = 'great' | 'good' | 'bad';

/** 판정 폭 허용 범위(ms). PERFECT < GREAT < GOOD < BAD 이고 단계 사이는 minGapMs 이상 */
export const JUDGE_MS_LIMITS: Record<JudgeMsKey, { min: number; max: number }> = {
  perfectMs: { min: 10, max: 80 },
  greatMs: { min: 40, max: 140 },
  goodMs: { min: 70, max: 200 },
  badMs: { min: 100, max: 260 },
};
export const JUDGE_MS_ORDER: readonly JudgeMsKey[] = ['perfectMs', 'greatMs', 'goodMs', 'badMs'];
export const JUDGE_MIN_GAP_MS = 5;

/** 화면에 보이는 이름 */
export const JUDGE_MS_LABEL: Record<JudgeMsKey, string> = { perfectMs: 'PERFECT', greatMs: 'GREAT', goodMs: 'GOOD', badMs: 'BAD' };

/** 원본 기본값 (gameConfig 의 원본 값에서 만든다) */
export function defaultPlayJudge(): PlayJudgeOptions {
  const j = GAME_CONFIG.judge;
  const w = GAME_CONFIG.scoreWeight;
  return {
    perfectMs: j.perfectMs,
    greatMs: j.greatMs,
    goodMs: j.goodMs,
    badMs: j.badMs,
    weights: { perfect: Math.round(w.perfect * 100), great: Math.round(w.great * 100), good: Math.round(w.good * 100), bad: Math.round(w.bad * 100), miss: Math.round(w.miss * 100) },
  };
}

/** 프리셋 하나(폭과 점수 비율만) */
export interface JudgePreset {
  id: 'original' | 'strict' | 'loose';
  label: string;
  ms: Record<JudgeMsKey, number>;
  weights: PlayJudgeWeights;
}

/** [임시] 엄격·넉넉하게 값은 기획 확정 전 값이다. 이 표 한 곳만 고치면 된다 */
export function judgePresets(): JudgePreset[] {
  const d = defaultPlayJudge();
  return [
    { id: 'original', label: '원본 기본', ms: { perfectMs: d.perfectMs, greatMs: d.greatMs, goodMs: d.goodMs, badMs: d.badMs }, weights: { ...d.weights } },
    { id: 'strict', label: '엄격', ms: { perfectMs: 30, greatMs: 65, goodMs: 100, badMs: 140 }, weights: { perfect: 100, great: 60, good: 30, bad: 5, miss: 0 } },
    { id: 'loose', label: '넉넉하게', ms: { perfectMs: 60, greatMs: 120, goodMs: 180, badMs: 240 }, weights: { perfect: 100, great: 80, good: 50, bad: 20, miss: 0 } },
  ];
}

/** 복사본 */
export function clonePlayJudge(j: PlayJudgeOptions): PlayJudgeOptions {
  return { ...j, weights: { ...j.weights } };
}

/** 프리셋 값을 적용한 새 설정 */
export function applyPreset(cur: PlayJudgeOptions, id: JudgePreset['id']): PlayJudgeOptions {
  const p = judgePresets().find((x) => x.id === id);
  if (!p) return clonePlayJudge(cur);
  return { ...p.ms, weights: { ...p.weights } };
}

/** 지금 값이 어느 프리셋과 같은지. 모두 다르면 'custom'(직접) */
export function presetOf(j: PlayJudgeOptions): JudgePreset['id'] | 'custom' {
  for (const p of judgePresets()) {
    const sameMs = JUDGE_MS_ORDER.every((k) => j[k] === p.ms[k]);
    const w = j.weights;
    const sameW = w.perfect === p.weights.perfect && w.great === p.weights.great && w.good === p.weights.good && w.bad === p.weights.bad && w.miss === p.weights.miss;
    if (sameMs && sameW) return p.id;
  }
  return 'custom';
}

/** 프리셋 이름 (직접 포함) */
export function presetLabel(id: JudgePreset['id'] | 'custom'): string {
  if (id === 'custom') return '직접';
  return judgePresets().find((p) => p.id === id)?.label ?? '직접';
}

/** 원본 기본값과 완전히 같은지 (폭·점수 비율) */
export function isDefaultPlayJudge(j: PlayJudgeOptions): boolean {
  return presetOf(j) === 'original';
}

// ----------------------------------------------------------------------------- 검증

/** 숫자를 정수로 만들고 범위 안으로 맞춘다. 숫자가 아니면 fallback */
function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return Math.max(min, Math.min(max, fallback));
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** 폭(ms) 검증: 문제가 있으면 쉬운 한국어 문장 목록, 없으면 빈 목록 */
export function validateJudgeMs(ms: Record<JudgeMsKey, number>): string[] {
  const problems: string[] = [];
  for (const k of JUDGE_MS_ORDER) {
    const lim = JUDGE_MS_LIMITS[k];
    const v = ms[k];
    if (!Number.isFinite(v) || v < lim.min || v > lim.max) problems.push(`${JUDGE_MS_LABEL[k]} 폭은 ${lim.min}~${lim.max}ms 사이만 쓸 수 있어요.`);
  }
  for (let i = 1; i < JUDGE_MS_ORDER.length; i += 1) {
    const prev = JUDGE_MS_ORDER[i - 1]!;
    const cur = JUDGE_MS_ORDER[i]!;
    if (!(ms[cur] >= ms[prev] + JUDGE_MIN_GAP_MS)) problems.push(`${JUDGE_MS_LABEL[cur]} 폭은 ${JUDGE_MS_LABEL[prev]} 폭보다 ${JUDGE_MIN_GAP_MS}ms 이상 커야 해요.`);
  }
  return problems;
}

/** 점수 비율(%) 검증: PERFECT 100 고정, MISS 0 고정, GREAT·GOOD·BAD 는 0~100 이고 PERFECT ≥ GREAT ≥ GOOD ≥ BAD ≥ MISS */
export function validateJudgeWeights(w: PlayJudgeWeights): string[] {
  const problems: string[] = [];
  if (w.perfect !== 100) problems.push('PERFECT 점수 비율은 100%로 고정이에요.');
  if (w.miss !== 0) problems.push('MISS 점수 비율은 0%로 고정이에요.');
  for (const k of ['great', 'good', 'bad'] as const) {
    if (!Number.isFinite(w[k]) || w[k] < 0 || w[k] > 100) problems.push(`${JUDGE_MS_LABEL[`${k}Ms` as JudgeMsKey]} 점수 비율은 0~100% 사이만 쓸 수 있어요.`);
  }
  if (!(w.perfect >= w.great && w.great >= w.good && w.good >= w.bad && w.bad >= w.miss)) problems.push('점수 비율은 PERFECT ≥ GREAT ≥ GOOD ≥ BAD ≥ MISS 순서를 지켜야 해요.');
  return problems;
}

/** 전체 검증 (폭 + 점수 비율) */
export function validatePlayJudge(j: PlayJudgeOptions): string[] {
  return [...validateJudgeMs(j), ...validateJudgeWeights(j.weights)];
}

/**
 * 폭(ms) 네 개를 앞에서부터 차례로 맞춘다: 각자 범위 안으로, 앞 단계보다 5ms 이상 크게.
 * 저장 파일이 깨졌을 때 가까운 값으로 복구하는 데 쓴다.
 */
export function fitJudgeMs(ms: Record<JudgeMsKey, number>, fallback: Record<JudgeMsKey, number>): Record<JudgeMsKey, number> {
  const out = { perfectMs: 0, greatMs: 0, goodMs: 0, badMs: 0 };
  let floor = -Infinity;
  for (const k of JUDGE_MS_ORDER) {
    const lim = JUDGE_MS_LIMITS[k];
    out[k] = clampInt(ms[k], Math.max(lim.min, floor), lim.max, fallback[k]);
    floor = out[k] + JUDGE_MIN_GAP_MS;
  }
  return out;
}

/**
 * 사용자가 폭 하나를 직접 고쳤을 때: 그 칸만 허용 범위(앞뒤 단계와 5ms 간격 포함)로 맞추고 안내를 돌려준다.
 * 입력 칸 옆에 안내를 띄우고 가까운 값으로 맞추는 데 쓴다.
 */
export function adjustJudgeMsField(cur: PlayJudgeOptions, key: JudgeMsKey, value: number): { judge: PlayJudgeOptions; note: string | null } {
  const idx = JUDGE_MS_ORDER.indexOf(key);
  const lim = JUDGE_MS_LIMITS[key];
  const prev = idx > 0 ? cur[JUDGE_MS_ORDER[idx - 1]!] + JUDGE_MIN_GAP_MS : -Infinity;
  const next = idx < JUDGE_MS_ORDER.length - 1 ? cur[JUDGE_MS_ORDER[idx + 1]!] - JUDGE_MIN_GAP_MS : Infinity;
  const lo = Math.max(lim.min, prev);
  const hi = Math.min(lim.max, next);
  const wanted = clampInt(value, -1e9, 1e9, cur[key]);
  const fixed = Math.max(lo, Math.min(Math.max(lo, hi), wanted));
  let note: string | null = null;
  if (fixed !== wanted) {
    const label = JUDGE_MS_LABEL[key];
    if (wanted < lim.min || wanted > lim.max) note = `${label} 폭은 ${lim.min}~${lim.max}ms 사이만 쓸 수 있어서 ${fixed}ms로 맞췄어요.`;
    else if (wanted < prev) note = `${label} 폭은 ${JUDGE_MS_LABEL[JUDGE_MS_ORDER[idx - 1]!]} 폭보다 ${JUDGE_MIN_GAP_MS}ms 이상 커야 해서 ${fixed}ms로 맞췄어요.`;
    else note = `${label} 폭은 ${JUDGE_MS_LABEL[JUDGE_MS_ORDER[idx + 1]!]} 폭보다 ${JUDGE_MIN_GAP_MS}ms 이상 작아야 해서 ${fixed}ms로 맞췄어요.`;
  }
  const judge = clonePlayJudge(cur);
  judge[key] = fixed;
  return { judge, note };
}

/** 점수 비율 하나를 직접 고쳤을 때: PERFECT ≥ GREAT ≥ GOOD ≥ BAD ≥ MISS 가 되도록 그 칸만 맞춘다 */
export function adjustWeightField(cur: PlayJudgeOptions, key: WeightKey, value: number): { judge: PlayJudgeOptions; note: string | null } {
  const w = cur.weights;
  const upper = key === 'great' ? w.perfect : key === 'good' ? w.great : w.good;
  const lower = key === 'great' ? w.good : key === 'good' ? w.bad : w.miss;
  const wanted = clampInt(value, -1e9, 1e9, w[key]);
  const fixed = Math.max(lower, Math.min(upper, wanted));
  let note: string | null = null;
  if (fixed !== wanted) {
    const label = JUDGE_MS_LABEL[`${key}Ms` as JudgeMsKey];
    note = wanted < 0 || wanted > 100 ? `${label} 점수 비율은 0~100% 사이만 쓸 수 있어서 ${fixed}%로 맞췄어요.` : `점수 비율은 PERFECT ≥ GREAT ≥ GOOD ≥ BAD 순서여야 해서 ${label}를 ${fixed}%로 맞췄어요.`;
  }
  const judge = clonePlayJudge(cur);
  judge.weights[key] = fixed;
  return { judge, note };
}

/**
 * 저장된 값(깨졌거나 범위 밖일 수 있음)을 쓸 수 있는 설정으로 복구한다. 값이 없으면 원본 기본값.
 * 바꾼 부분이 있으면 쉬운 한국어 안내를 돌려준다.
 */
export function sanitizePlayJudge(raw: unknown): { value: PlayJudgeOptions; notes: string[] } {
  const d = defaultPlayJudge();
  if (raw === undefined || raw === null) return { value: d, notes: [] };
  if (typeof raw !== 'object') return { value: d, notes: ['저장된 판정 설정을 읽지 못해 원본 기본값으로 되돌렸습니다.'] };
  const r = raw as Record<string, unknown>;
  const notes: string[] = [];
  const msIn = { perfectMs: Number(r.perfectMs), greatMs: Number(r.greatMs), goodMs: Number(r.goodMs), badMs: Number(r.badMs) };
  const ms = fitJudgeMs(msIn, d);
  if (JUDGE_MS_ORDER.some((k) => ms[k] !== msIn[k])) notes.push('저장된 판정 폭이 허용 범위를 벗어나 가까운 값으로 맞췄습니다.');
  const wr = (r.weights ?? {}) as Record<string, unknown>;
  const great = clampInt(wr.great, 0, 100, d.weights.great);
  const good = clampInt(wr.good, 0, great, Math.min(d.weights.good, great));
  const bad = clampInt(wr.bad, 0, good, Math.min(d.weights.bad, good));
  const weights: PlayJudgeWeights = { perfect: 100, great, good, bad, miss: 0 };
  if (great !== Number(wr.great) || good !== Number(wr.good) || bad !== Number(wr.bad)) notes.push('저장된 점수 비율이 허용 범위를 벗어나 가까운 값으로 맞췄습니다.');
  // 옛 저장값에 들어 있던 burstGrade(연타 성공 등급)는 읽지 않고 버린다(04c). 다음 저장 때 사라진다
  return { value: { ...ms, weights }, notes };
}

// ----------------------------------------------------------------------------- 게임 수치에 적용 / 표시 문구

/** 판정 설정을 게임 수치(GameConfig)에 넣는다. 놓침 판정 시간(autoMissAfterMs)은 BAD 폭과 같게 맞춘다. 판정 계산 방식은 바꾸지 않는다 */
export function applyPlayJudgeToConfig(config: GameConfig, j: PlayJudgeOptions): void {
  config.judge.perfectMs = j.perfectMs;
  config.judge.greatMs = j.greatMs;
  config.judge.goodMs = j.goodMs;
  config.judge.badMs = j.badMs;
  config.judge.autoMissAfterMs = j.badMs;
  config.scoreWeight = { perfect: j.weights.perfect / 100, great: j.weights.great / 100, good: j.weights.good / 100, bad: j.weights.bad / 100, miss: j.weights.miss / 100 };
}

/** 결과 화면 맨 위에 작게 보일 문구. 원본 기본값이면 null(표시하지 않는다) */
export function describePlayJudge(j: PlayJudgeOptions): string | null {
  if (isDefaultPlayJudge(j)) return null;
  const label = presetLabel(presetOf(j));
  const ms = `PERFECT ±${j.perfectMs}ms · GREAT ±${j.greatMs}ms · GOOD ±${j.goodMs}ms · BAD ±${j.badMs}ms`;
  const w = j.weights;
  const parts = [ms, `점수 ${w.perfect}/${w.great}/${w.good}/${w.bad}%`];
  return `판정 설정: ${label} (${parts.join(' · ')})`;
}

// ----------------------------------------------------------------------------- 볼륨

/** 볼륨 설정 (슬라이더 값 0~100). 음소거는 따로 둔다 */
export interface PlayVolumes {
  music: number;
  sfx: number;
  muted: boolean;
}

/** 볼륨 수치(한 곳) */
export const VOLUME_CONFIG = {
  min: 0,
  max: 100,
  /** 볼륨이 바뀔 때 소리가 갑자기 커지거나 튀지 않게 이 시간(초)을 시간 상수로 부드럽게 따라간다 */
  smoothSec: 0.02,
} as const;

/** 슬라이더 값을 0~100 정수로 맞춘다. 숫자가 아니면 fallback */
export function clampVolume(v: unknown, fallback = 80): number {
  return clampInt(v, VOLUME_CONFIG.min, VOLUME_CONFIG.max, fallback);
}

/** 슬라이더 값 v(0~100) → 소리 크기 (v/100)^2. 0 은 완전 무음 */
export function volumeGain(v: number): number {
  const c = Math.max(VOLUME_CONFIG.min, Math.min(VOLUME_CONFIG.max, Number.isFinite(v) ? v : 0)) / 100;
  return c * c;
}

/** 음소거까지 반영한 실제 음악 크기 */
export function musicGainOf(vol: PlayVolumes): number {
  return vol.muted ? 0 : volumeGain(vol.music);
}

/** 음소거까지 반영한 효과음 슬라이더 값(0~100). SfxPlayer.setVolume(100, 이 값) 에 넣는다 — 곡선은 이미 반영돼 있다 */
export function sfxLevelOf(vol: PlayVolumes): number {
  return vol.muted ? 0 : volumeGain(vol.sfx) * 100;
}
