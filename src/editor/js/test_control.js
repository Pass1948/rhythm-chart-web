// [테스트] 팝업의 멈춤·이어하기·중지 집계·재생 속도 규칙 — 화면과 분리된 순수 모듈 (Node 로 테스트한다).
// 채보 데이터는 바꾸지 않는다. 판정 폭(judge.json)은 실제(사람 손) 시간 기준 ms 로 유지한다.

export const RATE_MIN = 0.25;
export const RATE_MAX = 1.5;
export const RATE_STEP = 0.05;
export const RATE_PRESETS = [0.5, 0.75, 1, 1.25];

// 입력한 속도를 0.25~1.5, 0.05 단위로 맞춘다. {value, note}. 숫자가 아니면 fallback 으로 되돌린다.
export function clampRate(raw, fallback = 1) {
  const n = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(n)) {
    return { value: fallback, note: '숫자만 입력해 주세요. 이전 속도로 되돌렸습니다.' };
  }
  const stepped = Math.round(n / RATE_STEP) * RATE_STEP;
  const value = Math.round(Math.max(RATE_MIN, Math.min(RATE_MAX, stepped)) * 100) / 100;
  const changed = Math.abs(value - n) > 1e-9;
  return { value, note: changed ? `속도는 ${RATE_MIN}~${RATE_MAX}배, ${RATE_STEP} 단위만 쓸 수 있어 ${value}배로 맞췄습니다.` : '' };
}

// 판정 폭을 곡 시간 기준으로 바꾼다: 곡 시간 오차 ÷ 속도 = 실제 오차 이므로, 폭에 속도를 곱해 곡 시간끼리 비교한다.
export function scaleCfg(cfg, rate) {
  const out = { ...cfg };
  for (const k of Object.keys(cfg)) if (typeof cfg[k] === 'number') out[k] = cfg[k] * rate;
  return out;
}

// 곡 시간 오차(ms) → 실제 오차(ms). 0.5배에서 곡 시간 +90ms = 실제 +180ms
export function toRealMs(songMs, rate) {
  return songMs / rate;
}

// 누른 시각을 보정한다: 입력 지연 보정(실제 ms)을 곡 시간으로 바꿔서 뺀다
export function adjustTimeRate(songPosMs, latencyMs, rate) {
  return songPosMs - latencyMs * rate;
}

// 일시정지: 그 시점에 진행 중이던 롱노트·연타(누르는 중이거나 연타 구간 안)는 결과에서 제외한다. 제외한 개수를 돌려준다.
export function excludeInProgress(items, posMs) {
  let n = 0;
  for (const it of items) {
    if (it.state === 'done') continue;
    const inBurst = it.note.type === 'burst' && posMs >= it.startMs;
    if (it.state === 'active' || inBurst) { it.state = 'done'; it.excluded = true; n++; }
  }
  return n;
}

// [중지]: 아직 판정이 끝나지 않은 노트(안 나온 노트·진행 중)는 모두 집계에서 제외한다
export function excludeUnfinished(items) {
  for (const it of items) {
    if (it.state !== 'done') { it.state = 'done'; it.excluded = true; }
  }
}

// 집계에 들어가는 노트
export function countedItems(items) {
  return items.filter((it) => !it.excluded);
}

// 결과 맨 위 속도 안내 (모두 1배면 빈 글자). rates = 이번 테스트에서 쓴 속도들
export function rateNotice(rates) {
  const list = [...rates].sort((a, b) => a - b);
  if (list.length === 1 && list[0] === 1) return '';
  if (list.length === 1) return `연습 속도 ${list[0]}배로 한 결과입니다 (1배 기록과 다릅니다)`;
  return `연습 속도를 바꿔 가며(${list.join('배, ')}배) 한 결과입니다 (1배 기록과 다릅니다)`;
}

// 보정값 권장 계산에 이 결과를 써도 되는지 (1배일 때만)
export function usableForLatency(rates) {
  return rates.size === 1 && rates.has(1);
}

// 단축키([ ])용: 지금 속도에서 한 단계 느리게(-1)/빠르게(+1). 버튼 속도(0.5/0.75/1/1.25) 사이를 오간다.
export function stepRate(cur, dir) {
  const list = RATE_PRESETS;
  if (dir > 0) return list.find((r) => r > cur + 1e-9) ?? list[list.length - 1];
  return [...list].reverse().find((r) => r < cur - 1e-9) ?? list[0];
}
