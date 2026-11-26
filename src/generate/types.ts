/**
 * 채보 생성이 주고받는 데이터 형식. (원본 generate.py 의 옵션·결과와 같은 이름)
 */
import type { BpmEntry, ChartNote, ChartV2, Difficulty } from '../core/schema.ts';
import type { Candidate } from '../analysis/types.ts';

/** 노트 종류 판별 결과(레인이 정해지기 전의 계획) */
export interface NotePlan {
  tick: number;
  type: string; // tap / hold / burst
  strength: number;
  band: string;
  length_tick: number; // hold / burst 의 희망 길이
  min_length_tick: number; // 이보다 짧아지면 단타로 되돌린다
  count: number; // 연타노트의 터치 횟수
  origin: string; // music(음악에서 나옴) / made(단타를 묶거나 늘려서 만듦)
}

/** 격자에 붙인 후보 */
export interface SnappedCandidate extends Candidate {
  tick: number;
  err_ms: number;
}

/** 생성 옵션(GenerateOptions): 사용자가 주는 값. 빠진 항목은 난이도 프리셋·기본값이 채운다. */
export interface GenerateOptions {
  ratios?: { tap: number; hold: number; burst: number };
  hold_beats?: number;
  burst_count?: number;
  difficulty?: string; // EASY / NORMAL / HARD / CUSTOM
  lane_mode?: string; // alternate / pair / accent / random
  design_mode?: string; // classic / reference / unified
  grid_tolerance?: string; // strict / normal / loose
  /** [10단계] 2(기본) | 4. 4이면 타이밍·길이는 그대로 두고 레인만 4키(0~3)로 배정한다. */
  key_mode?: number;
  /** [13단계] 4키 노트 양 배율(1.0~1.6). 없으면 난이도 기본값(presets four_key.density) */
  four_key_density?: number;
  /** [13단계] 4키 동시 노트 비율 %(0~30). 없으면 난이도 기본값(presets four_key.simultaneous_percent) */
  four_key_simultaneous?: number;
  /** [14] 레퍼런스·통합 모드에서 사용자가 규칙 기본값에서 바꾼 공통 칸 ('ratios' | 'hold_beats' | 'burst_count' | 'density'). 들어 있는 칸만 위의 값이 규칙보다 우선한다 */
  user_set?: string[];
  /** [14] 통합 모드의 노트 양 슬라이더 배율(슬라이더 ÷ 55). user_set 에 'density' 가 있고 target_nps 가 없을 때만 쓴다 */
  density_scale?: number;
  /** [14] [고급 규칙]에서 바꾼 값 (ruleFields.ts 의 RULE_FIELDS 이름) */
  rule_overrides?: Record<string, number>;
  grid_division?: number;
  nps_base?: number;
  max_nps?: number;
  min_gap_ms?: number;
  // 통합 규칙(unified) 전용
  range_start_ms?: number;
  range_end_ms?: number;
  target_nps?: number;
  allow_burst?: boolean;
  /** [04e] 채보에 저장된 BPM 구간 전체. 주면 분석의 대표 BPM으로 새로 만들지 않고 이 구간들을 그대로 쓴다(변속 곡). */
  bpm_map?: BpmEntry[];
  /** [04e] bpm_map 과 함께 쓰는 시작점(ms). 없으면 분석 값 */
  audio_offset_ms?: number;
}

/** resolve_options 결과: 생성에 실제로 쓰는 모든 설정 */
export interface ResolvedOptions {
  design_mode: string;
  rules: Record<string, any> | null;
  ramp: ((pos: number) => number) | null;
  ramp_relative?: boolean;
  grid_tolerance_level: string;
  grid_tolerance_cap_quarter: boolean;
  ratios: { tap: number; hold: number; burst: number };
  hold_beats: number;
  burst_count: number;
  difficulty: string;
  lane_mode: string;
  key_mode: number;
  four_key_density: number | null;
  four_key_simultaneous: number | null;
  /** [14] 사용자가 바꾼 공통 칸·그 값, 고급 규칙 덮어쓰기 */
  user_set: string[];
  user_values: { ratios: { tap: number; hold: number; burst: number }; hold_beats: number; burst_count: number };
  density_scale: number | null;
  rule_overrides: Record<string, number>;
  grid_division: number;
  nps_base: number;
  max_nps: number;
  min_gap_ms: number;
  grid_tolerance_ms: number;
  burst_gap_ms: number;
  burst_min_hits: number;
  hold_cap_multiplier: number;
  burst_max_beats: number;
  seed: number;
  level_name: string;
  hold_music_only?: boolean;
  range_start_ms?: number;
  range_end_ms?: number;
  allow_burst?: boolean;
}

export interface NpsStats {
  avg: number;
  max: number;
  p90: number;
}
export interface TypeStats {
  total: number;
  tap: number;
  hold: number;
  burst: number;
  tap_percent: number;
  hold_percent: number;
  burst_percent: number;
  requested_percent?: { tap: number; hold: number; burst: number };
  nps?: NpsStats;
  process?: Record<string, number>;
  design_mode?: string;
  rule_problems?: number;
}
export interface ValidationSummary {
  error_count: number;
  warning_count: number;
  items: { level: string; code: string; message: string; difficulty: string; note_ids: number[] }[];
}

/** 생성 결과(GenerateResult). 원본 generate() 의 반환값과 같다. */
export interface GenerateResult {
  notes: ChartNote[];
  difficulty: Difficulty;
  timing: { bpm_map: unknown[]; grid_map: unknown[]; audio_offset_ms: number; source: string | undefined };
  stats: TypeStats;
  validation: ValidationSummary;
  messages: string[];
  options_used: Record<string, unknown>;
  chart: ChartV2;
}
