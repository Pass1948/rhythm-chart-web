/**
 * [14단계] 디자인 모드 조절 칸(A안): 세 모드 공통 칸의 규칙 기본값과 [고급 규칙] 칸 정의(이름·설명·범위). 순수 모듈 — 생성 코드와 편집기 화면이 같이 쓴다.
 * 모드의 차이는 "어떤 규칙을 지키는가"이고, 조절 칸은 세 모드 모두 같다. 사용자가 바꾸지 않은 값은 규칙 기본값 그대로 쓴다.
 */

export type DesignMode = 'classic' | 'reference' | 'unified';

/** 공통 칸 (세 모드 모두): 노트 종류 비율·롱노트 기본 길이·연타 기본 횟수·노트 양(슬라이더 %) */
export interface CommonValues {
  ratios: { tap: number; hold: number; burst: number };
  hold_beats: number;
  burst_count: number;
  /** 노트 양 슬라이더 (10~100, 기본 55) */
  density: number;
}
export const COMMON_KEYS = ['ratios', 'hold_beats', 'burst_count', 'density'] as const;
export type CommonKey = (typeof COMMON_KEYS)[number];
export const DEFAULT_DENSITY = 55;
/** 기존 방식의 기본값 (이 모드는 규칙이 없으므로 화면의 처음 값) */
export const CLASSIC_DEFAULTS: CommonValues = { ratios: { tap: 70, hold: 20, burst: 10 }, hold_beats: 1, burst_count: 8, density: DEFAULT_DENSITY };

/**
 * 고른 모드·난이도의 공통 칸 기본값. rules = 그 모드·난이도의 규칙(rulesFor 결과). 기존 방식은 CLASSIC_DEFAULTS.
 * 통합 규칙은 연타를 비율이 아니라 "빈 곳에 연타 넣기"로 정하므로 연타 비율 기본값은 0, 롱노트 비율 = hold_percent.
 */
export function commonDefaults(mode: DesignMode, rules: Record<string, any> | null): CommonValues {
  if (mode === 'reference' && rules) {
    const r = rules.ratios ?? CLASSIC_DEFAULTS.ratios;
    return { ratios: { tap: Number(r.tap), hold: Number(r.hold), burst: Number(r.burst) }, hold_beats: Number(rules.hold_beats), burst_count: Math.trunc(Number(rules.burst_count)), density: DEFAULT_DENSITY };
  }
  if (mode === 'unified' && rules) {
    const hold = Number(rules.hold_percent);
    return { ratios: { tap: 100 - hold, hold, burst: 0 }, hold_beats: Number(rules.hold_beats), burst_count: CLASSIC_DEFAULTS.burst_count, density: DEFAULT_DENSITY };
  }
  return JSON.parse(JSON.stringify(CLASSIC_DEFAULTS)) as CommonValues;
}

/** 두 공통 값이 같은가 (비율은 소수 첫째 자리까지 비교) */
export function sameCommon(key: CommonKey, a: unknown, b: unknown): boolean {
  if (key === 'ratios') {
    const x = a as CommonValues['ratios'];
    const y = b as CommonValues['ratios'];
    return !!x && !!y && ['tap', 'hold', 'burst'].every((k) => Math.abs(Number((x as any)[k]) - Number((y as any)[k])) < 0.05);
  }
  return Math.abs(Number(a) - Number(b)) < 1e-9;
}

// ---------- 고급 규칙 칸 ----------

export interface RuleField {
  key: string;
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  integer: boolean;
  /** 규칙 객체에서 값 읽기 / 쓰기 (dense_limits 처럼 배열 안의 값도 다룬다) */
  get(rules: Record<string, any>): number;
  set(rules: Record<string, any>, value: number): void;
}

function plain(key: string, label: string, help: string, min: number, max: number, step: number, integer = false): RuleField {
  return {
    key, label, help, min, max, step, integer,
    get: (r) => Number(r[key]),
    set: (r, v) => {
      r[key] = v;
    },
  };
}

/** 고밀도 연속 허용 시간(초) = dense_limits 첫 줄의 두 번째 값 */
const denseSec: RuleField = {
  key: 'dense_sec', label: '고밀도 연속 허용 시간(초)', help: '8분음표보다 촘촘한 단타가 이 시간보다 길게 이어지면 단타를 빼서 쉬는 틈을 만듭니다.',
  min: 0.5, max: 30, step: 0.5, integer: false,
  get: (r) => Number((r.dense_limits ?? [[0.5, 3]])[0]?.[1] ?? 3),
  set: (r, v) => {
    const list = Array.isArray(r.dense_limits) && r.dense_limits.length ? r.dense_limits.map((x: number[]) => [...x]) : [[0.5, v]];
    list[0][1] = v;
    r.dense_limits = list;
  },
};

export const RULE_FIELDS: Record<'reference' | 'unified', RuleField[]> = {
  reference: [
    plain('switch_prob', '레인 전환 확률', '직전 노트와 다른 레인으로 바꿀 확률입니다. 높을수록 좌우가 자주 바뀝니다.', 0, 1, 0.01),
    plain('max_same_lane_run', '같은 레인 최대 연속', '같은 레인이 이 개수만큼 이어지면 반대 레인으로 바꿉니다.', 2, 30, 1, true),
    plain('max_zigzag', '지그재그 한도', '촘촘한 구간에서 좌우 번갈아가 이 횟수만큼 이어지면 같은 레인을 유지합니다.', 1, 16, 1, true),
    plain('hold_inner_max', '롱노트 중 노트 수', '롱노트 하나를 누르는 동안 둘 수 있는 다른 노트 수입니다. 0이면 두지 않습니다.', 0, 8, 1, true),
    plain('burst_rest_beats', '연타 뒤 휴지(박)', '연타가 끝난 뒤 다른 노트를 두지 않는 길이입니다.', 0, 8, 0.25),
    denseSec,
  ],
  unified: [
    plain('max_nps', '최대 초당 노트 수', '1초 안에 들어갈 수 있는 노트 수의 한도입니다.', 1, 15, 0.5),
    plain('global_gap_ms', '전체 최소 간격(ms)', '두 레인을 합쳐 노트 사이의 최소 간격입니다.', 30, 1000, 10, true),
    plain('same_lane_gap_ms', '같은 레인 최소 간격(ms)', '같은 레인에서 앞 노트와의 최소 간격입니다.', 0, 500, 10, true),
    plain('hold_inner_cap', '롱노트 중 노트 한도', '롱노트 하나를 누르는 동안 둘 수 있는 다른 노트의 최대 수입니다.', 0, 10, 1, true),
    plain('run_dense', '촘촘한 연속 개수', '촘촘한 구간에서 같은 레인이 이어질 수 있는 최대 개수입니다.', 1, 20, 1, true),
    plain('run_sparse', '느슨한 연속 개수', '느슨한 구간에서 같은 레인이 이어질 수 있는 최대 개수입니다.', 1, 40, 1, true),
    plain('bursts_per_min', '분당 연타 수', '"연타 넣기"를 켰을 때 1분에 넣을 수 있는 연타 수입니다.', 0, 10, 0.5),
    plain('burst_min_gap_s', '연타 최소 간격(초)', '노트가 이 시간 이상 비어 있는 곳에만 연타를 넣습니다.', 0.5, 20, 0.5),
    plain('burst_max_len_s', '연타 최대 길이(초)', '연타 하나의 최대 길이입니다.', 0.5, 10, 0.5),
  ],
};

/** 고급 규칙 값 하나가 범위 안인지. 문제가 있으면 쉬운 한국어 문구, 없으면 '' */
export function ruleValueProblem(field: RuleField, value: unknown): string {
  const v = Number(value);
  if (!Number.isFinite(v)) return `[고급 규칙] ${field.label}에는 숫자를 입력해 주세요.`;
  if (v < field.min || v > field.max) return `[고급 규칙] ${field.label}은(는) ${field.min}~${field.max} 사이로 입력해 주세요. (지금 ${v})`;
  if (field.integer && !Number.isInteger(v)) return `[고급 규칙] ${field.label}은(는) 정수로 입력해 주세요.`;
  return '';
}

/**
 * 규칙 객체에 사용자가 바꾼 고급 값을 덮어쓴다. 모르는 이름·범위 밖 값이면 문구를 돌려주고 규칙은 그대로 둔다(문제 없으면 '').
 * 기존 방식(classic)은 고급 규칙이 없다.
 */
export function applyRuleOverrides(mode: DesignMode, rules: Record<string, any>, overrides: Record<string, unknown> | null | undefined): string {
  if (!overrides || mode === 'classic') return '';
  const fields = RULE_FIELDS[mode];
  for (const [k, v] of Object.entries(overrides)) {
    const f = fields.find((x) => x.key === k);
    if (!f) return `알 수 없는 고급 규칙 항목입니다: ${k}`;
    const p = ruleValueProblem(f, v);
    if (p) return p;
  }
  for (const [k, v] of Object.entries(overrides)) fields.find((x) => x.key === k)!.set(rules, Number(v));
  return '';
}

// ---------- 이 기기 설정에 저장하는 모양 ----------

/** 모드·난이도별로 사용자가 바꾼 값만 담는다. rules = 고급 규칙 덮어쓰기 */
export interface GenOverride {
  ratios?: CommonValues['ratios'];
  hold_beats?: number;
  burst_count?: number;
  density?: number;
  rules?: Record<string, number>;
}
export type GenOverrides = Record<string, Record<string, GenOverride>>;

/** 저장된 값을 점검한다: 모르는 모드·난이도·항목과 범위 밖 값은 버린다 */
export function sanitizeGenOverrides(raw: unknown): GenOverrides {
  const out: GenOverrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const mode of ['classic', 'reference', 'unified'] as const) {
    const byDiff = (raw as Record<string, unknown>)[mode];
    if (!byDiff || typeof byDiff !== 'object') continue;
    for (const diff of ['EASY', 'NORMAL', 'HARD', 'CUSTOM']) {
      const o = (byDiff as Record<string, any>)[diff];
      if (!o || typeof o !== 'object') continue;
      const item: GenOverride = {};
      const r = o.ratios;
      if (r && typeof r === 'object' && ['tap', 'hold', 'burst'].every((k) => Number.isFinite(Number(r[k])) && Number(r[k]) >= 0) && Math.abs(Number(r.tap) + Number(r.hold) + Number(r.burst) - 100) <= 0.5) {
        item.ratios = { tap: Number(r.tap), hold: Number(r.hold), burst: Number(r.burst) };
      }
      if (Number.isFinite(o.hold_beats) && o.hold_beats >= 0.25 && o.hold_beats <= 16) item.hold_beats = Number(o.hold_beats);
      if (Number.isInteger(o.burst_count) && o.burst_count >= 3 && o.burst_count <= 100) item.burst_count = o.burst_count;
      if (Number.isFinite(o.density) && o.density >= 10 && o.density <= 100) item.density = Number(o.density);
      if (mode !== 'classic' && o.rules && typeof o.rules === 'object') {
        const rules: Record<string, number> = {};
        for (const f of RULE_FIELDS[mode]) {
          const v = o.rules[f.key];
          if (v !== undefined && !ruleValueProblem(f, v)) rules[f.key] = Number(v);
        }
        if (Object.keys(rules).length) item.rules = rules;
      }
      if (Object.keys(item).length) (out[mode] ??= {})[diff] = item;
    }
  }
  return out;
}
