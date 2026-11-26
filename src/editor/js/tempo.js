// 변속 구간 카드: 곡 중간에 BPM 이 바뀌는 곳을 나누는 화면 + 변속 자동 찾기.
// 계산 규칙은 src/core/tempoSections.ts(수동 편집)와 src/analysis/tempoChanges.ts(자동 찾기)에 있고, 여기서는 화면과 적용만 한다.
// 모든 변경은 retimeChart(api.retime)로 한 번에 적용하고 실행취소 한 번 단위로 기록한다.
import { api } from '../../app/localApi.js';
import { buildTempoEntries, findTempoChanges, SENSITIVITY_NAMES } from '../../analysis/tempoChanges.ts';
import {
  MAX_TEMPO_SECTIONS, METER_CHOICES, addSection, barBeatToTick, nearestBarTick, nearestBeatTick, removeSection, resetToSingle,
  setSectionBpm, setSectionBpmKeepAfter, setSectionMeter, setSectionStart,
} from '../../core/tempoSections.ts';
import { A, seek, validateSoon } from './actions.js';
import { BpmMap } from './timing.js';
import { S, commit, emit, maxTick, notes, on, rebuildTiming, snapshot, status } from './state.js';

const $ = (id) => document.getElementById(id);
const RES = 960;

const fmtTime = (ms) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};
export const fmtBpm = (b) => String(Math.round(b * 10) / 10);
const meterText = (r) => `${r.beats_per_bar || 4}/${r.beat_unit || 4}`;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- 적용 (retimeChart 한 번 = 실행취소 한 단위) ----------

async function applyEntries(entries, offsetMs, okText) {
  if (!S.chart) return false;
  const before = snapshot();
  let res;
  try {
    res = await api.retime({ chart: S.chart, bpm_map: entries, audio_offset_ms: offsetMs, mode: S.retimeMode || 'time' });
  } catch (e) {
    status(e.message, 'error');
    renderTempo(true);
    return false;
  }
  S.chart = res.chart;
  syncKeyMode();
  rebuildTiming();
  commit(before);
  emit('timing');
  validateSoon();
  const extra = res.messages && res.messages.length ? ' ' + res.messages.slice(0, 3).join(' ') : '';
  status(okText + extra, res.messages && res.messages.some((m) => m.includes('오류')) ? 'warn' : 'ok');
  return true;
}

// 계산 결과({ok, entries|reason})를 적용한다. 거절이면 이유를 알리고 화면 값을 되돌린다.
async function applyResult(r, okText) {
  if (!r.ok) {
    status(r.reason, 'warn');
    renderTempo(true);
    return false;
  }
  return applyEntries(r.entries, S.chart.song.audio_offset_ms || 0, okText);
}

const entries = () => S.chart.timing.bpm_map;
const keepAfter = () => $('tempoKeepAfter').checked;

// ---------- 수동 편집 ----------

// 재생 위치(없으면 선택한 노트 위치)에서 가장 가까운 박(또는 마디)에 새 구간
export async function addTempoSection() {
  if (!S.chart) return status('먼저 곡을 열어 주세요.', 'warn');
  const sel = notes().filter((n) => S.selectedIds.includes(n.id));
  const pos = A.audio && A.audio.position > 0 ? S.map.audioMsToTick(A.audio.position) : sel.length ? sel[0].tick : null;
  if (pos === null) return status('구간을 나눌 위치를 정해 주세요. 재생 위치를 옮기거나 노트를 선택한 뒤 눌러 주세요.', 'warn');
  const end = maxTick();
  const tick = $('tempoSnapBar').checked ? nearestBarTick(entries(), pos, end ?? 0) : nearestBeatTick(pos);
  const r = addSection(entries(), tick, { endTick: end });
  const mm = S.map.barBeat(tick);
  await applyResult(r, `${mm} 위치에 변속 구간을 추가했습니다. BPM 은 앞 구간과 같습니다. 숫자를 고쳐 맞춰 주세요.`);
}

export async function removeTempoSection(i) {
  if (!S.chart) return;
  await applyResult(removeSection(entries(), i), `${i + 1}번 구간을 지웠습니다. 앞 구간이 그 자리를 이어받습니다.`);
}

export async function editTempoBpm(i, value) {
  if (!S.chart) return;
  const bpm = Number(value);
  const r = keepAfter() && i < entries().length - 1 ? setSectionBpmKeepAfter(entries(), i, bpm, maxTick()) : setSectionBpm(entries(), i, bpm, maxTick());
  await applyResult(r, `${i + 1}번 구간을 BPM ${fmtBpm(bpm)} 로 바꿨습니다. 그 구간 이후의 시간이 바뀝니다.`);
}

// 시작 위치 입력("마디:박" 또는 마디 번호만): 앞 구간의 마디 번호 체계로 읽는다
export async function editTempoStart(i, text) {
  if (!S.chart) return;
  const m = /^\s*(\d+)(?:\s*[:：]\s*(\d+))?\s*$/.exec(String(text));
  if (!m) {
    status('시작 위치는 "마디:박" 모양으로 입력해 주세요. 예) 6:3', 'warn');
    renderTempo(true);
    return;
  }
  const tick = barBeatToTick(entries(), i, Number(m[1]), Number(m[2] || 1));
  if (tick === null) {
    status('그 마디·박은 앞 구간에서 찾을 수 없습니다. 박 번호가 박자를 넘지 않는지 확인해 주세요.', 'warn');
    renderTempo(true);
    return;
  }
  await applyResult(setSectionStart(entries(), i, tick, maxTick()), `${i + 1}번 구간의 시작을 ${S.map.barBeat(tick)} 로 옮겼습니다.`);
}

export async function editTempoMeter(i, value) {
  if (!S.chart) return;
  const [bpb, unit] = String(value).split('/').map(Number);
  await applyResult(setSectionMeter(entries(), i, bpb, unit), `${i + 1}번 구간의 박자를 ${value} 로 바꿨습니다.`);
}

// 타임라인에서 PC 로 끌어서 옮길 때 (박 단위)
export async function moveTempoSection(i, tick) {
  if (!S.chart) return;
  if (tick === entries()[i].tick) return;
  await applyResult(setSectionStart(entries(), i, tick, maxTick()), `${i + 1}번 구간의 시작을 ${S.map.barBeat(tick)} 로 옮겼습니다.`);
}

export async function resetTempo() {
  if (!S.chart) return;
  if (entries().length < 2) return status('이미 곡 전체가 한 BPM 입니다.');
  if (!confirm('변속 구간을 모두 지우고 곡 전체를 한 BPM 으로 되돌릴까요? (되돌리기 Ctrl+Z 로 복구할 수 있습니다)')) return;
  const a = S.analysis && S.analysis.timing;
  const r = resetToSingle(entries(), a ? a.bpm : undefined);
  if (!r.ok) return status(r.reason, 'warn');
  await applyEntries(r.entries, a ? a.audio_offset_ms : S.chart.song.audio_offset_ms || 0, `곡 전체를 한 BPM(${fmtBpm(r.entries[0].bpm)})으로 되돌렸습니다.`);
}

// ---------- 자동 찾기 ----------

export function findTempo() {
  if (!S.analysis || !S.analysis.beats || !S.analysis.beats.beats_ms || !S.analysis.beats.beats_ms.length) return status('먼저 [분석]을 해 주세요. 분석이 끝난 곡에서만 변속을 찾을 수 있습니다.', 'warn');
  const sens = $('tempoSens').value;
  const result = findTempoChanges(S.analysis.beats.beats_ms, sens);
  S.tempoFound = result.candidates.length ? { result, checked: new Set(result.candidates.map((c) => c.section)), sens } : null;
  $('tempoMsg').textContent = result.message;
  status(result.message, result.candidates.length ? 'ok' : 'info');
  renderTempo(true);
  emit('view');
}

export function cancelTempoFound() {
  if (!S.tempoFound) return;
  S.tempoFound = null;
  $('tempoMsg').textContent = '';
  renderTempo(true);
  emit('view');
}

export async function applyTempoFound() {
  const f = S.tempoFound;
  if (!f || !S.chart) return;
  const selected = [...f.checked];
  if (!selected.length) return status('적용할 후보를 하나 이상 체크해 주세요.', 'warn');
  if (entries().length > 1 && !confirm(`이미 만든 변속 구간 ${entries().length - 1}개가 있습니다. 자동으로 찾은 구간으로 바꿀까요? (되돌리기 Ctrl+Z 로 복구할 수 있습니다)`)) return;
  const row = entries()[0] || {};
  const built = buildTempoEntries(f.result, selected, { beats_per_bar: row.beats_per_bar || 4, beat_unit: row.beat_unit || 4 });
  const ok = await applyEntries(built.entries, built.audio_offset_ms, `변속 구간 ${built.entries.length - 1}곳을 적용했습니다. 시작점은 ${built.audio_offset_ms}ms 입니다.`);
  if (ok) cancelTempoFound();
}

// ---------- 화면 ----------

let lastSig = '';

function candidateRows() {
  const f = S.tempoFound;
  if (!f) return [];
  // 체크한 후보를 모두 적용했을 때의 마디:박 으로 위치를 보여 준다
  const built = buildTempoEntries(f.result, [...f.checked]);
  const map = new BpmMap(built.entries, built.audio_offset_ms);
  const ticks = new Map();
  let idx = 1;
  for (const c of f.result.candidates) {
    if (f.checked.has(c.section)) ticks.set(c.section, built.entries[idx++].tick);
  }
  return f.result.candidates.map((c) => ({ c, pos: ticks.has(c.section) ? map.barBeat(ticks.get(c.section)) : '-' }));
}

export function renderTempo(force = false) {
  const box = $('tempoList');
  if (!box) return;
  const rows = S.chart ? S.chart.timing.bpm_map : [];
  const sig = JSON.stringify(rows) + '|' + (S.chart ? S.chart.song.audio_offset_ms : '') + '|' + (S.tempoFound ? [...S.tempoFound.checked].join(',') + S.tempoFound.sens : '') + '|' + !!S.analysis;
  if (!force && sig === lastSig) return;
  lastSig = sig;
  box.innerHTML = '';
  if (!S.chart) {
    box.innerHTML = '<p class="help">곡을 연 뒤에 쓸 수 있습니다.</p>';
  } else {
    const head = document.createElement('div');
    head.className = 'trow thead';
    head.innerHTML = '<span>#</span><span>시작 (마디:박)</span><span>BPM</span><span>박자</span><span></span>';
    box.appendChild(head);
    rows.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'trow';
      const startMs = S.map.tickToAudioMs(r.tick);
      row.innerHTML = `
        <button type="button" class="tn sm" title="이 위치로 이동">${i + 1}</button>
        ${i === 0 ? `<span class="tstart0">곡 처음 <small>${fmtTime(startMs)}</small></span>` : `<span class="tstartw"><input class="tstart" type="text" inputmode="numeric" value="${esc(S.map.barBeat(r.tick))}" aria-label="${i + 1}번 구간 시작 (마디:박)"><small>${fmtTime(startMs)}</small></span>`}
        <input class="tbpm num" type="number" min="40" max="300" step="0.01" value="${Math.round(r.bpm * 1000) / 1000}" aria-label="${i + 1}번 구간 BPM">
        <select class="tmeter" aria-label="${i + 1}번 구간 박자">${METER_CHOICES.map((m) => `<option value="${m.label}"${m.label === meterText(r) ? ' selected' : ''}>${m.label}</option>`).join('')}${METER_CHOICES.some((m) => m.label === meterText(r)) ? '' : `<option value="${meterText(r)}" selected>${meterText(r)}</option>`}</select>
        <button type="button" class="tdel sm" ${i === 0 ? 'disabled' : ''} aria-label="${i + 1}번 구간 삭제">삭제</button>`;
      row.querySelector('.tn').addEventListener('click', () => seek(startMs));
      const st = row.querySelector('.tstart');
      if (st) st.addEventListener('change', () => editTempoStart(i, st.value));
      row.querySelector('.tbpm').addEventListener('change', (e) => editTempoBpm(i, e.target.value));
      row.querySelector('.tmeter').addEventListener('change', (e) => editTempoMeter(i, e.target.value));
      row.querySelector('.tdel').addEventListener('click', () => removeTempoSection(i));
      box.appendChild(row);
    });
  }
  $('btnTempoAdd').disabled = !S.chart || rows.length >= MAX_TEMPO_SECTIONS;
  $('btnTempoReset').disabled = !S.chart || rows.length < 2;
  const canFind = !!(S.chart && S.analysis && S.analysis.beats && S.analysis.beats.beats_ms && S.analysis.beats.beats_ms.length);
  $('btnTempoFind').disabled = !canFind;
  $('btnTempoFind').title = canFind ? '분석한 박 위치에서 BPM 이 바뀌는 곳을 찾습니다.' : '먼저 [분석]을 해야 쓸 수 있습니다.';
  $('tempoCount').textContent = rows.length > 1 ? `${rows.length - 1}곳 변속 · 구간 ${rows.length}/${MAX_TEMPO_SECTIONS}` : '구간 없음 (곡 전체 한 BPM)';
  // 후보 목록
  const fbox = $('tempoFound');
  fbox.hidden = !S.tempoFound;
  fbox.innerHTML = '';
  if (S.tempoFound) {
    const list = document.createElement('div');
    list.className = 'tcands';
    candidateRows().forEach(({ c, pos }, k) => {
      const lab = document.createElement('label');
      lab.className = 'tcand';
      lab.innerHTML = `<input type="checkbox" ${S.tempoFound.checked.has(c.section) ? 'checked' : ''}> <b>${k + 1}</b> <span>${esc(pos)} · ${fmtTime(c.timeMs)}</span> <span>BPM ${fmtBpm(c.bpm)}</span> <small>신뢰도 ${Math.round(c.confidence * 100)}%</small>`;
      lab.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) S.tempoFound.checked.add(c.section);
        else S.tempoFound.checked.delete(c.section);
        renderTempo(true);
        emit('view');
      });
      list.appendChild(lab);
    });
    fbox.appendChild(list);
    const btns = document.createElement('div');
    btns.className = 'row';
    btns.innerHTML = '<button id="btnTempoApply" type="button" class="primary sm">적용</button><button id="btnTempoCancel" type="button" class="sm">취소</button>';
    btns.querySelector('#btnTempoApply').addEventListener('click', applyTempoFound);
    btns.querySelector('#btnTempoCancel').addEventListener('click', cancelTempoFound);
    fbox.appendChild(btns);
  }
}

export function initTempo() {
  for (const k of ['strict', 'normal', 'sensitive']) {
    const o = $('tempoSens').querySelector(`[value="${k}"]`);
    if (o) o.textContent = SENSITIVITY_NAMES[k];
  }
  $('btnTempoAdd').addEventListener('click', addTempoSection);
  $('btnTempoReset').addEventListener('click', resetTempo);
  $('btnTempoFind').addEventListener('click', findTempo);
  for (const ev of ['song', 'timing', 'analysis', 'change']) on(ev, () => renderTempo());
  on('song', () => { S.tempoFound = null; $('tempoMsg').textContent = ''; renderTempo(true); });
  renderTempo(true);
}
