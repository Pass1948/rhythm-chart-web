// [테스트] 팝업의 보정·키 설정·결과 분석 규칙 — 화면과 분리된 순수 모듈 (Node 로 테스트한다).
// 서버 app/core/user_settings.py 와 같은 기준이다. 채보 데이터와 내보내기 시각은 이 모듈이 바꾸지 않는다 (판정할 때 누른 시각만 보정).

export const LATENCY_MIN = -500;
export const LATENCY_MAX = 500;
export const LEAD_MIN = 500;
export const LEAD_MAX = 2000;
export const PRACTICE_BEATS = 4;   // 지연 측정에서 계산에서 빼는 처음 박 수
export const MEASURE_BEATS = 16;   // 지연 측정에서 들려주는 전체 박 수
export const MEASURE_BPM = 120;
export const SUGGEST_THRESHOLD_MS = 15; // 평균 오차가 이 값 이상이면 보정값 변경을 제안한다

export const DEFAULT_SETTINGS = Object.freeze({ latency_ms: 0, key_left: 'KeyS', key_right: 'KeyF', show_diff: true, lead_ms: 1800, volume: 80 });

// 볼륨을 0~100 정수로 맞춘다 (숫자가 아니면 기본값)
export function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.volume;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// 키로 쓸 수 없는 것 (서버 RESERVED_CODES 와 같다)
const RESERVED = new Set(['Space', 'Escape', 'Enter', 'NumpadEnter', 'Tab', 'Backspace', 'CapsLock', 'ContextMenu',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]);

// 보정값을 정수 ms 로 만들고 범위(−300~+300) 안으로 맞춘다. {value, clamped}
export function clampLatency(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return { value: 0, clamped: true };
  const r = Math.round(n);
  const c = Math.max(LATENCY_MIN, Math.min(LATENCY_MAX, r));
  return { value: c, clamped: c !== r };
}

// 누른/뗀 시각을 보정한다: 보정값을 뺀다. 누르기·떼기 모두 같은 식을 쓴다.
export function adjustTime(ms, latencyMs) {
  return ms - latencyMs;
}

// 낙하 시간(ms)을 범위 안으로 맞춘다
export function clampLead(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.lead_ms;
  return Math.max(LEAD_MIN, Math.min(LEAD_MAX, n));
}

// ----- 키 설정 -----

// 키 이벤트({code, ctrlKey, altKey, shiftKey, metaKey})를 레인 키로 쓸 수 있는지. otherCode = 반대쪽 레인의 키. {ok, reason}
export function validateKey(ev, otherCode) {
  if (!ev || typeof ev.code !== 'string' || !ev.code) return { ok: false, reason: '키 정보를 읽지 못했습니다.' };
  if (ev.ctrlKey || ev.altKey || ev.shiftKey || ev.metaKey) return { ok: false, reason: 'Ctrl/Alt/Shift 와 함께 누른 키는 지정할 수 없습니다. 키 하나만 눌러 주세요.' };
  if (RESERVED.has(ev.code)) return { ok: false, reason: '이 키는 화면 조작에 쓰여서 지정할 수 없습니다 (Space, Esc, Enter, Tab, Ctrl/Alt/Shift, F1~F12).' };
  if (ev.code === otherCode) return { ok: false, reason: '왼쪽과 오른쪽에 같은 키를 지정할 수 없습니다. 다른 키를 눌러 주세요.' };
  return { ok: true, reason: '' };
}

// 화면에 보일 키 이름 (KeyS → S, Digit1 → 1, ArrowLeft → ←)
export function keyLabel(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `숫자패드 ${code.slice(6)}`;
  const names = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Semicolon: ';', Comma: ',', Period: '.', Slash: '/', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backslash: '\\', Backquote: '`' };
  return names[code] || String(code || '');
}

// 저장된 설정(깨졌을 수도 있음)을 점검해 쓸 수 있는 설정으로 만든다. {settings, notes}
export function sanitizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  const notes = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { settings: out, notes: ['설정을 읽지 못해 기본값을 사용합니다.'] };
  if ('latency_ms' in raw) {
    const c = clampLatency(raw.latency_ms);
    out.latency_ms = c.value;
    if (c.clamped) notes.push('입력 지연 보정은 −500~+500ms 범위만 쓸 수 있어 가까운 값으로 맞췄습니다.');
  }
  for (const name of ['key_left', 'key_right']) {
    if (name in raw) {
      const v = validateKey({ code: raw[name] }, null);
      if (v.ok) out[name] = raw[name];
      else notes.push('저장된 키 설정이 올바르지 않아 기본 키를 사용합니다.');
    }
  }
  if (out.key_left === out.key_right) {
    out.key_left = DEFAULT_SETTINGS.key_left;
    out.key_right = DEFAULT_SETTINGS.key_right;
    notes.push('왼쪽·오른쪽에 같은 키가 저장돼 있어 기본 키(S/F)로 되돌렸습니다.');
  }
  if (typeof raw.show_diff === 'boolean') out.show_diff = raw.show_diff;
  if ('lead_ms' in raw) out.lead_ms = clampLead(raw.lead_ms);
  if ('volume' in raw) out.volume = clampVolume(raw.volume);
  return { settings: out, notes };
}

// 4키 고정 키: 왼쪽 → 오른쪽 레인 0~3 = S D K L (설정에서 바꾸지 않는다)
export const FOUR_KEY_CODES = ['KeyS', 'KeyD', 'KeyK', 'KeyL'];

// 화면 가로 위치(0~1)가 속한 레인: 2키는 왼쪽/오른쪽 절반, 4키는 4등분
export function laneOfRelativeX(rel, km = 2) {
  const n = km === 4 ? 4 : 2;
  return Math.max(0, Math.min(n - 1, Math.floor(rel * n)));
}

// 키 코드 → 레인 번호 (없으면 −1). km = 2 | 4
export function laneForCode(code, settings, km = 2) {
  if (km === 4) return FOUR_KEY_CODES.indexOf(code);
  if (code === settings.key_left) return 0;
  if (code === settings.key_right) return 1;
  return -1;
}

// ----- 지연 측정 -----

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const n = a.length;
  if (!n) return 0;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

// 박 시각(beatTimes)마다 가장 가까운 키 입력(presses)을 짝지어 오차(누른 시각 − 박 시각, ms)를 만든다.
// 박 사이 간격의 절반(maxGap) 안에서만 짝지으며, 하나의 입력은 한 박에만 쓴다. 못 누른 박은 null.
export function pairPresses(beatTimes, presses, maxGap = 250) {
  const used = new Set();
  return beatTimes.map((b) => {
    let best = -1;
    let bestAbs = Infinity;
    presses.forEach((p, i) => {
      if (used.has(i)) return;
      const d = Math.abs(p - b);
      if (d <= maxGap && d < bestAbs) { best = i; bestAbs = d; }
    });
    if (best < 0) return null;
    used.add(best);
    return presses[best] - b;
  });
}

// 지연 측정 계산: errors = 박마다의 오차(ms, 못 누르면 null). 처음 practice 박은 빼고, 중앙값에서 크게 벗어난 값(이상값)을 걸러 평균을 낸다.
// 반환 {ok, recommended, used, total, outliers, median}. 쓸 수 있는 입력이 6개 미만이면 ok=false.
export function estimateLatency(errors, practice = PRACTICE_BEATS) {
  const valid = errors.slice(practice).filter((e) => e !== null && e !== undefined && Number.isFinite(e));
  const total = errors.length - practice;
  if (valid.length < 6) return { ok: false, recommended: 0, used: valid.length, total, outliers: 0, median: 0 };
  const med = median(valid);
  const mad = median(valid.map((e) => Math.abs(e - med)));
  const limit = Math.max(40, 3 * 1.4826 * mad); // 중앙값에서 이 이상 벗어나면 이상값
  const inliers = valid.filter((e) => Math.abs(e - med) <= limit);
  const mean = inliers.reduce((s, e) => s + e, 0) / inliers.length;
  return { ok: true, recommended: clampLatency(mean).value, used: inliers.length, total, outliers: valid.length - inliers.length, median: Math.round(med) };
}

// ----- 결과 분석 -----

export const HIST_RANGE = 150; // 분포 막대 범위 ±150ms
export const HIST_BINS = 10;   // 칸 수 (30ms 간격)

// diffs = 판정 때 쌓은 오차(ms, 보정 적용 후, 음수 = 빠름). 평균·빠름/느림 비율·분포를 계산한다.
export function errorStats(diffs) {
  const n = diffs.length;
  const bins = new Array(HIST_BINS).fill(0);
  if (!n) return { count: 0, mean: 0, fastPct: 0, slowPct: 0, bins, binWidth: (2 * HIST_RANGE) / HIST_BINS };
  const width = (2 * HIST_RANGE) / HIST_BINS;
  let sum = 0;
  let fast = 0;
  let slow = 0;
  for (const d of diffs) {
    sum += d;
    if (d < 0) fast++;
    else if (d > 0) slow++;
    const idx = Math.min(HIST_BINS - 1, Math.max(0, Math.floor((d + HIST_RANGE) / width)));
    bins[idx]++;
  }
  return { count: n, mean: sum / n, fastPct: Math.round((100 * fast) / n), slowPct: Math.round((100 * slow) / n), bins, binWidth: width };
}

// 평균 오차가 크면 보정값 변경을 제안한다. 지금 보정값에 평균 오차를 더하면 평균이 0 에 가까워진다. 제안이 없으면 null
export function suggestLatency(stats, currentLatency) {
  if (!stats.count || Math.abs(stats.mean) < SUGGEST_THRESHOLD_MS) return null;
  const rec = clampLatency(currentLatency + stats.mean).value;
  return rec === currentLatency ? null : rec;
}

// 판정 표시 글자: 등급 + 빠름/느림 + ms (예: "GREAT 빠름 −32ms"). diff 가 없으면 등급만
export function judgeLabel(label, diff, showDiff) {
  if (!showDiff || diff === undefined || diff === null) return label;
  const r = Math.round(diff);
  if (r === 0) return `${label} 0ms`;
  return `${label} ${r < 0 ? '빠름' : '느림'} ${r < 0 ? '−' : '+'}${Math.abs(r)}ms`;
}
