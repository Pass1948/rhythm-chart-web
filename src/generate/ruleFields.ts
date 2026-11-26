export const fields = [
  { key: 'handGap', label: '같은 손 간격(ms)', max: 3000, step: 1 },
  { key: 'laneGap', label: '같은 레인 간격(ms)', max: 3000, step: 1 },
  { key: 'globalGap', label: '전체 간격(ms)', max: 3000, step: 1 },
  { key: 'run', label: '빠른 연속 개수', max: 32, step: 1 },
  { key: 'window', label: '300ms 안 누름 수', max: 10, step: 1 },
  { key: 'chordGap', label: '동시 입력 앞뒤 간격(ms)', max: 3000, step: 1 },
  { key: 'chord', label: '동시 입력 상한(%)', max: 100, step: 1 },
  { key: 'nps', label: '초당 입력 수', max: 15, step: 1 },
  { key: 'handNps', label: '손당 초당 입력 수', max: 15, step: 1 },
  { key: 'holdMs', label: '최소 홀드(ms)', max: 4000, step: 1 },
  { key: 'beats', label: '최소 홀드(박)', max: 8, step: 0.25 },
  { key: 'maxHold', label: '최대 홀드(ms)', max: 8000, step: 1 },
  { key: 'release', label: '해제 후 간격(ms)', max: 3000, step: 1 },
  { key: 'inner', label: '반대 손 간격(ms, 0은 금지)', max: 3000, step: 1 },
  { key: 'hold', label: '홀드 상한(%)', max: 100, step: 1 },
] as const;
type Override = { density?: number; amount?: number; simultaneous?: number; rules?: Record<string, number> };
export type GenOverrides = Record<string, Override>;

export function sanitizeGenOverrides(raw: unknown): GenOverrides {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, any>;
  const result: GenOverrides = {};
  for (const diff of ['EASY','NORMAL','HARD','GLIITCH','CUSTOM']) {
    const entry = source[diff] ?? source.unified?.[diff];
    if (!entry) continue;
    const clean: Override = {};
    for (const [key,min,max] of [['density',10,100],['amount',0,3],['simultaneous',0,100]] as const) {
      const value = entry[key];
      if (Number.isInteger(value) && value >= min && value <= max) clean[key] = value;
    }
    const aliases: Record<string,string> = {nps:'max_nps',laneGap:'same_lane_gap_ms',globalGap:'global_gap_ms'};
    for (const field of fields) {
      const value = entry.rules?.[field.key] ?? entry.rules?.[aliases[field.key] ?? ''];
      if (Number.isFinite(value) && value >= 0 && value <= field.max && Number.isInteger(value / field.step)) {
        (clean.rules ??= {})[field.key] = value;
      }
    }
    if (Object.keys(clean).length) result[diff] = clean;
  }
  return result;
}
