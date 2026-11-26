// 노트 추가·이동·길이 조절의 "데이터 변경" 공용 모듈 (09단계).
// 오른쪽 세로 채보 편집(vertical.js)과 음원 카드 가로 타임라인(timeline.js)이 같은 함수를 호출한다. 화면 좌표 계산은 각 화면에 남기고,
// 여기서는 틱 단위 계산과 상태 변경(setNotes·select·commit)만 한다. 되돌리기 기록은 호출하는 쪽이 끌기 시작 때 찍은 snapshot(before)을 넘긴다.
import { LANE_BOTH, MIN_LONG_TICKS, burstCountForLength, burstLengthForCount, clampBurstCount, fitBurstLength, noteEnd, snapTick, tryAdd, tryMoveGroup, tryUpdate } from './edit_rules.js';
import { S, commit, emit, gridStep, maxTick, notes, select, setNotes, status } from './state.js';

// ---------- 순수 계산 (상태를 건드리지 않는다) ----------

/**
 * 이동 끌기의 새 값. ptrTick = 포인터가 가리키는 tick, grab = 잡은 지점과 노트 시작의 차이.
 * 연타노트는 시간으로만 움직이고(레인 고정), lane 이 -1(레인 밖)이면 원래 레인을 유지한다.
 */
export function movePatch(note, ptrTick, grab, laneUnderPointer, step) {
  const tick = ptrTick - grab;
  return {
    tick: Math.abs(tick - note.tick) < 1e-6 ? note.tick : Math.max(0, snapTick(tick, step)),
    lane: note.type === 'burst' ? LANE_BOTH : laneUnderPointer < 0 ? note.lane : laneUnderPointer,
  };
}

/** 롱노트·연타의 "끝" 끌기: 시작은 그대로, 길이만 (최소 길이 이상) */
export function resizeEndPatch(note, ptrTick, step) {
  const end = Math.max(note.tick + MIN_LONG_TICKS, snapTick(ptrTick, step));
  return { length_tick: end - note.tick };
}

/** 롱노트·연타의 "앞(시작)" 끌기: 끝(원래 값)은 그대로, 시작만 (최소 길이를 지키며) */
export function resizeStartPatch(orig, ptrTick, step) {
  const end = noteEnd(orig);
  const start = Math.min(end - MIN_LONG_TICKS, Math.max(0, snapTick(ptrTick, step)));
  return { tick: start, length_tick: end - start };
}

// ---------- 상태를 바꾸는 공용 동작 ----------

/** 단타를 그 자리에 추가하고 선택한다. 안 되면 이유를 알리고 false */
export function addTapAt(lane, tick, before) {
  const r = tryAdd(notes(), { type: 'tap', lane, tick }, maxTick());
  if (!r.ok) {
    status(r.reason, 'warn');
    return false;
  }
  setNotes(r.notes);
  select(r.note.id);
  commit(before);
  return true;
}

/** 끌기 상태 d 의 노트 하나(d.id)에 patch 를 적용한다. 바뀌었으면 d.changed = true */
export function applyDragPatch(d, patch) {
  const note = notes().find((n) => n.id === d.id);
  if (!note) return false;
  const r = tryUpdate(notes(), d.id, patch, maxTick());
  if (!r.ok) {
    d.reason = r.reason;
    status(r.reason, 'warn');
    return false;
  }
  if (r.note.tick !== note.tick || r.note.lane !== note.lane || r.note.length_tick !== note.length_tick) {
    setNotes(r.notes);
    d.changed = true;
    emit('live');
  }
  return true;
}

/** 여러 개를 함께 옮긴다. 시간·레인 변화량은 끌기 시작 위치가 기준이다. */
export function applyGroupMove(d, deltaTick, laneUnderPointer) {
  const deltaLane = d.grabLane < 0 || laneUnderPointer < 0 ? 0 : laneUnderPointer - d.grabLane;
  const r = tryMoveGroup(d.base, d.ids, deltaTick, maxTick(), deltaLane);
  if (!r.ok) {
    status(r.reason, 'warn');
    return false;
  }
  setNotes(r.notes);
  d.changed = d.changed || deltaTick !== 0 || deltaLane !== 0;
  emit('live');
  return true;
}

/** 끌기로 만든 롱노트를 확정한다. [2.2] 연타는 만들 수 없다(tryAdd 가 안내 문구와 함께 거부). askBurstCount 는 호출부 호환용으로 남겼다 */
export async function finishCreateNote(d, askBurstCount) {
  const step = gridStep() || 1;
  const start = Math.min(d.start, d.end);
  const end = Math.max(d.start, d.end);
  let length = end - start;
  if (length < MIN_LONG_TICKS && d.type === 'hold') length = Math.max(step, Math.round(S.holdBeats * 960)); // 클릭만 했을 때 기본 길이
  const cand = { type: d.type, lane: d.lane, tick: start, length_tick: length };
  const r = tryAdd(notes(), cand, maxTick());
  if (!r.ok) {
    status(r.reason, 'warn');
    return;
  }
  setNotes(r.notes);
  select(r.note.id);
  commit(d.before);
}

/** 새로 만들 롱노트·연타의 끌기 시작 상태 */
export function createDrag(type, laneUnderPointer, tick, before) {
  return { mode: 'create', type, lane: laneUnderPointer, start: tick, end: tick, before, changed: false };
}
