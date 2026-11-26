/**
 * 노트 자동 생성(④⑤): 분석 결과 → 노트 목록 + 통계 + 검증 요약. 같은 입력이면 같은 결과(결정적). (원본 generate.py)
 * 디자인 모드 3종: classic(기존 방식) / reference(레퍼런스 규칙) / unified(통합 규칙). 난이도·생성 설정은 config\presets.json 에서 읽는다.
 */
import { loadPresets } from '../core/config.ts';
import type { Presets } from '../core/config.ts';
import { RESOLUTION, newChart } from '../core/schema.ts';
import type { ChartNote, ChartV2 } from '../core/schema.ts';
import { BpmMap } from '../core/timing.ts';
import { ERROR, validateIssues } from '../core/validate.ts';
import { cloneJson, pyRound } from '../core/util.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { AnalysisError } from '../analysis/types.ts';
import { LANE_MODES, buildNotes as buildLaneNotes } from './lanes.ts';
import { buildFourKeyNotes, checkRules4, fourKeyConfig } from './lanes4.ts';
import { applyRuleOverrides } from './ruleFields.ts';
import type { FourKeyConfig } from './lanes4.ts';
import { planNotes } from './noteTypes.ts';
import * as refrules from './refrules.ts';
import * as unified from './unified.ts';
import type { GenerateOptions, GenerateResult, NotePlan, NpsStats, ResolvedOptions, TypeStats, ValidationSummary } from './types.ts';

const DEFAULT_OPTIONS = {
  ratios: { tap: 70, hold: 20, burst: 10 },
  hold_beats: 1.0,
  burst_count: 8,
  difficulty: 'NORMAL',
  lane_mode: 'alternate',
  design_mode: 'classic', // 디자인 모드: classic(기존 방식) / reference(레퍼런스 규칙 적용) / unified(통합 규칙)
  grid_tolerance: 'strict', // 박자 맞춤 정도: strict(엄격, 기본 30ms) / normal(보통) / loose(느슨)
};

/** 사용자 옵션 + 난이도 프리셋 + 기본값을 합쳐 생성에 쓸 설정을 만든다. 잘못된 값은 한국어 오류. */
export function resolveOptions(options?: GenerateOptions, presetsIn?: Presets): ResolvedOptions {
  const presets = presetsIn ?? loadPresets();
  const gen: Record<string, any> = {
    grid_tolerance_ms: 30, burst_gap_ms: 130, burst_min_hits: 4, hold_cap_multiplier: 2.0, burst_max_beats: 8, seed: 19491,
    grid_tolerance_presets: { strict: 30, normal: 45, loose: 60 },
    ...(presets.generation ?? {}),
  };
  const opt: Record<string, any> = cloneJson(DEFAULT_OPTIONS);
  for (const [k, v] of Object.entries(options ?? {})) {
    if (v !== undefined && v !== null) opt[k] = v;
  }
  const diff = String(opt.difficulty).toUpperCase();
  const table = presets.difficulties ?? {};
  if (!(diff in table)) throw new AnalysisError('난이도는 쉬움(EASY), 보통(NORMAL), 어려움(HARD), 직접(CUSTOM) 중에서 골라 주세요.');
  const cfg: Record<string, any> = { ...table[diff] };
  for (const k of ['grid_division', 'nps_base', 'max_nps', 'min_gap_ms'] as const) {
    const v = (options as Record<string, unknown> | undefined)?.[k];
    if (v !== undefined && v !== null) cfg[k] = v;
  }
  let r: { tap: number; hold: number; burst: number };
  try {
    const raw = opt.ratios as Record<string, unknown>;
    r = { tap: Number(raw.tap), hold: Number(raw.hold), burst: Number(raw.burst) };
    if ([r.tap, r.hold, r.burst].some((x) => Number.isNaN(x))) throw new Error('nan');
  } catch {
    throw new AnalysisError('노트 종류 비율은 단타·롱노트·연타 세 가지를 모두 숫자로 입력해 주세요.');
  }
  const rsum = r.tap + r.hold + r.burst;
  if (Math.min(r.tap, r.hold, r.burst) < 0 || Math.abs(rsum - 100.0) > 0.5) {
    throw new AnalysisError(`노트 종류 비율의 합이 100%가 되어야 합니다. (지금은 ${rsum.toFixed(0)}%)`);
  }
  const holdBeats = Number(opt.hold_beats);
  const burstCount = Math.trunc(Number(opt.burst_count));
  if (Number.isNaN(holdBeats) || Number.isNaN(burstCount)) throw new AnalysisError('롱노트 기본 길이와 연타 기본 횟수는 숫자로 입력해 주세요.');
  if (!(holdBeats >= 0.25 && holdBeats <= 16)) throw new AnalysisError('롱노트 기본 길이는 0.25~16박 사이로 입력해 주세요.');
  if (!(burstCount >= 3 && burstCount <= 100)) throw new AnalysisError('연타 기본 횟수는 3~100회 사이로 입력해 주세요.');
  const keyMode = opt.key_mode === undefined ? 2 : Number(opt.key_mode);
  if (keyMode !== 2 && keyMode !== 4) throw new AnalysisError('키 모드는 2키 또는 4키 중에서 골라 주세요.');
  const fkRange: Record<string, any> = presets.four_key ?? {};
  const [dMin, dMax] = (fkRange.density_range as number[] | undefined) ?? [1.0, 1.6];
  const [sMin, sMax] = (fkRange.simultaneous_range as number[] | undefined) ?? [0, 30];
  const fkDensity = opt.four_key_density === undefined || opt.four_key_density === null ? null : Number(opt.four_key_density);
  const fkSim = opt.four_key_simultaneous === undefined || opt.four_key_simultaneous === null ? null : Number(opt.four_key_simultaneous);
  if (fkDensity !== null && !(fkDensity >= dMin! - 1e-9 && fkDensity <= dMax! + 1e-9)) throw new AnalysisError(`4키 노트 양 배율은 ${dMin}~${dMax} 사이로 입력해 주세요.`);
  if (fkSim !== null && !(fkSim >= sMin! && fkSim <= sMax!)) throw new AnalysisError(`동시 노트 비율은 ${sMin}~${sMax}% 사이로 입력해 주세요.`);
  if (!(LANE_MODES as readonly string[]).includes(opt.lane_mode)) throw new AnalysisError('알 수 없는 레인 배분 방식입니다.');
  if (![4, 8, 12, 16, 24, 32].includes(Math.trunc(Number(cfg.grid_division)))) throw new AnalysisError('격자는 4·8·12·16·24·32 중에서 골라 주세요.');
  const level = String(opt.grid_tolerance);
  const tolTable: Record<string, number> = gen.grid_tolerance_presets;
  if (!(level in tolTable)) throw new AnalysisError('박자 맞춤 정도는 엄격·보통·느슨 중에서 골라 주세요.');
  const tolerance = level === 'strict' ? Number(gen.grid_tolerance_ms) : Number(tolTable[level]);
  const mode = String(opt.design_mode || 'classic');
  if (!(refrules.DESIGN_MODES as readonly string[]).includes(mode)) {
    throw new AnalysisError('디자인 모드는 기존 방식(classic), 레퍼런스 규칙(reference), 통합 규칙(unified) 중에서 골라 주세요.');
  }
  // [14] 레퍼런스·통합 모드: 사용자가 바꾼 공통 칸과 고급 규칙 (바꾸지 않으면 규칙 기본값 그대로 = 이전과 같은 결과)
  const userSet: string[] = Array.isArray(opt.user_set) ? opt.user_set.filter((k: unknown) => ['ratios', 'hold_beats', 'burst_count', 'density'].includes(String(k))).map(String) : [];
  const densityScale = opt.density_scale === undefined || opt.density_scale === null ? null : Number(opt.density_scale);
  if (densityScale !== null && !(densityScale > 0 && densityScale <= 2)) throw new AnalysisError('노트 양은 10~100% 사이로 골라 주세요.');
  const ruleOverrides: Record<string, number> = opt.rule_overrides && typeof opt.rule_overrides === 'object' ? { ...opt.rule_overrides } : {};
  if (mode === 'reference' || mode === 'unified') {
    const probe = mode === 'reference' ? refrules.rulesFor(diff, presets) : unified.rulesFor(diff, presets);
    const problem = applyRuleOverrides(mode, probe, ruleOverrides);
    if (problem) throw new AnalysisError(problem);
  }
  const resolved: ResolvedOptions = {
    design_mode: 'classic', rules: null, ramp: null,
    grid_tolerance_level: level, grid_tolerance_cap_quarter: level !== 'strict',
    ratios: r, hold_beats: holdBeats, burst_count: burstCount, difficulty: diff,
    lane_mode: opt.lane_mode, key_mode: keyMode, four_key_density: fkDensity, four_key_simultaneous: fkSim,
    user_set: userSet, user_values: { ratios: { ...r }, hold_beats: holdBeats, burst_count: burstCount }, density_scale: densityScale, rule_overrides: ruleOverrides,
    grid_division: Math.trunc(Number(cfg.grid_division)), nps_base: Number(cfg.nps_base),
    max_nps: Number(cfg.max_nps), min_gap_ms: Number(cfg.min_gap_ms),
    grid_tolerance_ms: tolerance, burst_gap_ms: Number(gen.burst_gap_ms),
    burst_min_hits: Math.trunc(Number(gen.burst_min_hits)), hold_cap_multiplier: Number(gen.hold_cap_multiplier), burst_max_beats: Number(gen.burst_max_beats),
    seed: Math.trunc(Number(gen.seed)), level_name: cfg.name ?? diff,
  };
  if (mode === 'reference') {
    const rules = refrules.rulesFor(diff, presets);
    applyRuleOverrides('reference', rules, ruleOverrides);
    refrules.applyToOptions(resolved, rules);
    applyUserCommon(resolved); // 사용자가 바꾼 칸만 규칙 값 위에 덮어쓴다 (노트 양은 nps_base 로 이미 들어와 있다)
  }
  else if (mode === 'unified') resolved.design_mode = 'unified'; // 구간·목표 밀도는 곡 정보가 필요해 generateChart() 에서 이어서 적용한다
  removeBurstFromOptions(resolved);
  return resolved;
}

/**
 * [2.2] 새 채보는 단타·롱노트만 만든다. 옛 저장 옵션·규칙 기본값에 연타 비율이 있어도 0으로 돌리고(그만큼은 단타로),
 * 노트가 오래 빈 곳에 연타를 끼워 넣는 옵션도 끈다. 규칙·사용자 값이 옵션을 덮어쓴 뒤마다 다시 부른다.
 */
function removeBurstFromOptions(opt: ResolvedOptions): void {
  opt.ratios = { tap: opt.ratios.tap + opt.ratios.burst, hold: opt.ratios.hold, burst: 0 };
  opt.allow_burst = false;
}

/** [14] 통합 모드에서 계획의 연타(사용자가 연타 비율을 넣은 경우)를 연타 spec 으로. 횟수 규칙은 lanes.ts 와 같다(초당 9.6회 상한, 3~100회) */
function burstsFromPlans(plans: NotePlan[], bpmMap: BpmMap, defaultCount: number): unified.BurstSpec[] {
  const out: unified.BurstSpec[] = [];
  for (const p of plans) {
    if (p.type !== 'burst') continue;
    const lenSec = (bpmMap.tickToMs(p.tick + p.length_tick) - bpmMap.tickToMs(p.tick)) / 1000.0;
    let count = p.count ? p.count : Math.trunc(Math.min(100, Math.max(3, pyRound(defaultCount * lenSec))));
    count = Math.max(3, Math.min(count, Math.trunc(9.6 * lenSec), 100));
    if (Math.trunc(9.6 * lenSec) < 3) continue;
    out.push([p.tick, 'burst', 'both', p.length_tick, count]);
  }
  return out;
}

/** [14] 사용자가 바꾼 공통 칸(비율·롱노트 길이·연타 횟수)을 규칙 값 위에 덮어쓴다 */
function applyUserCommon(opt: ResolvedOptions): void {
  const u = opt.user_values;
  if (opt.user_set.includes('ratios')) opt.ratios = { ...u.ratios };
  if (opt.user_set.includes('hold_beats')) opt.hold_beats = u.hold_beats;
  if (opt.user_set.includes('burst_count')) opt.burst_count = u.burst_count;
}

/** 초당 노트 수(시작 기준): 평균, 최댓값(1초 창), 90번째 백분위. */
export function npsStats(notes: ChartNote[], bpmMap: BpmMap): NpsStats {
  if (!notes.length) return { avg: 0.0, max: 0.0, p90: 0.0 };
  const times = notes.map((n) => bpmMap.tickToMs(n.tick)).sort((a, b) => a - b).map((t) => t / 1000.0);
  const span = Math.max(times[times.length - 1]! - times[0]!, 1.0);
  const counts: number[] = [];
  let j = 0;
  for (let i = 0; i < times.length; i++) {
    while (times[i]! - times[j]! >= 1.0) j += 1;
    counts.push(i - j + 1);
  }
  const perSec = new Array<number>(Math.floor(times[times.length - 1]! - times[0]!) + 1).fill(0);
  for (const t of times) perSec[Math.floor(t - times[0]!)]! += 1;
  const sorted = [...perSec].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * 0.9;
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const p90 = sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
  return { avg: Math.round((times.length / span) * 100) / 100, max: Math.max(...counts), p90 };
}

/** 노트 종류별 개수와 실제 비율(%). */
export function typeStats(notes: ChartNote[]): TypeStats {
  const total = notes.length;
  const out: TypeStats = { total, tap: 0, hold: 0, burst: 0, tap_percent: 0, hold_percent: 0, burst_percent: 0 };
  for (const t of ['tap', 'hold', 'burst'] as const) {
    const c = notes.filter((n) => n.type === t).length;
    out[t] = c;
    out[`${t}_percent`] = total ? Math.round((1000.0 * c) / total) / 10 : 0.0;
  }
  return out;
}

/** 02단계 검증을 실행해 오류·경고 요약을 만든다. */
export function validationSummary(chart: ChartV2, limit = 30): ValidationSummary {
  const issues = validateIssues(chart);
  return {
    error_count: issues.filter((i) => i.level === ERROR).length,
    warning_count: issues.filter((i) => i.level !== ERROR).length,
    items: issues.slice(0, limit),
  };
}

/** 계약 함수: ④⑤ 실행. 분석 결과가 없으면 '먼저 분석을 해 주세요'. */
export function generateChart(analysis: AnalysisResult, options?: GenerateOptions): GenerateResult {
  if (!analysis) throw new AnalysisError('먼저 분석을 해 주세요. 분석 결과가 있어야 노트를 만들 수 있습니다.');
  const presets = loadPresets();
  const opt = resolveOptions(options, presets);
  const timing = analysis.timing;
  const customMap = options?.bpm_map && options.bpm_map.length ? options.bpm_map : null; // [04e] 채보에 저장된 BPM 구간 전체
  const offset = customMap && options?.audio_offset_ms !== undefined && options.audio_offset_ms !== null ? Number(options.audio_offset_ms) : Number(timing.audio_offset_ms);
  const bpmMap = customMap ? new BpmMap(customMap) : new BpmMap([{ tick: 0, bpm: Number(timing.bpm), beats_per_bar: 4, beat_unit: 4 }]);
  const durationMs = Number(analysis.info.duration_ms);
  let cands = analysis.candidates;
  let planDurationMs = durationMs;
  if (opt.design_mode === 'unified') {
    // 통합 규칙: 구간·목표 밀도·연타 허용을 반영한다
    const uRules = unified.rulesFor(opt.difficulty, presets);
    applyRuleOverrides('unified', uRules, opt.rule_overrides); // [14] 고급 규칙 (범위는 resolveOptions 에서 이미 확인)
    unified.applyToOptions(opt, uRules, options, durationMs, offset);
    // [14] 사용자가 바꾼 공통 칸: 비율을 바꾸면 "늘어지는 소리에서만 롱노트" 대신 비율대로 롱노트를 만들 수 있게 한다.
    // 노트 양 슬라이더는 목표 초당 노트 수를 직접 넣지 않았을 때만 규칙 기본 밀도에 곱한다(목표 초당 노트 수가 우선).
    applyUserCommon(opt);
    removeBurstFromOptions(opt); // [2.2] 규칙·사용자 값이 연타를 되살리지 못하게 한다
    if (opt.user_set.includes('ratios')) opt.hold_music_only = false;
    const hasTarget = options?.target_nps !== undefined && options.target_nps !== null && String(options.target_nps) !== '';
    if (opt.user_set.includes('density') && opt.density_scale !== null && !hasTarget) {
      opt.nps_base *= opt.density_scale;
      opt.max_nps *= Math.max(1, opt.density_scale);
    }
    cands = unified.filterCandidates(cands, opt.range_start_ms as number, opt.range_end_ms as number);
    planDurationMs = (opt.range_end_ms as number) - unified.EDGE_END_MS + 30; // 롱노트도 끝 1초 전에 끝난다
  }
  // [13단계] 4키: 계획 단계부터 4키 기준 — 목표 밀도(통합 모드는 목표 초당 노트 수가 들어간 nps_base)에 4키 배율을 곱한다. 2키 경로는 그대로
  const fk: FourKeyConfig | null = opt.key_mode === 4 ? fourKeyConfig(presets, opt.difficulty, opt.four_key_density, opt.four_key_simultaneous) : null;
  if (fk !== null) {
    opt.nps_base *= fk.density;
    opt.max_nps *= fk.density;
  }
  if (opt.grid_tolerance_cap_quarter) {
    // 느슨해도 격자 칸 간격의 1/4 는 넘지 않는다 (노트가 소리와 너무 어긋나지 않게)
    const fastestBpm = customMap ? Math.max(...bpmMap.entries.map((e) => e.bpm)) : Number(timing.bpm); // 변속 곡은 가장 빠른 구간 기준
    const cellMs = ((60000.0 / fastestBpm) * 4.0) / opt.grid_division;
    opt.grid_tolerance_ms = Math.min(opt.grid_tolerance_ms, cellMs / 4.0);
  }
  let [plans, planInfo] = planNotes(cands, bpmMap, offset, planDurationMs, opt);
  let fatigueRemoved = 0;
  let unifiedProblems: string[] = [];
  let notes: ChartNote[];
  let laneInfo: Record<string, number>;
  let fourKeyInfo: import('./lanes4.ts').FourKeyInfo | null = null;
  if (opt.design_mode === 'unified') {
    const rules = opt.rules as Record<string, any>;
    [plans] = unified.clipPlans(plans, bpmMap, offset, opt.range_start_ms as number, opt.range_end_ms as number);
    [plans, fatigueRemoved] = unified.limitRuns(plans, bpmMap, rules);
    const step = Math.floor((RESOLUTION * 4) / opt.grid_division);
    let specs: unified.NoteSpec[];
    // [14] 사용자가 연타 비율을 넣었을 때만 계획에 연타가 생긴다 (규칙 기본값 = 연타 비율 0 이면 이전과 같은 경로)
    let planBursts: unified.BurstSpec[] = [];
    if (fk !== null) {
      // 4키: 2레인 배정(unified.buildNotes) 대신 손 기준 배정. 같은 레인 최소 간격은 통합 규칙 값을 그대로 쓴다
      fk.sameLaneGapMs = Number(rules.same_lane_gap_ms ?? 0);
      fk.burstDefaultCount = opt.burst_count;
      const r4 = buildFourKeyNotes(plans, bpmMap, fk, opt.seed);
      specs = r4.specs;
      planBursts = r4.bursts;
      laneInfo = { ...r4.info };
      fourKeyInfo = r4.info;
    } else {
      const hasBurst = plans.some((p) => p.type === 'burst');
      const [sp, li] = unified.buildNotes(hasBurst ? plans.filter((p) => p.type !== 'burst') : plans, bpmMap, rules, opt.seed, step);
      specs = sp;
      laneInfo = li;
      if (hasBurst) planBursts = burstsFromPlans(plans, bpmMap, opt.burst_count);
    }
    let bursts: unified.BurstSpec[] = [...planBursts];
    if (opt.allow_burst) {
      const spanMin = ((opt.range_end_ms as number) - (opt.range_start_ms as number)) / 60000.0;
      // 이미 둔 연타도 "빈 곳" 계산에 넣어 겹치지 않게 한다
      const occupied: unified.NoteSpec[] = planBursts.length ? [...specs, ...planBursts.map((b) => [b[0], 'burst', -1, b[3]] as unified.NoteSpec)] : specs;
      bursts = bursts.concat(unified.placeBursts(
        occupied, bpmMap, rules, (opt.range_end_ms as number) - unified.EDGE_END_MS - offset, step,
        pyRound(spanMin * Number(rules.bursts_per_min)),
      ));
    }
    notes = unified.toNotes(specs, bursts);
    laneInfo.burst_placed = bursts.length;
    unifiedProblems =
      fk !== null
        ? checkRules4(notes, bpmMap, offset, (opt.range_start_ms as number) + unified.EDGE_START_MS - 1, (opt.range_end_ms as number) - unified.EDGE_END_MS + 1, Number(rules.same_lane_gap_ms ?? 0))
        : unified.checkRules(notes, bpmMap, offset, opt.range_start_ms as number, opt.range_end_ms as number, rules);
  } else {
    if (opt.design_mode === 'reference') [plans, fatigueRemoved] = refrules.limitDensity(plans, bpmMap, opt.rules as Record<string, any>);
    if (fk !== null) {
      // 4키: 2레인 배정(lanes.buildNotes: 반대 레인 이동·단타 변환·드롭) 대신 손 기준 배정
      fk.burstDefaultCount = opt.burst_count;
      fk.burstRestTicks = opt.rules ? Math.trunc(Number(opt.rules.burst_rest_beats ?? 0) * RESOLUTION) : 0;
      const r4 = buildFourKeyNotes(plans, bpmMap, fk, opt.seed);
      notes = unified.toNotes(r4.specs, r4.bursts);
      laneInfo = { ...r4.info };
      fourKeyInfo = r4.info;
    } else {
      [notes, laneInfo] = buildLaneNotes(plans, opt.lane_mode, opt.seed, opt.burst_count, bpmMap, opt.rules);
    }
  }

  let fourKeyMsg = '';
  if (fk !== null && fourKeyInfo !== null) {
    const fi = fourKeyInfo;
    const cut = fi.dropped_no_lane;
    fourKeyMsg =
      `4키 모드로 만들었습니다 (양손 기준 · 노트 양 ×${fk.density} · 동시 노트 목표 ${fk.simultaneousPercent}% → 실제 ${fi.simultaneous_percent}% · 왼손 ${fi.left_hand_percent}%).` +
      (cut ? ` 손 규칙(같은 손 간격·롱노트 누르는 손)을 지킬 수 없어 노트 ${cut}개를 뺐습니다.` : '') +
      (fi.hold_to_tap ? ` 롱노트 ${fi.hold_to_tap}개는 다른 롱노트와 겹쳐 단타로 바꿨습니다.` : '');
  }
  const chart = newChart(analysis.song, '', '', Math.round(durationMs), offset);
  if (opt.key_mode === 4) {
    chart.keyMode = 4;
    chart.lanes = 4;
  }
  chart.song.audio_sha256 = analysis.audio_sha256 ?? '';
  chart.timing.bpm_map = bpmMap.toList();
  chart.timing.grid_map = [{ tick: 0, division: opt.grid_division }];
  chart.difficulties = [{ name: opt.difficulty, level: 0, notes }];
  chart.meta.created_by_engine = `pipeline-v0.1:${analysis.options.detector}`;

  const stats = typeStats(notes);
  stats.requested_percent = opt.ratios;
  stats.nps = npsStats(notes, bpmMap);
  const process: Record<string, number> = { ...planInfo };
  for (const [k, v] of Object.entries(laneInfo)) process[`lane_${k}`] = v;
  process.fatigue_removed = fatigueRemoved;
  stats.process = process;
  stats.design_mode = opt.design_mode;
  stats.rule_problems = unifiedProblems.length;
  const messages: string[] = [];
  if (fourKeyMsg) messages.push(fourKeyMsg);
  if (opt.design_mode === 'unified') {
    messages.push(
      `통합 규칙 모드로 만들었습니다 (${opt.level_name} 기준 · 노트 구간 ${(((opt.range_start_ms as number) + unified.EDGE_START_MS) / 1000.0).toFixed(1)}~${(((opt.range_end_ms as number) - unified.EDGE_END_MS) / 1000.0).toFixed(1)}초).`,
    );
    if (fatigueRemoved) messages.push(`촘촘한 구간이 길게 이어져 단타 ${fatigueRemoved}개를 줄였습니다.`);
    if (laneInfo.dropped_no_lane) messages.push(`레인 규칙(같은 레인 간격·연속·번갈아 한도)을 지킬 수 없어 노트 ${laneInfo.dropped_no_lane}개를 뺐습니다.`);
    if (laneInfo.inner_dropped) messages.push(`롱노트 중 노트 한도 때문에 ${laneInfo.inner_dropped}개를 뺐습니다.`);
    if (unifiedProblems.length) messages.push(`규칙 점검: ${unifiedProblems.length}건 — ${unifiedProblems[0]}`);
    else messages.push('규칙 점검 통과: 구간 안, 같은 레인 간격, 겹침 없음.');
  }
  if (opt.design_mode === 'reference') {
    messages.push(`레퍼런스 규칙 모드로 만들었습니다 (실제 채보 분포 기준 레인·밀도 규칙, ${opt.level_name}).`);
    if (fatigueRemoved) messages.push(`고밀도 구간이 너무 길게 이어져 단타 ${fatigueRemoved}개를 줄였습니다.`);
  }
  if (opt.design_mode === 'reference' || opt.design_mode === 'unified') {
    const changed = opt.user_set.length + Object.keys(opt.rule_overrides).length;
    messages.push(changed ? `규칙 기본값에서 바꾼 항목 ${changed}개를 적용했습니다.` : '규칙 기본값 그대로 만들었습니다.');
  }
  if (stats.total === 0) messages.push('만들어진 노트가 없습니다. 분석의 지점 민감도를 올리거나 난이도를 바꿔 보세요.');
  const pi = stats.process;
  if (pi.dropped_grid) messages.push(`박자에 맞지 않아 ${pi.dropped_grid}개는 사용하지 않았습니다.`);
  const kinds: ['burst' | 'hold', string, string][] = [
    ['burst', '연타', '연타를 만들 만큼 노트가 몰린 곳이 부족해'],
    ['hold', '롱노트', '롱노트를 만들 만큼 노트 사이가 넓은 곳이 부족해'],
  ];
  for (const [key, label, why] of kinds) {
    const want = opt.ratios[key];
    const got = stats[`${key}_percent`];
    if (stats.total && want > 0 && got < want - 3 && opt.design_mode === 'classic') {
      messages.push(`${label} ${want.toFixed(0)}%를 요청했지만 ${why} ${got.toFixed(1)}%까지만 만들었습니다.`);
    }
    if (stats[key]) {
      const made = pi[`${key}_made`] ?? 0;
      const music = Math.max(0, stats[key] - made);
      if (made) {
        messages.push(`${label} ${stats[key]}개 중 ${music}개는 음악에서 찾았고 ${made}개는 노트를 ${key === 'burst' ? '묶어서' : '늘려서'} 만들었습니다.`);
      }
    }
  }
  const ext = pi.burst_speed_extended ?? 0;
  const red = pi.burst_count_reduced ?? 0;
  if (ext) messages.push(`연타 ${ext}개는 너무 빠르게 눌러야 해서 길이를 늘렸습니다.`);
  if (red) messages.push(`연타 ${red}개는 길이가 ${opt.burst_max_beats}박을 넘지 않도록 횟수를 줄였습니다.`);
  return {
    notes,
    difficulty: chart.difficulties[0]!,
    timing: { bpm_map: chart.timing.bpm_map, grid_map: chart.timing.grid_map, audio_offset_ms: offset, source: timing.source },
    stats,
    validation: validationSummary(chart),
    messages,
    options_used: {
      design_mode: opt.design_mode, ratios: opt.ratios, hold_beats: opt.hold_beats, burst_count: opt.burst_count, difficulty: opt.difficulty,
      lane_mode: opt.lane_mode, key_mode: opt.key_mode, grid_division: opt.grid_division, grid_tolerance_ms: opt.grid_tolerance_ms, grid_tolerance_level: opt.grid_tolerance_level,
    },
    chart,
  };
}
