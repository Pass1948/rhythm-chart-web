/**
 * 설정 파일(config\*.json) 읽기. 숫자는 코드에 적지 않고 이 설정 한 곳에서 읽는다.
 * 일부 항목이 없으면 기본값을 쓴다. (원본 config.py와 같은 방식)
 */
import judgeJson from '../../config/judge.json' with { type: 'json' };
import validateJson from '../../config/validate.json' with { type: 'json' };
import appJson from '../../config/app.json' with { type: 'json' };
import presetsJson from '../../config/presets.json' with { type: 'json' };

export interface JudgeConfig {
  perfect_ms: number;
  great_ms: number;
  good_ms: number;
  hold_end_tolerance_ms: number;
}
export interface ValidateConfig {
  opposite_lane_policy: string;
  max_burst_per_sec: number;
  max_same_lane_run: number;
  max_nps: number;
  max_simultaneous_ratio: number;
  min_hold_beats: number;
}
export interface AppConfig {
  analysis_sample_rate: number;
  analysis_max_minutes: number;
}

const DEFAULT_JUDGE: JudgeConfig = { perfect_ms: 45, great_ms: 95, good_ms: 150, hold_end_tolerance_ms: 0 };
const DEFAULT_VALIDATE: ValidateConfig = {
  opposite_lane_policy: 'allow',
  max_burst_per_sec: 12,
  max_same_lane_run: 8,
  max_nps: 10,
  max_simultaneous_ratio: 0.4,
  min_hold_beats: 0.25,
};
const DEFAULT_APP: AppConfig = { analysis_sample_rate: 22050, analysis_max_minutes: 12 };

/** 기본값 위에 파일 값을 덮어 쓴다(기본값에 있는 이름만). */
function overlay<T extends object>(defaults: T, data: unknown): T {
  const out: T = { ...defaults };
  if (data && typeof data === 'object') {
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const v = (data as Record<string, unknown>)[key as string];
      if (v !== undefined) out[key] = v as T[keyof T];
    }
  }
  return out;
}

export function loadJudgeConfig(): JudgeConfig {
  return overlay(DEFAULT_JUDGE, judgeJson);
}
export function loadValidateConfig(): ValidateConfig {
  return overlay(DEFAULT_VALIDATE, validateJson);
}
export function loadAppConfig(): AppConfig {
  return overlay(DEFAULT_APP, appJson);
}

/** 프리셋 파일(config\presets.json) 전체. generate가 난이도·생성 설정을 읽을 때 쓴다. */
export type Presets = Record<string, any>;
export function loadPresets(): Presets {
  return presetsJson as unknown as Presets;
}
