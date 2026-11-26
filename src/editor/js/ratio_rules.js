// ③ 노트 자동 생성의 단타/롱노트/연타 비율 입력 규칙 — 화면과 분리된 순수 모듈 (Node 로 테스트한다).
// 단위는 0.1% 까지. 서버(generate.py)는 소수 비율을 그대로 받는다 (노트 개수만 반올림).

export const RATIO_KEYS = ['tap', 'hold', 'burst'];
const NAMES = { tap: '단타', hold: '롱노트', burst: '연타' };

const r1 = (x) => Math.round(x * 10) / 10;

// [2.2] 새 채보는 연타를 만들지 않는다: 옛 저장값에 연타 비율이 있어도 0으로 돌리고 단타 = 100 − 롱노트
export function withoutBurst(ratios) {
  const hold = Number(ratios.hold) || 0;
  return { tap: r1(100 - hold), hold, burst: 0 };
}

// 입력 글자 → 숫자 (빈 칸·글자는 null)
export function parseRatio(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace('%', '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// key 항목을 raw 로 바꾼다. 반환 {requested, note, changed}
// 규칙: 롱노트·연타는 입력한 값 그대로 고정, 단타 = 100 − 롱노트 − 연타 (자동 계산, 직접 입력 불가).
// 롱노트 + 연타가 100 을 넘으면 방금 입력한 칸을 합이 100 이 되는 값까지만 허용한다.
export function applyRatio(requested, key, raw) {
  const cur = withoutBurst(requested);
  if (key === 'tap') return { requested: cur, note: '단타는 100 − 롱노트 − 연타 로 자동 계산됩니다. 롱노트·연타를 입력해 주세요.', changed: false };
  const n = parseRatio(raw);
  if (n === null) return { requested: cur, note: '숫자만 입력해 주세요. 이전 값으로 되돌렸습니다.', changed: false };
  const other = key === 'hold' ? cur.burst : cur.hold;
  let v = r1(n);
  let note = '';
  if (v < 0 || v > 100) {
    v = Math.max(0, Math.min(100, v));
    note = `비율은 0~100% 만 쓸 수 있어 ${v}% 로 맞췄습니다.`;
  } else if (Math.abs(v - n) > 1e-9) {
    note = `소수 첫째 자리까지만 쓸 수 있어 ${v}% 로 맞췄습니다.`;
  }
  if (v + other > 100 + 1e-9) {
    v = r1(100 - other);
    note = `연타와 롱노트의 합이 100%를 넘을 수 없어 ${v}%로 맞췄습니다.`;
  }
  const out = { ...cur, [key]: v };
  out.tap = r1(100 - out.hold - out.burst);
  return { requested: out, note, changed: true };
}

// 화면 표시 글자 (정수면 소수점 없이)
export function showRatio(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
