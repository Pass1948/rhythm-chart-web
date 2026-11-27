// 화면의 동작 흐름: 곡 올리기 → 분석 → 노트 자동 생성 → 수정 → 저장 → 내보내기. 로컬 API(브라우저 안 기능)와 상태 변경을 묶어 둔다.
import { api } from '../../app/localApi.js';
import { makeClip, tryPaste, BURST_CLOSED_REASON, TYPE_NAMES, laneText, swapLane, tryMoveGroup, tryMoveGroupByMs, tryUpdate, removeNote, removeNotes } from './edit_rules.js';
import { thumbRules } from '../../generate/rules.ts';
import {
  S, applyKeyMode, commit, durationMs, emit, endPaste, gridStep, maxTick, notes, rebuildTiming, redo, select, selectedNote, setChart, setNotes, setSelection, snapshot, status, syncKeyMode, undo,
} from './state.js';

import { ANALYZE_MIN_MS, GENERATE_MIN_MS, ProgressTracker } from './progress_view.js';
import { makeDemoFile } from '../../storage/demoSong.ts';
import { confirmAndSave } from './export_ui.js';
import { optionsFor } from './gen_options.js';

// 버튼 옆 진행 표시 상태 (계산은 progress_view.js, 그리기는 panels.js)
export const TRACK = { analyze: new ProgressTracker({ minMs: ANALYZE_MIN_MS }), generate: new ProgressTracker({ minMs: GENERATE_MIN_MS }) };
const now = () => performance.now();

export const A = { audio: null, vertical: null, timeline: null, polling: false };

let validateTimer = 0;
let repickTimer = 0;

// ---------- 곡 목록 / 열기 ----------

export async function refreshSongs() {
  S.songs = (await api.songs()).songs;
  emit('songs');
}

export const BIG_FILE_BYTES = 100 * 1024 * 1024; // 이보다 크면 경고

export async function importFile(file) {
  if (!/\.(mp3|wav|m4a|ogg|flac)$/i.test(file.name)) {
    status('mp3, wav, m4a, ogg, flac 파일만 올릴 수 있습니다.', 'warn');
    return;
  }
  if (S.dirty && !confirm('저장하지 않은 변경이 있습니다. 그래도 새 곡을 열까요?')) return;
  if (file.size > BIG_FILE_BYTES && !confirm(`파일이 ${Math.round(file.size / 1024 / 1024)}MB 로 큽니다. 처리가 오래 걸리거나 브라우저가 느려질 수 있습니다. 그래도 올릴까요?`)) return;
  try {
    status(`'${file.name}' 파일을 확인하는 중입니다…`);
    const dup = await api.findDuplicate(file);
    if (dup) {
      // 같은 파일(내용이 같음)을 다시 올린 경우: 새로 만들지 않고 열지 묻는다
      if (confirm('이미 있는 곡입니다. 열까요?')) {
        await refreshSongs();
        await openSong(dup.id, true);
      } else {
        status('곡을 열지 않았습니다.');
      }
      return;
    }
    status(`'${file.name}' 파일을 가져오는 중입니다…`);
    const info = await api.importFile(file);
    await refreshSongs();
    await openSong(info.id, true);
  } catch (e) {
    status(e.message, 'error');
  }
}

// [체험용 데모 곡으로 시작]: 코드로 합성한 30초 드럼 비트를 곡으로 올린다 (음원 파일이 필요 없다)
export async function startDemo() {
  try {
    await importFile(makeDemoFile());
  } catch (e) {
    status(e.message, 'error');
  }
}

export async function openSong(id, skipDirtyCheck = false) {
  if (!skipDirtyCheck && S.dirty && !confirm('저장하지 않은 변경이 있습니다. 그래도 다른 곡을 열까요?')) return;
  try {
    status('곡을 여는 중입니다…');
    A.audio.stop();
    const res = await api.getChart(id);
    setChart(res.chart);
    S.history.clear();
    S.dirty = false;
    S.song = id;
    S.clip = null; // 곡을 바꾸면 복사 보관함을 비운다
    S.paste = null;
    S.manual = null;
    S.analysis = await api.analysis(id).catch(() => null);
    S.waveform = await api.waveform(id).catch(() => null);
    S.wave = await api.wave(id).catch(() => null);
    const dur = await A.audio.load(api.audioUrl(id), (p) => status(`음원을 불러오는 중입니다… ${Math.round(p * 100)}%`));
    if (!S.chart.song.duration_ms) S.chart.song.duration_ms = Math.round(dur);
    S.songInfo = S.songs.find((s) => s.id === id) || { id, title: S.chart.song.title };
    S.view.start = 0;
    S.tl.start = 0;
    emit('song');
    emit('timing');
    emit('analysis');
    emit('change');
    loadWaveSoon(id);
    await validateNow();
    const conv = res.converted_from === 2 ? ' ' + res.conversion_notes.join(' ') : '';
    status((S.analysis ? '곡을 열었습니다. 노트 자동 생성을 누르거나 세로 편집기에서 직접 만들어 보세요.' : '곡을 열었습니다. 다음으로 [분석]을 눌러 보세요.') + conv, conv ? 'warn' : 'ok');
  } catch (e) {
    status(e.message, 'error');
  }
}

// ---------- 음원 파형 ----------

// 이미 저장된 곡에 파형이 없으면 열 때 한 번 계산해서 채운다 (편집을 막지 않는다)
export async function loadWaveSoon(id) {
  if (S.wave) return;
  S.waveBusy = true;
  try {
    const w = await api.ensureWave(id, (f) => { if (S.song === id) S.waveProgress = f; });
    if (S.song === id && w) S.wave = w;
  } catch (e) {
    /* 계산하지 못해도 편집은 계속한다 */
  } finally {
    if (S.song === id) S.waveBusy = false;
  }
}

// ---------- 분석기 ----------
// 웹 버전에서는 분석기를 켜고 끌 일이 없다(분석은 이 브라우저 안의 Web Worker 가 한다). 항상 준비된 상태로 둔다.

export async function refreshAnalyzer() {
  S.analyzer = await api.analyzer();
  emit('analyzer');
  return S.analyzer;
}

// ---------- 분석 ----------

function analyzeBody() {
  const body = {
    song: S.song, detector: document.getElementById('detector').value,
    sensitivity: Number(document.getElementById('sensitivity').value),
  };
  if (S.manual) body.manual = S.manual;
  return body;
}

export async function runAnalyze() {
  if (!S.song) {
    status('먼저 곡을 열어 주세요.', 'warn');
    return;
  }
  if (TRACK.analyze.isRunning()) return;
  A.cancelRequested = false;
  TRACK.analyze.begin(now(), 'request'); // 누른 순간부터 표시를 시작한다
  emit('progress', {});
  try {
    TRACK.analyze.update({ phase: 'request', text: '분석을 시작하는 중…' });
    const r = await api.analyze(analyzeBody());
    if (A.cancelRequested) {
      await api.cancel(S.song).catch(() => {});
      return;
    }
    if (r.finished) {
      await finishAnalysis();
      TRACK.analyze.finish(now(), 'cached');
      return;
    }
    A.polling = true;
    while (A.polling) {
      await new Promise((ok) => setTimeout(ok, 400));
      if (!A.polling) break;
      const st = await api.status(S.song);
      if (st.state === 'running') {
        TRACK.analyze.update({ phase: 'progress', percent: st.progress, text: st.text });
        emit('progress', {});
        continue;
      }
      A.polling = false;
      if (st.state === 'done') {
        await finishAnalysis();
        TRACK.analyze.finish(now(), 'done');
      } else if (st.state === 'canceled') {
        TRACK.analyze.finish(now(), 'canceled', '분석을 취소했습니다');
        status('분석을 취소했습니다.', 'warn');
      } else {
        TRACK.analyze.finish(now(), 'error', '분석하지 못했습니다');
        status(st.error || '분석하지 못했습니다.', 'error');
      }
    }
  } catch (e) {
    A.polling = false;
    TRACK.analyze.finish(now(), 'error', '분석하지 못했습니다');
    status(e.message, 'error');
  }
  emit('progress', {});
}

export async function cancelAnalyze() {
  A.cancelRequested = true;
  A.polling = false;
  TRACK.analyze.finish(now(), 'canceled', '분석을 취소했습니다'); // 취소는 즉시 표시를 바꾼다
  emit('progress', {});
  try {
    await api.cancel(S.song);
  } catch (e) {
    /* 이미 끝났을 수 있음 */
  }
  status('분석을 취소했습니다.', 'warn');
}

async function finishAnalysis() {
  S.analysis = await api.analysis(S.song);
  S.waveform = await api.waveform(S.song).catch(() => S.waveform);
  S.wave = (await api.wave(S.song).catch(() => null)) || S.wave;
  const t = S.analysis.timing;
  if (notes().length === 0 && !S.manual) {
    // 사용자가 만든 변속 구간(BPM 구간이 여러 개)은 분석을 다시 해도 지우지 않는다. 덮어쓰려면 확인을 받는다.
    if (!S.map.isMulti || confirm(`변속 구간 ${S.map.rows.length - 1}곳이 있습니다. 분석한 BPM(${t.bpm}) 하나로 덮어쓸까요?\n[취소]를 누르면 변속 구간을 그대로 둡니다.`)) setTimingDirect(t.bpm, t.audio_offset_ms);
  }
  emit('analysis');
  emit('timing');
  const warn = S.analysis.warnings.length ? ' · 주의: ' + S.analysis.warnings.join(' ') : '';
  status(`분석 완료. 소리가 시작되는 지점 ${S.analysis.candidate_count}곳을 찾았습니다. 다음으로 노트 자동 생성을 눌러 보세요.${gridFitText(S.analysis)}${warn}`, S.analysis.warnings.length ? 'warn' : 'ok');
}

// 분석 결과의 박자 맞춤 안내 문장: 다시 보정했는지 + 소리 시작 지점 중 박자 칸에 맞는 비율
export function gridFitText(a) {
  const parts = [];
  const t = a.timing;
  if (t && t.source === 'auto' && t.auto && t.auto.before) {
    const b = t.auto.before;
    if (Math.abs(b.bpm - t.bpm) > 0.005 || Math.abs(b.audio_offset_ms - t.audio_offset_ms) > 1) {
      parts.push(`박자를 소리에 맞게 다시 보정했습니다 (BPM ${b.bpm} → ${t.bpm}, 시작점 ${b.audio_offset_ms}ms → ${t.audio_offset_ms}ms)`);
    }
  }
  if (a.grid_fit && a.grid_fit.total) parts.push(`박자 맞춤: 소리 시작 지점 ${a.grid_fit.total}곳 중 ${a.grid_fit.fit}곳이 박자 칸에 맞습니다 (${a.grid_fit.percent}%)`);
  return parts.length ? ' · ' + parts.join(' · ') : '';
}

// 민감도·분석 방식을 바꾸면 소리 시작 지점을 다시 찾는다 (같은 설정의 결과가 저장돼 있으면 바로 끝나고, 아니면 분석을 새로 한다)
export function repickSoon() {
  clearTimeout(repickTimer);
  repickTimer = setTimeout(async () => {
    if (!S.song || !S.analysis) return;
    try {
      const r = await api.analyze(analyzeBody());
      if (r.finished) {
        S.analysis = await api.analysis(S.song);
        emit('analysis');
        status(`소리 시작 지점을 다시 골랐습니다 (${S.analysis.candidate_count}개). 노트는 [노트 자동 생성]을 눌러야 바뀝니다.`);
      } else {
        await runAnalyze();
      }
    } catch (e) {
      status(e.message, 'error');
    }
  }, 220);
}

// ---------- BPM / 시작점 ----------

function setTimingDirect(bpm, offsetMs) {
  const row = S.chart.timing.bpm_map[0];
  S.chart.timing.bpm_map = [{ tick: 0, bpm: Number(bpm), beats_per_bar: row.beats_per_bar || 4, beat_unit: row.beat_unit || 4 }];
  S.chart.song.audio_offset_ms = Math.round(offsetMs * 100) / 100;
  rebuildTiming();
  S.dirty = true;
}

// BPM·시작점을 바꾼다. 노트가 있으면 02·02b 재계산 규칙으로 옮기고 결과 메시지를 보여 준다.
export async function applyTiming(bpm, offsetMs) {
  if (!S.chart) return;
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 300) {
    status('BPM은 40~300 사이로 입력해 주세요.', 'warn');
    emit('timing');
    return;
  }
  if (!Number.isFinite(offsetMs)) offsetMs = S.chart.song.audio_offset_ms || 0;
  const before = snapshot();
  // 구간이 여러 개면 첫 구간의 BPM 만 바꾸고 나머지 구간은 그대로 둔다 (구간별 BPM 은 [변속 구간] 카드에서 바꾼다)
  const entries = S.chart.timing.bpm_map.map((r, i) => ({ tick: r.tick, bpm: i === 0 ? bpm : r.bpm, beats_per_bar: r.beats_per_bar || 4, beat_unit: r.beat_unit || 4 }));
  let messages = [];
  try {
    if (notes().length === 0 && !S.map.isMulti) {
      setTimingDirect(bpm, offsetMs);
    } else {
      const res = await api.retime({ chart: S.chart, bpm_map: entries, audio_offset_ms: offsetMs, mode: S.retimeMode || 'time' });
      S.chart = res.chart;
      syncKeyMode();
      rebuildTiming();
      messages = res.messages;
    }
  } catch (e) {
    status(e.message, 'error');
    emit('timing');
    return;
  }
  commit(before);
  S.manual = { bpm, audio_offset_ms: S.chart.song.audio_offset_ms };
  if (S.analysis && S.song) {
    api.analyze(analyzeBody()).then(async (r) => {
      if (r.finished) S.analysis = await api.analysis(S.song);
      emit('analysis');
    }).catch(() => {});
  }
  emit('timing');
  validateSoon();
  status(`BPM ${bpm}, 시작점 ${S.chart.song.audio_offset_ms}ms 로 바꿨습니다.` + (messages.length ? ' ' + messages.slice(0, 3).join(' ') : ''), messages.some((m) => m.includes('오류')) ? 'warn' : 'info');
}

// ---------- 노트 자동 생성 ----------

export async function generate() {
  if (!S.song) return status('먼저 곡을 열어 주세요.', 'warn');
  if (!S.analysis) return status('먼저 분석을 해 주세요. [분석] 버튼을 누르면 박자와 소리가 시작되는 지점을 찾습니다.', 'warn');
  if (notes().length && !confirm('기존 노트를 교체합니다. 계속할까요?\n(되돌리기 Ctrl+Z 로 복구할 수 있습니다)')) return;
  const diff = document.getElementById('difficulty').value;
  const settings = optionsFor(diff);
  const rules = {...thumbRules(diff), ...settings.rules};
  const read = id => document.getElementById(id).value;
  const body = {
    song: S.song, difficulty: diff, grid_tolerance: read('gridTolerance'),
    density_scale: Number(read('density')) / 55,
    rule_overrides: settings.rules, four_key_simultaneous: Number(read('fkSim')),
    hold_percent: rules.hold * [0, 0.4, 0.75, 1][Number(read('holdAmount'))],
    bpm_map: S.chart.timing.bpm_map, audio_offset_ms: S.chart.song.audio_offset_ms || 0
  };
  if (read('rangeStart')) body.range_start_ms = Number(read('rangeStart')) * 1000;
  if (read('rangeEnd')) body.range_end_ms = Number(read('rangeEnd')) * 1000;
  if (typeof S.gridDiv === 'number') body.grid_division = S.gridDiv;
  if (TRACK.generate.isRunning()) return;
  TRACK.generate.begin(now(), 'plain', '만드는 중…');
  emit('progress', {});
  try {
    status('노트를 만드는 중입니다…');
    const res = await api.generate(body);
    const before = snapshot();
    S.chart.difficulties = [res.difficulty];
    S.diffIndex = 0;
    S.chart.timing = res.chart.timing;
    S.chart.song.audio_offset_ms = res.chart.song.audio_offset_ms;
    S.chart.sections = [];
    S.chart.meta = res.chart.meta;
    applyKeyMode(S.chart, res.chart.keyMode === 4 ? 4 : 2); // 새로 만든 채보의 키 모드(2/4)와 레인 수
    syncKeyMode();
    S.selectedId = null;
    rebuildTiming();
    S.gen = res;
    commit(before);
    emit('timing');
    const st = res.stats;
    const v = res.validation;
    const msg = `노트 ${st.total}개를 만들었습니다 (${st.design_mode === 'reference' ? '레퍼런스 규칙 · ' : st.design_mode === 'unified' ? '통합 규칙 · ' : ''}단타 ${st.tap_percent}% / 롱노트 ${st.hold_percent}%) · 오류 ${v.error_count}개, 경고 ${v.warning_count}개`;
    status(msg + (res.messages.length ? ' · ' + res.messages.join(' ') : ''), v.error_count ? 'error' : res.messages.length || v.warning_count ? 'warn' : 'ok');
    if (A.audio) A.vertical.ensureVisible(0);
    TRACK.generate.finish(now(), 'done', '완료 ✓');
  } catch (e) {
    TRACK.generate.finish(now(), 'error', '만들지 못했습니다');
    status(e.message, 'error');
  }
}

export function clearNotes() {
  if (!S.chart || !notes().length) return status('지울 노트가 없습니다.');
  if (!confirm('노트를 모두 지울까요? (되돌리기 Ctrl+Z 로 복구할 수 있습니다)')) return;
  const before = snapshot();
  setNotes([]);
  S.selectedId = null;
  commit(before);
  status('노트를 모두 지웠습니다.');
}

// ---------- 저장 / 불러오기 / 내보내기 ----------

export async function save() {
  if (!S.song || !S.chart) return status('저장할 곡이 없습니다. 먼저 곡을 올려 주세요.', 'warn');
  try {
    const res = await api.putChart(S.song, S.chart);
    S.dirty = false;
    emit('change');
    await refreshSongs();
    const errs = res.issues.filter((i) => i.level === 'error').length;
    status('저장했습니다. (이 기기의 브라우저 안에 저장했고, 이전 버전은 곡마다 최근 20개까지 보관합니다)' + (errs ? ` 단, 오류 ${errs}개가 있어 Unity용 내보내기는 막힙니다.` : ''), errs ? 'warn' : 'ok');
  } catch (e) {
    status(e.message, 'error');
  }
}

// [2.1] 곡 제목·아티스트를 저장하고 화면에 반영한다. 노트 편집(S.dirty)은 건드리지 않는다: 저장소에는 제목·아티스트만 먼저 쓰고,
// 메모리의 채보(S.chart)에도 같은 값을 넣어 두므로 나중에 [저장]하면 노트 변경과 함께 남는다. 실패하면 입력 칸을 원래 값으로 되돌린다.
export async function saveSongInfo(title, artist) {
  if (!S.song || !S.chart) return;
  try {
    const res = await api.saveSongInfo(S.song, { title, artist });
    S.chart.song.title = res.title;
    S.chart.song.artist = res.artist;
    S.songInfo = { ...(S.songInfo || {}), id: S.song, title: res.title };
    await refreshSongs();
    emit('change');
    status('곡 제목·아티스트를 저장했습니다.', 'ok');
  } catch (e) {
    status(e.message, 'error');
    emit('song'); // 입력 칸을 저장된 값으로 되돌린다
  }
}

// 불러오기: 채보 JSON 또는 [채보 JSON + 음원] ZIP
export async function loadJson(file) {
  try {
    const bundle = await api.readBundle(file); // ZIP 이 아니면 null
    if (bundle) return await loadBundle(bundle);
    if (!S.chart) return status('먼저 곡을 열어 주세요. JSON 은 열린 곡에 불러옵니다.', 'warn');
    await applyChartObject(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
  } catch (e) {
    status(e instanceof SyntaxError ? 'JSON 형식이 올바르지 않습니다.' : e.message, 'error');
  }
}

// ZIP 안에서 꺼낸 내용 처리: 음원 + 채보 = 새 곡으로 한 번에 복원, 채보만 = 열린 곡에 불러오기, 음원만 = 안내
async function loadBundle(bundle) {
  if (!bundle.chartText) {
    status('채보가 없는 음원입니다. 맨 위 곡 등록 줄이나 [곡 올리기]로 올려 주세요.', 'warn');
    return;
  }
  const obj = JSON.parse(bundle.chartText);
  if (!bundle.audio) {
    if (!S.chart) return status('이 ZIP 에는 음원이 없습니다. 먼저 곡을 열어 주세요. JSON 은 열린 곡에 불러옵니다.', 'warn');
    await applyChartObject(obj);
    return;
  }
  if (S.dirty && !confirm('저장하지 않은 변경이 있습니다. 그래도 새 곡을 열까요?')) return;
  const audio = new File([bundle.audio.blob], bundle.audio.name, { type: bundle.audio.blob.type });
  status(`'${audio.name}' 음원과 채보를 복원하는 중입니다…`);
  const dup = await api.findDuplicate(audio);
  let restored = false;
  if (dup) {
    if (!confirm('이미 있는 곡입니다. 열까요?')) return status('곡을 열지 않았습니다.');
    await refreshSongs();
    await openSong(dup.id, true);
  } else {
    const info = await api.importFile(audio);
    await refreshSongs();
    await openSong(info.id, true);
    restored = true;
  }
  await applyChartObject(obj);
  if (restored && S.dirty) await save(); // 새 곡으로 복원했으면 바로 저장해 둔다
}

// 읽은 채보 객체를 열린 곡에 적용한다 (노트가 있으면 교체 여부를 묻는다)
async function applyChartObject(obj) {
  const res = await api.loadChart(obj);
  if (notes().length && !confirm('현재 채보를 불러온 JSON 으로 교체할까요?')) return;
  const before = snapshot();
  const cur = S.chart.song;
  const chart = res.chart;
  chart.song.audio_file = cur.audio_file;
  chart.song.audio_sha256 = cur.audio_sha256;
  if (!chart.song.duration_ms) chart.song.duration_ms = cur.duration_ms;
  S.chart = chart;
  syncKeyMode(); // 불러온 채보의 keyMode(2/4)를 편집 규칙에 알린다
  S.diffIndex = 0;
  rebuildTiming();
  setSelection([]);
  commit(before);
  emit('timing');
  emit('song');
  const extra = res.converted_from ? ' (이전 형식을 자동 변환했습니다. ' + res.conversion_notes.slice(0, 2).join(' ') + ')' : '';
  status(`채보를 불러왔습니다. 오류 ${res.issues.filter((i) => i.level === 'error').length}개, 경고 ${res.issues.filter((i) => i.level !== 'error').length}개${extra}`, 'ok');
}

// 내보내기: 무엇을(채보 JSON / 음원 / 둘 다) → 파일 만들기 → 저장 확인 창(파일 이름 바꾸기) → 저장
export async function exportChart(what, kind, split) {
  if (!S.song || !S.chart) return status('내보낼 곡이 없습니다.', 'warn');
  try {
    status('내보낼 파일을 만드는 중입니다…');
    const { files } = await api.prepareExport({ song: S.song, chart: S.chart, what, kind, split });
    for (const f of files) {
      const outcome = await confirmAndSave(f, api);
      if (outcome) status(outcome.message, outcome.status === 'saved' ? 'ok' : outcome.status === 'declined' ? 'info' : 'error');
      else status('저장을 취소했습니다.');
    }
  } catch (e) {
    status(e.message, 'error');
  }
}

// ---------- 검증 ----------

export function validateSoon() {
  clearTimeout(validateTimer);
  validateTimer = setTimeout(validateNow, 500);
}

export async function validateNow() {
  if (!S.chart) return;
  try {
    const res = await api.validate(S.chart);
    const name = S.chart.difficulties[S.diffIndex].name;
    S.issues = res.issues.filter((i) => !i.difficulty || i.difficulty === name);
    emit('health');
  } catch (e) {
    /* 검증 실패는 편집을 막지 않는다 */
  }
}

// ---------- 선택한 노트 편집 ----------

export function nudgeSelected(delta, unit) {
  if (!S.chart || !S.selectedIds.length) return;
  const list = notes();
  const r = unit === 'ms'
    ? tryMoveGroupByMs(list, S.selectedIds, delta, S.map, maxTick())
    : tryMoveGroup(list, S.selectedIds, delta * (gridStep() || 1), maxTick());
  if (!r.ok) return status(r.reason, 'warn');
  const before = snapshot();
  setNotes(r.notes);
  commit(before);
}

// 현재 난이도의 모든 노트를 선택한다 (Ctrl+A)
export function selectAll() {
  if (!S.chart) return;
  setSelection(notes().map((n) => n.id));
  status(notes().length ? `노트 ${notes().length}개를 모두 선택했습니다.` : '선택할 노트가 없습니다.');
}

// ---------- 복사·잘라내기·붙여넣기 ----------

// 선택한 노트를 프로그램 안의 보관함에 복사한다 (Ctrl+C). 난이도를 바꿔도 같은 곡 안에서는 유지된다.
export function copySelected() {
  const clip = makeClip(notes(), S.selectedIds);
  if (!clip) return status('복사할 노트를 먼저 선택해 주세요.', 'warn');
  S.clip = clip;
  emit('paste');
  status(`노트 ${clip.items.length}개를 복사했습니다. Ctrl+V 로 붙여넣을 위치를 고르세요.`, 'ok');
}

// 잘라내기 (Ctrl+X): 복사 + 삭제를 한 번의 편집으로 기록한다
export function cutSelected() {
  const clip = makeClip(notes(), S.selectedIds);
  if (!clip) return status('잘라낼 노트를 먼저 선택해 주세요.', 'warn');
  const before = snapshot();
  S.clip = clip;
  setNotes(removeNotes(notes(), S.selectedIds));
  S.selectedIds = [];
  commit(before);
  emit('paste');
  status(`노트 ${clip.items.length}개를 잘라냈습니다. Ctrl+V 로 붙여넣을 위치를 고르세요. (Ctrl+Z 로 되돌릴 수 있습니다)`, 'ok');
}

// 붙여넣기 미리보기 모드 시작 (Ctrl+V, flip=true 면 좌우 반전 Ctrl+Shift+V)
export function startPaste(flip = false) {
  if (!S.chart) return;
  if (!S.clip) return status('복사한 노트가 없습니다. 노트를 여러 개 끌어서 선택한 뒤 Ctrl+C 로 복사하세요.', 'warn');
  S.selectedIds = [];
  S.paste = { flip, keyboardLane: null };
  emit('select');
  emit('paste');
  status('마우스로 레인과 시간을 고르세요. ←/→로 한 레인씩 옮길 수 있습니다. 클릭하거나 손을 떼면 붙이고, Esc로 취소합니다.');
}

export function cancelPaste() {
  if (!S.paste) return false;
  endPaste();
  status('붙여넣기를 취소했습니다.');
  return true;
}

export function togglePasteFlip() {
  if (!S.paste) return;
  S.paste = { ...S.paste, flip: !S.paste.flip };
  emit('paste');
}

// 클릭한 위치(anchorTick)에 붙여넣기를 확정한다. 전체 성공 또는 전체 취소. 붙은 노트가 선택되고 Undo 한 번으로 전부 되돌려진다.
export function confirmPaste(anchorTick, targetLane) {
  if (!S.paste || !S.clip) return false;
  const r = tryPaste(notes(), S.clip, anchorTick, maxTick(), S.paste.flip, targetLane);
  if (!r.ok) {
    status(r.reason, 'warn');
    return false;
  }
  const before = snapshot();
  setNotes(r.notes);
  S.paste = null;
  S.selectedIds = r.ids;
  commit(before);
  emit('paste');
  emit('select');
  status(`노트 ${r.ids.length}개를 붙여넣었습니다. 붙인 노트가 선택되어 있어 바로 옮기거나 지울 수 있고, Ctrl+Z 한 번에 모두 되돌립니다.`, 'ok');
  return true;
}

// 선택을 모두 해제한다 (Esc)
export function clearSelection() {
  if (S.selectedIds.length) setSelection([]);
}

export function deleteSelected() {
  if (S.selectedIds.length > 1) {
    // 여러 개 선택: 한 번의 편집으로 모두 지운다 (Undo 한 번에 모두 복원)
    const before = snapshot();
    setNotes(removeNotes(notes(), S.selectedIds));
    S.selectedIds = [];
    commit(before);
    status('선택한 노트를 모두 지웠습니다. Ctrl+Z 로 되돌릴 수 있습니다.');
    return;
  }
  const n = selectedNote();
  if (!n) return;
  const before = snapshot();
  setNotes(removeNote(notes(), n.id));
  S.selectedId = null;
  commit(before);
  status('노트를 삭제했습니다.');
}

export function swapSelectedLane() {
  const n = selectedNote();
  if (!n) return;
  const before = snapshot();
  const r = swapLane(notes(), n.id, maxTick());
  if (!r.ok) return status(r.reason, 'warn');
  setNotes(r.notes);
  commit(before);
}

// 길이(박)를 숫자로 바꾼다 ([2.2] 연타 횟수 편집은 닫혔다)
export function updateSelected(patch) {
  const n = selectedNote();
  if (!n) return;
  const before = snapshot();
  const r = tryUpdate(notes(), n.id, patch, maxTick());
  if (!r.ok) {
    status(r.reason, 'warn');
    emit('select');
    return;
  }
  setNotes(r.notes);
  commit(before);
}

// 노트 종류 바꾸기 (단타 ↔ 롱노트). [2.2] 연타로 바꾸는 길은 닫혔고, 옛 연타를 단타·롱노트로 바꾸는 것은 허용한다.
export function convertSelected(type) {
  const n = selectedNote();
  if (!n || n.type === type) return;
  if (type === 'burst') return status(BURST_CLOSED_REASON, 'warn');
  const patch = { type, length_tick: undefined, count: undefined };
  if (type === 'hold') patch.length_tick = Math.max(240, Math.round(S.holdBeats * 960));
  if (n.type === 'burst') {
    patch.lane = 0; // 연타 → 단타/롱노트: 왼쪽 레인으로 만든다
  }
  const before = snapshot();
  const r = tryUpdate(notes(), n.id, patch, maxTick());
  if (!r.ok) {
    status(r.reason, 'warn');
    return;
  }
  setNotes(r.notes.map((x) => (x.id === n.id ? stripUnused(x) : x)));
  commit(before);
  let extra = '';
  if (n.type === 'burst') extra =` ${laneText(0)} 레인에 놓았습니다. 필요하면 [레인 교체]로 옮겨 주세요.`;
  status(`노트를 ${TYPE_NAMES[type]}로 바꿨습니다.${extra}`);
}

// 단타에는 길이·횟수 항목이 없어야 한다
function stripUnused(n) {
  const out = { ...n };
  if (out.type === 'tap') { delete out.length_tick; delete out.count; }
  if (out.type === 'hold') delete out.count;
  return out;
}

export function undoAction() {
  if (!undo()) status('되돌릴 작업이 없습니다.');
  validateSoon();
}

export function redoAction() {
  if (!redo()) status('다시 할 작업이 없습니다.');
  validateSoon();
}

// ---------- 이동 ----------

export function seek(ms) {
  if (!S.chart) return;
  A.audio.seek(ms);
  const dur = durationMs() || A.audio.durationMs;
  ms = Math.max(0, Math.min(ms, dur));
  if (ms < S.view.start || ms > S.view.start + S.view.span) {
    S.view.start = Math.max(0, ms - S.view.span * 0.3);
    A.vertical.clampView();
  }
  A.timeline.follow(ms);
  emit('view');
}

// 노트로 이동해 선택한다 (건강검진 목록에서 사용)
export function focusNote(id) {
  const n = notes().find((x) => x.id === id);
  if (!n) return;
  select(id);
  const ms = S.map.tickToAudioMs(n.tick);
  S.view.start = Math.max(0, ms - S.view.span * 0.4);
  A.vertical.clampView();
  S.tl.start = Math.max(0, ms - S.tl.span * 0.3);
  A.timeline.clamp();
  emit('view');
}
