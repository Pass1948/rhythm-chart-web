// 편집 규칙 (화면 코드와 분리된 순수 모듈 — Node 로 테스트한다).
// 서버 validate 와 같은 기준: 같은 레인·같은 위치 중복 금지, 롱노트 구간 안 같은 레인에 다른 노트 금지,
// 연타노트는 양쪽 레인('both') 전체 폭 노트이며 구간 안에는 어떤 노트도(양쪽 레인 모두) 둘 수 없다,
// 롱노트 최소 길이, 연타 횟수 3~100. 모든 함수는 notes 를 바꾸지 않고 새 배열을 돌려준다.

export const BURST_MIN = 3;
export const BURST_MAX = 100;
export const MIN_LONG_TICKS = 240; // 롱노트·연타 최소 길이 = 1/4박
export const TYPE_NAMES = { tap: '단타', hold: '롱노트', burst: '연타노트' };
export const LANE_NAMES = ['왼쪽', '오른쪽'];
export const LANE_BOTH = 'both'; // 연타노트 전용 레인 값

// ---------- 키 모드 (10단계) ----------
// 2키(기본): 레인 0·1. 4키: 레인 0~3(S D K L). 현재 열린 채보의 모드를 state.js 가 setKeyMode 로 알려 준다.
export const FOUR_KEY_LABELS = ['S', 'D', 'K', 'L'];
/** 레인의 손: 왼손 = 0·1, 오른손 = 2·3 (같은 손 동시는 검사에서 경고만, 편집으로 만드는 것은 막지 않는다) */
export function handOfLane(lane) {
  return lane < 2 ? 0 : 1;
}
let activeKeyMode = 2;
export function setKeyMode(mode) {
  activeKeyMode = mode === 4 ? 4 : 2;
}
export function getKeyMode() {
  return activeKeyMode;
}
/** 채보 객체의 키 모드 (keyMode 가 없거나 4 가 아니면 2) */
export function keyModeOf(chart) {
  return chart && chart.keyMode === 4 ? 4 : 2;
}
/** 레인 이름: 2키는 왼쪽/오른쪽, 4키는 1레인(S)~4레인(L) */
export function laneText(lane, km = activeKeyMode) {
  if (lane === LANE_BOTH) return km === 4 ? '4레인 전체' : '양쪽';
  if (km === 4) return `${lane + 1}레인(${FOUR_KEY_LABELS[lane]})`;
  return lane === 0 ? '왼쪽' : '오른쪽';
}
/** 단타·롱노트에 쓸 수 있는 레인인가 */
export function isNoteLane(lane, km = activeKeyMode) {
  return Number.isInteger(lane) && lane >= 0 && lane < km;
}
/** 좌우 뒤집은 레인: 2키 i ↔ 1-i, 4키 i ↔ 3-i */
export function flipLane(lane, km = activeKeyMode) {
  return km - 1 - lane;
}

// 정렬용 레인 순서: 양쪽(연타)이 먼저, 그다음 왼쪽·오른쪽
export function laneKey(lane) {
  return lane === LANE_BOTH ? -1 : lane;
}

// 노트가 tick 구간 [start, end) 를 차지하는가 (단타는 1tick 을 차지하는 것으로 본다)
export function occupies(n, start, end) {
  return n.tick < end && n.tick + (n.length_tick || 1) > start;
}

// 연타 횟수를 3~100 으로 보정한다. 보정했으면 한국어 안내를 같이 돌려준다.
export function clampBurstCount(value) {
  let v = Math.round(Number(value));
  if (!Number.isFinite(v)) return { value: BURST_MIN, adjusted: true, message: `연타 횟수는 ${BURST_MIN}~${BURST_MAX}회입니다. ${BURST_MIN}회로 맞췄습니다.` };
  if (v < BURST_MIN) return { value: BURST_MIN, adjusted: true, message: `연타 횟수는 최소 ${BURST_MIN}회입니다. ${BURST_MIN}회로 맞췄습니다.` };
  if (v > BURST_MAX) return { value: BURST_MAX, adjusted: true, message: `연타 횟수는 최대 ${BURST_MAX}회입니다. ${BURST_MAX}회로 맞췄습니다.` };
  return { value: v, adjusted: false, message: '' };
}

// 노트가 끝나는 tick (단타는 시작과 같다)
export function noteEnd(n) {
  return n.tick + (n.length_tick || 0);
}

export function isLong(n) {
  return n.type === 'hold' || n.type === 'burst';
}

export function nextId(notes) {
  let max = 0;
  for (const n of notes) if (n.id > max) max = n.id;
  return max + 1;
}

// 격자(step tick)에 가장 가까운 tick
export function snapTick(tick, step) {
  return step > 0 ? Math.round(tick / step) * step : Math.round(tick);
}

// 필요한 연타 속도(회/초)
export function burstRate(count, lengthMs) {
  return lengthMs > 0 ? count / (lengthMs / 1000) : Infinity;
}

// 후보 노트를 둘 수 없는 이유(한국어). 둘 수 있으면 '' 를 돌려준다.
// maxTick은 곡 끝이다. 옛 롱노트도 원래 길이로 옮길 수 있다.
function placementReason(cand, maxTick, minLength = 1) {
  const km = activeKeyMode;
  if (cand.type === 'burst') {
    if (cand.lane !== LANE_BOTH) return km === 4 ? '연타노트는 레인 없이 4레인 전체를 쓰는 노트입니다.' : '연타노트는 레인 없이 양쪽 레인 전체를 쓰는 노트입니다.';
  } else if (!isNoteLane(cand.lane, km)) return km === 4 ? '레인은 1~4레인 중 하나여야 합니다.' : '레인은 왼쪽이나 오른쪽이어야 합니다.';
  if (!Number.isInteger(cand.tick) || cand.tick < 0) return '곡 시작보다 앞에는 노트를 둘 수 없습니다.';
  if (isLong(cand)) {
    if (!Number.isInteger(cand.length_tick) || cand.length_tick < minLength) {
      return minLength === MIN_LONG_TICKS ? `${TYPE_NAMES[cand.type]}의 최소 길이는 1/4박입니다.` : '노트 길이는 0보다 커야 합니다.';
    }
  }
  if (cand.type === 'burst') {
    if (!Number.isInteger(cand.count) || cand.count < BURST_MIN || cand.count > BURST_MAX) return `연타 횟수는 ${BURST_MIN}~${BURST_MAX}회여야 합니다.`;
  }
  if (maxTick !== null && noteEnd(cand) > maxTick) return '곡 길이를 넘어서는 위치에는 노트를 둘 수 없습니다.';
  return '';
}

// [2.2] 연타는 새로 만들거나 고칠 수 없다(구형 저장본의 연타는 보존만 하고 삭제 후 단타·롱노트로 다시 입력한다)
export const BURST_CLOSED_REASON = '연타노트는 더 이상 만들거나 고칠 수 없습니다. 단타나 롱노트로 입력해 주세요. 옛 연타노트는 삭제한 뒤 다시 입력해 주세요.';

// 연타노트인가
export function isBurstNote(note) {
  return note.type === 'burst';
}

// 노트 추가. 성공: {ok:true, notes, note}, 실패: {ok:false, reason}
export function tryAdd(notes, cand, maxTick = null) {
  if (cand.type === 'burst') return { ok: false, reason: BURST_CLOSED_REASON };
  const reason = placementReason(cand, maxTick, MIN_LONG_TICKS);
  if (reason) return { ok: false, reason };
  const note = { id: nextId(notes), type: cand.type, lane: cand.lane, tick: cand.tick };
  if (isLong(cand)) note.length_tick = cand.length_tick;
  if (cand.type === 'burst') note.count = cand.count;
  return { ok: true, notes: [...notes, note].sort(byTick), note };
}

// 노트 수정(이동·레인 변경·길이·횟수). patch 에 있는 항목만 바꾼다.
export function tryUpdate(notes, id, patch, maxTick = null) {
  const old = notes.find((n) => n.id === id);
  if (!old) return { ok: false, reason: '노트를 찾을 수 없습니다.' };
  const cand = { ...old, ...patch };
  if (cand.type === 'burst') return { ok: false, reason: BURST_CLOSED_REASON }; // 연타로 바꾸기·옛 연타 고치기 모두 막는다(단타·롱노트로 바꾸는 것은 허용)
  if (isLong(cand) && patch.length_tick !== undefined && cand.length_tick < MIN_LONG_TICKS) cand.length_tick = MIN_LONG_TICKS;
  const reason = placementReason(cand, maxTick);
  if (reason) return { ok: false, reason };
  return { ok: true, notes: notes.map((n) => (n.id === id ? cand : n)).sort(byTick), note: cand };
}

export function removeNote(notes, id) {
  return notes.filter((n) => n.id !== id);
}

// 레인 교체 (좌우 뒤집기: 2키 왼쪽 ↔ 오른쪽, 4키 i ↔ 3-i)
export function swapLane(notes, id, maxTick = null) {
  const old = notes.find((n) => n.id === id);
  if (!old) return { ok: false, reason: '노트를 찾을 수 없습니다.' };
  if (old.type === 'burst') return { ok: false, reason: '연타노트는 전체 레인 노트라서 레인을 바꿀 수 없습니다.' };
  return tryUpdate(notes, id, { lane: flipLane(old.lane) }, maxTick);
}

export function byTick(a, b) {
  return a.tick - b.tick || laneKey(a.lane) - laneKey(b.lane);
}

// 되돌리기/다시하기 기록. 스냅샷은 문자열(JSON)로 보관해 이후 편집의 영향을 받지 않게 한다. 최소 200단계.
export class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  // 편집 직전 상태를 기록한다
  push(snapshot) {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  // current(지금 상태)를 다시하기 쪽에 넣고 직전 상태를 돌려준다. 없으면 null
  undo(current) {
    if (!this.undoStack.length) return null;
    this.redoStack.push(current);
    return this.undoStack.pop();
  }

  redo(current) {
    if (!this.redoStack.length) return null;
    this.undoStack.push(current);
    return this.redoStack.pop();
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}

// 채보 건강검진용 통계 (순수 계산)
export function healthStats(notes, tickToMs) {
  const total = notes.length;
  const count = { tap: 0, hold: 0, burst: 0 };
  const lane = new Array(activeKeyMode).fill(0);
  for (const n of notes) {
    count[n.type]++;
    if (isNoteLane(n.lane)) lane[n.lane]++; // 연타(전체 레인)는 레인 비율에서 제외
  }
  const times = notes.map((n) => tickToMs(n.tick) / 1000).sort((a, b) => a - b);
  let max = 0;
  let j = 0;
  for (let i = 0; i < times.length; i++) {
    while (times[i] - times[j] >= 1 - 1e-6) j++; // 부동소수 오차 허용
    max = Math.max(max, i - j + 1);
  }
  const span = times.length > 1 ? Math.max(times[times.length - 1] - times[0], 1) : 1;
  const sorted = notes.filter((n) => isNoteLane(n.lane)).sort(byTick); // 같은 레인 연속도 연타 제외
  let run = 0;
  let maxRun = 0;
  let last = -1;
  for (const n of sorted) {
    run = n.lane === last ? run + 1 : 1;
    last = n.lane;
    maxRun = Math.max(maxRun, run);
  }
  return {
    total, count,
    percent: Object.fromEntries(Object.entries(count).map(([k, v]) => [k, total ? Math.round((1000 * v) / total) / 10 : 0])),
    lane, laneTotal: lane.reduce((a, b) => a + b, 0), npsAvg: total ? Math.round((10 * total) / span) / 10 : 0, npsMax: max, maxSameLaneRun: maxRun,
  };
}

// ---------- 다중 선택 ----------

// 드래그 영역과 노트가 조금이라도 겹치는가.
// area: {t0, t1 (tick 범위, t0<=t1), lanes: 영역이 걸친 레인 번호 목록, pad: 단타의 크기(동그라미)만큼 넓혀 줄 tick}
// 단타·롱노트는 영역이 걸친 레인에 있어야 하고, 연타노트는 전체 폭 노트이므로 영역의 세로 범위만 겹치면 된다. 경계가 닿아도 겹친 것으로 본다.
export function areaHitsNote(n, area) {
  if (n.type !== 'burst' && !area.lanes.includes(n.lane)) return false;
  const pad = n.type === 'tap' ? area.pad || 0 : 0;
  const start = n.tick - pad;
  const end = noteEnd(n) + pad;
  return start <= area.t1 && end >= area.t0;
}

// 영역에 걸린 노트 id 목록
export function idsInArea(notes, area) {
  return notes.filter((n) => areaHitsNote(n, area)).map((n) => n.id);
}

// Shift+클릭: 선택에 있으면 빼고 없으면 더한다
export function toggleId(ids, id) {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

// Shift+드래그: 기존 선택에 추가 (중복 없이)
export function unionIds(ids, more) {
  return [...ids, ...more.filter((x) => !ids.includes(x))];
}

// 선택한 노트를 모두 지운다 (새 배열). 한 번의 편집이므로 호출하는 쪽이 commit 한 번만 하면 Undo 한 번으로 복원된다.
export function removeNotes(notes, ids) {
  const set = new Set(ids);
  return notes.filter((n) => !set.has(n.id));
}

// 선택한 노트를 시간과 레인 방향으로 같은 거리만큼 옮긴다.
export function tryMoveGroup(notes, ids, deltaTick, maxTick = null, deltaLane = 0) {
  const set = new Set(ids);
  const moving = notes.filter((n) => set.has(n.id)).map((n) => ({ ...n, tick: n.tick + deltaTick, lane: isBurstNote(n) ? n.lane : n.lane + deltaLane }));
  if (moving.some(isBurstNote)) return { ok: false, reason: `${BURST_CLOSED_REASON} 선택한 노트를 모두 옮기지 않았습니다.` };
  for (const m of moving) {
    const reason = placementReason(m, maxTick);
    if (reason) return { ok: false, reason: `${reason} 선택한 노트를 모두 옮기지 않았습니다.` };
  }
  return { ok: true, notes: [...notes.filter((n) => !set.has(n.id)), ...moving].sort(byTick) };
}

// ---------- 연타 길이 = 횟수 ÷ 박당 칸 수 ----------

// 박당 칸 수 (16분 격자 = 4, 8분 = 2, 격자 없음은 4 로 본다)
export function beatSlots(gridDiv) {
  return gridDiv === 'free' || !gridDiv ? 4 : gridDiv / 4;
}

// 횟수에 맞는 연타 길이(tick): 횟수 ÷ 박당 칸 수 (박). 예: 16분 격자에서 8회 → 2박, 8분 격자에서 8회 → 4박
export function burstLengthForCount(count, gridDiv) {
  return Math.round((count / beatSlots(gridDiv)) * 960);
}

// 끈 길이에 맞는 횟수 기본값: 길이(박) × 박당 칸 수 를 3~100 으로 보정
export function burstCountForLength(lengthTick, gridDiv) {
  return clampBurstCount((lengthTick / 960) * beatSlots(gridDiv)).value;
}

// 연타 길이를 곡 끝·다른 노트 앞에서 가능한 최대로 줄인다.
// 반환: {length, shortened} 또는 둘 수 없을 때 {length: 0, reason}
export function fitBurstLength(notes, tick, wantLen, maxTick = null, ignoreId = null, step = 0) {
  let limit = wantLen;
  for (const o of notes) {
    if (o.id === ignoreId) continue;
    if (occupies(o, tick, tick + 1)) return { length: 0, reason: '그 자리에는 이미 노트가 있어 연타노트를 만들 수 없습니다.' };
    if (o.tick > tick && o.tick < tick + limit) limit = o.tick - tick;
  }
  if (maxTick !== null && tick + limit > maxTick) limit = maxTick - tick;
  if (step > 0) limit = Math.floor(limit / step) * step;
  if (limit < MIN_LONG_TICKS) return { length: 0, reason: '여기에는 연타노트를 만들 자리가 부족합니다. 다른 노트나 곡 끝과 너무 가깝습니다.' };
  return { length: limit, shortened: limit < wantLen };
}

// ---------- 복사·붙여넣기 ----------

// 선택한 노트를 보관함 내용으로 만든다. 기준점은 선택한 노트 중 가장 이른 시작 위치이고, 각 노트는 기준점에서의 상대 위치(rel)로 기억한다.
// 종류·레인(연타는 양쪽)·길이·연타 횟수를 그대로 담는다. 선택이 없으면 null.
export function makeClip(notes, ids) {
  const set = new Set(ids);
  const picked = notes.filter((n) => set.has(n.id) && !isBurstNote(n)).sort(byTick); // [2.2] 연타는 복사하지 않는다
  if (!picked.length) return null;
  const base = picked[0].tick;
  const items = picked.map((n) => {
    const it = { type: n.type, lane: n.lane, rel: n.tick - base };
    if (n.length_tick !== undefined) it.length_tick = n.length_tick;
    if (n.count !== undefined) it.count = n.count;
    return it;
  });
  return { items, span: Math.max(...items.map((it) => it.rel + (it.length_tick || 0))) };
}

// 좌우 반전: 단타·롱노트의 레인을 뒤집는다 (2키 0↔1, 4키 i↔3-i. 연타는 전체 레인이라 그대로). 새 보관함 내용을 돌려준다.
export function flipClip(clip) {
  return { ...clip, items: clip.items.map((it) => (isNoteLane(it.lane) ? { ...it, lane: flipLane(it.lane) } : { ...it })) };
}

// 붙여넣기: 기준점을 anchorTick 에 두고 보관함의 노트를 모두 놓는다. **전체 성공 또는 전체 취소**.
// 성공: {ok:true, notes, ids(새로 붙은 노트 id 목록)}, 실패: {ok:false, reason}
export function tryPaste(notes, clip, anchorTick, maxTick = null, flip = false) {
  if (!clip || !clip.items.length) return { ok: false, reason: '복사한 노트가 없습니다. 먼저 노트를 선택해 Ctrl+C 로 복사해 주세요.' };
  const items = (flip ? flipClip(clip) : clip).items;
  let base = [...notes];
  const ids = [];
  for (const it of items) {
    if (it.type === 'burst') return { ok: false, reason: BURST_CLOSED_REASON }; // 옛 보관함에 연타가 있어도 붙여넣지 않는다
    const cand = { type: it.type, lane: it.lane, tick: anchorTick + it.rel };
    if (it.length_tick !== undefined) cand.length_tick = it.length_tick;
    if (it.count !== undefined) cand.count = it.count;
    const reason = placementReason(cand, maxTick);
    if (reason) return { ok: false, reason };
    const note = { id: nextId(base), ...cand };
    base = [...base, note];
    ids.push(note.id);
  }
  return { ok: true, notes: base.sort(byTick), ids };
}
