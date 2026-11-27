// 화면 전체가 공유하는 상태와 채보 데이터 보조 함수. (화면 그리기 코드는 여기에 넣지 않는다)
import { History, byTick, keyModeOf, setKeyMode } from './edit_rules.js';
import { BpmMap, RES } from './timing.js';

export const S = {
  config: null,        // 서버 설정(판정 폭, 검증 기준)
  presets: null,       // 서버 프리셋 정보
  songs: [],           // 최근 곡 목록
  song: null,          // 열려 있는 곡 ID
  songInfo: null,
  chart: null,         // 채보 전체(v2)
  diffIndex: 0,        // 편집 중인 난이도 번호
  analysis: null,      // 분석 결과(후보, 박자 정보)
  waveform: null,      // 파형 요약
  wave: null,          // 음원 파형(20ms마다 전체·저음·중음·고음 크기 0~255). 편집 화면 오른쪽 파형 띠가 쓴다
  waveBusy: false,     // 파형을 계산하는 중
  tempoFound: null,    // 변속 자동 찾기 결과(확정 전 후보): {result, checked:Set(구간 번호), sens}
  showWave: false,     // 파형 띠 켜짐 (설정 showWave, 기본은 PC 켬·폰 끔)
  shape: 'circle',     // 편집 화면 노트 모양: circle / bar (설정 editNoteShape)
  map: new BpmMap([{ tick: 0, bpm: 120, beats_per_bar: 4, beat_unit: 4 }], 0),
  tool: 'select',      // select / tap / hold (2.2: 연타 도구 삭제)
  clip: null,          // 복사 보관함 (프로그램 안에서만 유지, 곡을 바꾸면 비운다)
  paste: null,         // 붙여넣기 미리보기 모드일 때 {flip}
  selectedIds: [],     // 선택된 노트 id 목록 (드래그·Shift 로 여러 개 선택)
  dirty: false,
  gridDiv: 8,         // 격자(마디를 몇 칸으로 나눌지), 'tenth'는 0.1박, 'free'는 격자 없음
  holdBeats: 1,        // 롱노트 기본 길이(박)
  burstCount: 8,       // 연타 기본 횟수
  followPlayhead: true,
  view: { start: 0, span: 6000 },     // 세로 편집기가 보는 구간(음원 ms)
  tl: { start: 0, span: 20000 },      // 가로 타임라인이 보는 구간(음원 ms)
  issues: [],          // 서버 검증 결과 목록
  requested: { tap: 80, hold: 20, burst: 0 }, // 자동 생성 때 요청한 비율 (2.2: 연타는 항상 0)
  pendingOffset: null, // 시작점 미세 조정 버튼을 누르는 중, 아직 반영 전의 새 시작점 (메트로놈이 먼저 따라간다)
  manual: null,        // 직접 고친 BPM·offset (분석 전에 보관)
  history: new History(200),
};

// 노트가 정확히 1개 선택됐을 때만 그 id (여러 개거나 없으면 null). 기존 단일 선택 코드와 호환된다.
Object.defineProperty(S, 'selectedId', {
  get() { return S.selectedIds.length === 1 ? S.selectedIds[0] : null; },
  set(v) { S.selectedIds = v === null || v === undefined ? [] : [v]; },
});

const listeners = {};

// 간단한 이벤트: 'change'(채보 바뀜), 'select', 'view', 'status'
export function on(name, fn) {
  (listeners[name] = listeners[name] || []).push(fn);
}

export function emit(name, data) {
  for (const fn of listeners[name] || []) fn(data);
}

export function notes() {
  return S.chart ? S.chart.difficulties[S.diffIndex].notes : [];
}

export function setNotes(list) {
  S.chart.difficulties[S.diffIndex].notes = list.sort(byTick);
}

// 곡 길이(ms) / 곡 끝 tick
export function durationMs() {
  return S.chart ? S.chart.song.duration_ms || 0 : 0;
}

export function maxTick() {
  return S.chart && durationMs() ? Math.floor(S.map.audioMsToTick(durationMs())) : null;
}

// 격자 한 칸의 tick 수 (격자 없음이면 0)
export function gridStep() {
  if (S.gridDiv === 'tenth') return RES / 10;
  return S.gridDiv === 'free' ? 0 : 4 * RES / S.gridDiv;
}

// 열린 채보의 키 모드 (2 | 4). 없으면 2키
export function keyMode() {
  return keyModeOf(S.chart);
}

// 채보의 키 모드를 편집 규칙(edit_rules)에 알린다. 채보가 바뀌거나 키 모드가 바뀔 때마다 부른다.
export function syncKeyMode() {
  setKeyMode(keyModeOf(S.chart));
}

// 채보의 키 모드를 정한다. 2키는 keyMode 필드를 두지 않아 옛 채보와 똑같이 저장된다.
export function applyKeyMode(chart, mode) {
  if (mode === 4) {
    chart.keyMode = 4;
    chart.lanes = 4;
  } else {
    delete chart.keyMode;
    chart.lanes = 2;
  }
}

export function setChart(chart) {
  S.chart = chart;
  syncKeyMode();
  S.diffIndex = 0;
  S.selectedId = null;
  rebuildTiming(true);
}

// 채보의 타이밍이 바뀐 뒤 변환 객체를 다시 만든다
export function rebuildTiming(openingChart = false) {
  const t = S.chart.timing;
  S.map = new BpmMap(t.bpm_map, S.chart.song.audio_offset_ms || 0);
  const g = t.grid_map && t.grid_map[0] && t.grid_map[0].division;
  if (g && (openingChart || S.gridDiv !== 'tenth')) S.gridDiv = g;
}

// 되돌리기용 스냅샷: 노트와 타이밍을 모두 담는다
export function snapshot() {
  return JSON.stringify({
    notes: notes(), timing: S.chart.timing, offset: S.chart.song.audio_offset_ms || 0, sections: S.chart.sections || [], keyMode: keyMode(),
  });
}

export function restore(text) {
  const s = JSON.parse(text);
  const timingChanged = JSON.stringify(S.chart.timing) !== JSON.stringify(s.timing) ||
    (S.chart.song.audio_offset_ms || 0) !== s.offset;
  setNotes(s.notes);
  S.chart.timing = s.timing;
  S.chart.song.audio_offset_ms = s.offset;
  S.chart.sections = s.sections;
  applyKeyMode(S.chart, s.keyMode === 4 ? 4 : 2); // 다시 만들기를 되돌리면 키 모드도 함께 돌아온다
  syncKeyMode();
  if (timingChanged) rebuildTiming();
  S.selectedIds = S.selectedIds.filter((id) => notes().some((n) => n.id === id));
}

// 편집을 하나 끝냈을 때 호출: before 는 편집 직전 snapshot()
export function commit(before) {
  S.history.push(before);
  S.dirty = true;
  emit('change');
}

export function undo() {
  const prev = S.history.undo(snapshot());
  if (prev === null) return false;
  restore(prev);
  S.dirty = true;
  emit('change');
  return true;
}

export function redo() {
  const next = S.history.redo(snapshot());
  if (next === null) return false;
  restore(next);
  S.dirty = true;
  emit('change');
  return true;
}

export function selectedNote() {
  return notes().find((n) => n.id === S.selectedId) || null;
}

// 붙여넣기 미리보기 모드를 끝낸다 (다른 노트 선택·도구 변경·Esc 때)
export function endPaste() {
  if (!S.paste) return;
  S.paste = null;
  emit('paste');
}

export function select(id) {
  endPaste();
  S.selectedId = id;
  emit('select');
}

// 선택을 id 목록으로 바꾼다
export function setSelection(ids) {
  endPaste();
  S.selectedIds = [...ids];
  emit('select');
}

export function isSelected(id) {
  return S.selectedIds.includes(id);
}

// 노트 수(건강검진 비교용)와 상태 문구
export function status(text, kind = 'info') {
  emit('status', { text, kind });
}
