// [14] 노트 생성 조절 칸(A안)의 값 계산: 고른 디자인 모드·난이도의 "규칙 기본값", 이 기기에 저장된 "사용자가 바꾼 값", 생성 요청에 넣을 값.
// 화면(panels.js)과 생성 요청(actions.js)이 같이 쓴다. 규칙 숫자 정의는 generate\ruleFields.ts 한 곳.
import { COMMON_KEYS, RULE_FIELDS, commonDefaults, sameCommon } from '../../generate/ruleFields.ts';
import { loadSettings, saveSettings } from '../../storage/settingsStore.ts';
import { S } from './state.js';
import { withoutBurst } from './ratio_rules.js';

/** 지금 고른 모드·난이도 */
export function genKey() {
  return { mode: document.getElementById('designMode').value, diff: document.getElementById('difficulty').value };
}

/** 그 모드·난이도의 규칙(서버 presets 의 rule_defaults). 기존 방식은 null */
export function rulesOf(mode, diff) {
  if (mode === 'classic') return null;
  const all = S.presets && S.presets.rule_defaults && S.presets.rule_defaults[mode];
  return (all && (all[diff] || all.NORMAL)) || null;
}

/** 공통 칸 기본값 (레퍼런스·통합은 규칙 기본값, 기존 방식은 처음 값) */
export function defaultsOf(mode, diff) {
  return commonDefaults(mode, rulesOf(mode, diff));
}

/** 이 기기에 저장된, 사용자가 바꾼 값 {ratios?, hold_beats?, burst_count?, density?, rules?} */
export function overrideOf(mode, diff) {
  const all = loadSettings().genOverrides || {};
  return (all[mode] && all[mode][diff]) || {};
}

/** 저장값을 고친다: fn(복사본) 이 바꾼 결과를 저장한다. 빈 항목은 지운다 */
export function updateOverride(mode, diff, fn) {
  const all = JSON.parse(JSON.stringify(loadSettings().genOverrides || {}));
  const cur = (all[mode] && all[mode][diff]) || {};
  const next = fn({ ...cur, rules: cur.rules ? { ...cur.rules } : undefined }) || {};
  if (next.rules && !Object.keys(next.rules).length) delete next.rules;
  if (!next.rules) delete next.rules;
  all[mode] = all[mode] || {};
  if (Object.keys(next).length) all[mode][diff] = next;
  else delete all[mode][diff];
  if (!Object.keys(all[mode]).length) delete all[mode];
  saveSettings({ genOverrides: all });
}

/** 공통 칸 하나를 저장한다: 기본값과 같으면 저장값에서 뺀다(= 규칙 기본값을 따른다) */
export function saveCommon(key, value) {
  const { mode, diff } = genKey();
  const def = defaultsOf(mode, diff);
  updateOverride(mode, diff, (o) => {
    if (sameCommon(key, value, def[key])) delete o[key];
    else o[key] = key === 'ratios' ? { ...value } : value;
    return o;
  });
}

/** 고급 규칙 칸 하나를 저장한다 (기본값과 같으면 뺀다) */
export function saveRule(key, value) {
  const { mode, diff } = genKey();
  const rules = rulesOf(mode, diff);
  const f = (RULE_FIELDS[mode] || []).find((x) => x.key === key);
  if (!f || !rules) return;
  updateOverride(mode, diff, (o) => {
    const r = { ...(o.rules || {}) };
    if (Math.abs(f.get(rules) - Number(value)) < 1e-9) delete r[key];
    else r[key] = Number(value);
    o.rules = r;
    return o;
  });
}

/** 지금 모드·난이도의 저장값을 모두 지운다 ([규칙 기본값으로 되돌리기]). 4키 조절 값(fourKeyGen)도 그 난이도 것을 지운다 */
export function resetOverrides() {
  const { mode, diff } = genKey();
  updateOverride(mode, diff, () => ({}));
  const fk = { ...(loadSettings().fourKeyGen || {}) };
  delete fk[diff];
  saveSettings({ fourKeyGen: fk });
}

/** 화면에 채울 공통 값: 저장값이 있으면 그것, 없으면 기본값 */
export function currentCommon(mode, diff) {
  const def = defaultsOf(mode, diff);
  const o = overrideOf(mode, diff);
  const out = {};
  for (const k of COMMON_KEYS) out[k] = o[k] !== undefined ? o[k] : def[k];
  out.ratios = withoutBurst(out.ratios); // [2.2] 옛 저장값·규칙 기본값의 연타 비율은 쓰지 않는다
  return out;
}

/**
 * 생성 요청에 붙일 값: 레퍼런스·통합 모드에서 규칙 기본값과 다른 공통 칸 목록(user_set), 통합 모드 노트 양 배율(density_scale), 고급 규칙(rule_overrides).
 * values = 지금 화면의 공통 값. 기존 방식은 빈 객체(요청이 이전과 같다).
 */
export function requestExtras(mode, diff, values) {
  if (mode === 'classic') return {};
  const def = defaultsOf(mode, diff);
  const userSet = COMMON_KEYS.filter((k) => !sameCommon(k, values[k], def[k]));
  const out = {};
  if (userSet.length) out.user_set = userSet;
  if (mode === 'unified' && userSet.includes('density')) out.density_scale = Math.round((values.density / 55) * 1000) / 1000;
  const rules = overrideOf(mode, diff).rules;
  if (rules && Object.keys(rules).length) out.rule_overrides = { ...rules };
  return out;
}
