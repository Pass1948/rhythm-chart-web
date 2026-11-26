// 진입점: 설정·프리셋 불러오기, 모듈 연결, 재생 막대, 단축키, 화면 갱신 루프(requestAnimationFrame).
import { clampRate, stepRate } from './test_control.js';
import { initThemeMode, setMode } from './theme_mode.js';
import { A, cancelPaste, focusNote, clearSelection, copySelected, cutSelected, startPaste, redoAction, refreshSongs, save, seek, selectAll, undoAction, deleteSelected, validateSoon } from './actions.js';
import { api } from '../../app/localApi.js';
import { AudioEngine } from './audio.js';
import { askBurstCount, initAnalyzeCard, initPanels, renderAnalyze, renderHealth, renderSelected, renderSong } from './panels.js';
import { BpmMap } from './timing.js';
import { beatsInWindow, unitTicks } from './metronome.js';
import { S, durationMs, gridStep, notes, on, status } from './state.js';
import { Timeline } from './timeline.js';
import { VerticalEditor, formatTime } from './vertical.js';

const $ = (id) => document.getElementById(id);

let hitTimes = [];
let hitVersion = -1;
let changeVersion = 0;

function boot() {
  initThemeMode(markThemeMenu); // 저장된 화면 모드 적용 + 디자인 토큰(Canvas 색) 읽기
  A.audio = new AudioEngine();
  A.vertical = new VerticalEditor($('vertical'), { seek, askBurstCount });
  A.timeline = new Timeline($('timeline'), { seek, askBurstCount });
  window.__metro = () => ({ scheduled: [...A.audio.scheduledLog], map: S.map, enabled: A.audio.metroEnabled }); // 점검용 (화면 자동 확인에서 예약된 박 시각을 읽는다)
  window.__editor = () => ({ A, S }); // 점검용 (화면 자동 확인에서 노트 좌표를 읽는다)
  S.preset = 'mix';
  S.retimeMode = 'time';
  initPanels();
  bindTransport();
  bindRightPanel();
  bindPopups();
  bindThemeMenu();
  bindHotkeys();
  on('change', () => { changeVersion++; validateSoon(); });
  on('view', () => { A.vertical.clampView(); A.timeline.clamp(); });
  loadLocalInfo();
  requestAnimationFrame(frame);
  window.addEventListener('beforeunload', (e) => {
    if (S.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  $('btnTest').addEventListener('click', () => openTest(null));
  $('btnTestHere').addEventListener('click', () => openTest('here'));
}

// 판정 폭·검증 기준·분석 방식 목록(config 폴더의 설정)과 곡 목록(이 기기에 저장된 곡)을 불러온다
async function loadLocalInfo() {
  try {
    [S.config, S.presets] = await Promise.all([api.config(), api.presets()]);
    initAnalyzeCard();
    renderAnalyze();
    await refreshSongs();
    renderSong();
    renderHealth();
    renderSelected();
  } catch (e) {
    status(e.message, 'error');
  }
}

// 검사 카드 접기/펴기. 접힘 상태는 localStorage 에 저장한다(저장소가 막혀 있어도 정상 동작). 기본값은 펼침.
const RIGHT_KEY = 'noteDesign.inspectCollapsed';
function readRightPref() {
  try {
    return window.localStorage.getItem(RIGHT_KEY) === '1';
  } catch (e) {
    return false;
  }
}
function writeRightPref(collapsed) {
  try {
    window.localStorage.setItem(RIGHT_KEY, collapsed ? '1' : '0');
  } catch (e) {
    /* 저장소가 없어도 동작한다 */
  }
}
function applyRightCollapsed(collapsed) {
  $('rightCol').classList.toggle('collapsed', collapsed); // 접어도 제목 줄의 오류·경고 배지는 보인다
  const b = $('btnRightToggle');
  b.textContent = collapsed ? '펴기 ▾' : '접기 ▴';
  b.setAttribute('aria-expanded', String(!collapsed));
}
function bindRightPanel() {
  applyRightCollapsed(readRightPref());
  $('btnRightToggle').addEventListener('click', () => {
    const next = !$('rightCol').classList.contains('collapsed');
    applyRightCollapsed(next);
    writeRightPref(next);
  });
}

// ⋯ 메뉴의 화면 모드 표시(현재 선택에 ✓)와 선택 동작
function markThemeMenu(mode) {
  for (const b of document.querySelectorAll('#moreMenu [data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
}
function bindThemeMenu() {
  for (const b of document.querySelectorAll('#moreMenu [data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
}

// 상단 ⋯ 더보기 메뉴와 편집 도움말 팝오버: 바깥 클릭·Esc 로 닫히고, 메뉴는 ↑↓ 키로 항목을 옮긴다
function bindPopups() {
  const menu = $('moreMenu');
  const mbtn = $('btnMore');
  const help = $('editHelp');
  const hbtn = $('btnEditHelp');
  const setMenu = (open) => {
    menu.hidden = !open;
    mbtn.setAttribute('aria-expanded', String(open));
    if (open) { const first = menu.querySelector('button:not(:disabled)'); if (first) first.focus(); }
  };
  const setHelp = (open) => {
    help.hidden = !open;
    hbtn.setAttribute('aria-expanded', String(open));
  };
  mbtn.addEventListener('click', (e) => { e.stopPropagation(); setHelp(false); setMenu(menu.hidden); });
  hbtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(false); setHelp(help.hidden); });
  menu.addEventListener('click', (e) => { if (e.target.closest('button')) setMenu(false); }); // 항목을 누르면 닫힌다(동작은 각 버튼 그대로)
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) setMenu(false);
    if (!help.hidden && !help.contains(e.target)) setHelp(false);
  });
  document.addEventListener('keydown', (e) => {
    const inMenu = !menu.hidden;
    if (e.code === 'Escape' && (inMenu || !help.hidden)) {
      e.preventDefault();
      e.stopPropagation();
      const wasMenu = inMenu;
      setMenu(false);
      setHelp(false);
      (wasMenu ? mbtn : hbtn).focus();
      return;
    }
    if (inMenu && (e.code === 'ArrowDown' || e.code === 'ArrowUp')) {
      e.preventDefault();
      const items = [...menu.querySelectorAll('button:not(:disabled)')];
      const at = items.indexOf(document.activeElement);
      const next = e.code === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next].focus();
    }
  }, true);
}

// 메인 재생 속도 (저장하지 않음). 곡 시간 기준이라 메트로놈·히트사운드·재생선이 그대로 따라간다.
function setMainRate(raw) {
  const c = clampRate(raw, A.audio.rate);
  A.audio.setRate(c.value);
  for (const b of document.querySelectorAll('.mrate')) b.classList.toggle('on', Number(b.dataset.rate) === c.value);
  $('rateLabel').textContent = `${c.value}배`;
  $('rateLabel').hidden = c.value === 1;
  $('btnRate1').hidden = c.value === 1;
  if (c.note) status(c.note, 'warn');
}

function bindRate() {
  for (const b of document.querySelectorAll('.mrate')) b.addEventListener('click', () => setMainRate(b.dataset.rate));
  $('btnRate1').addEventListener('click', () => setMainRate(1));
  window.__setMainRate = setMainRate; // 점검용
}

// 재생 막대: 재생/일시정지, 탐색 슬라이더, 볼륨, 히트사운드
function bindTransport() {
  $('btnPlay').addEventListener('click', togglePlay);
  const seekBar = $('seek');
  seekBar.addEventListener('input', () => seek(Number(seekBar.value)));
  $('volume').addEventListener('input', (e) => A.audio.setVolume(Number(e.target.value) / 100));
  $('hitSound').addEventListener('change', (e) => { A.audio.hitEnabled = e.target.checked; });
  bindRate();
  bindMetronome();
  $('tlZoom').addEventListener('input', (e) => {
    const center = S.tl.start + S.tl.span / 2;
    S.tl.span = Number(e.target.value) * 1000;
    S.tl.start = center - S.tl.span / 2;
    A.timeline.clamp();
    $('tlZoomVal').textContent = e.target.value + '초';
  });
  $('btnUndo').addEventListener('click', undoAction);
  $('btnRedo').addEventListener('click', redoAction);
}

// 메트로놈: 켜기/끄기, 볼륨, 소리 간격, 소리 시작 지점 소리. 박자 정보가 바뀌면 예약한 소리를 취소하고 새 박자로 다시 예약한다.
function bindMetronome() {
  const metro = $('metro');
  metro.addEventListener('change', () => { A.audio.metroEnabled = metro.checked; A.audio.cancelScheduled(); });
  $('metroVolume').addEventListener('input', (e) => { A.audio.metroVolume = Number(e.target.value) / 100; });
  $('metroUnit').addEventListener('change', () => A.audio.cancelScheduled());
  $('onsetSound').addEventListener('change', (e) => { A.audio.onsetEnabled = e.target.checked; A.audio.cancelScheduled(); });
  for (const ev of ['timing', 'analysis', 'song']) on(ev, () => { A.audio.cancelScheduled(); refreshMetronomeUi(); });
  refreshMetronomeUi();
}

// 곡을 열지 않았으면 메트로놈 체크를 비활성으로 두고 안내한다. 소리 시작 지점 소리는 분석 후에만 쓸 수 있다.
function refreshMetronomeUi() {
  const m = $('metro');
  m.disabled = !S.chart;
  m.parentElement.title = S.chart ? '박자에 맞춰 딱딱 소리가 납니다. 음악과 어긋나면 BPM이나 시작점이 맞지 않는 것입니다. (단축키 M)' : '곡을 연 뒤에 쓸 수 있습니다.';
  if (!S.chart && m.checked) { m.checked = false; A.audio.metroEnabled = false; }
  const o = $('onsetSound');
  o.disabled = !(S.chart && S.analysis);
  o.parentElement.title = o.disabled ? '먼저 [분석]을 해야 쓸 수 있습니다.' : '분석으로 찾은 소리 시작 지점마다 짧은 소리가 납니다. 음악 소리와 맞는지 들어 보세요.';
  if (o.disabled && o.checked) { o.checked = false; A.audio.onsetEnabled = false; }
}

// 박자 소리 계산에 쓸 시간 지도: 시작점 버튼을 누르는 중이면 아직 반영 전의 새 시작점으로 미리 들어 볼 수 있게 한다
export function metronomeMap() {
  if (S.pendingOffset !== null && S.pendingOffset !== undefined && S.chart) return new BpmMap(S.chart.timing.bpm_map, S.pendingOffset);
  return S.map;
}

function scheduleMetronomeSounds() {
  if (A.audio.metroEnabled && S.chart) {
    const map = metronomeMap();
    const step = unitTicks($('metroUnit').value, gridStep());
    A.audio.scheduleMetronome((from, to) => beatsInWindow(map, from, to, step));
  }
  if (A.audio.onsetEnabled && S.analysis) A.audio.scheduleOnsets(onsetTimes());
}

let onsetCache = { src: null, list: [] };
function onsetTimes() {
  if (onsetCache.src !== S.analysis) onsetCache = { src: S.analysis, list: S.analysis.candidates.map((c) => c.time_ms).sort((a, b) => a - b) };
  return onsetCache.list;
}

async function togglePlay() {
  if (!A.audio.buffer) return status('먼저 곡을 열어 주세요.', 'warn');
  await A.audio.toggle();
  $('btnPlay').textContent = A.audio.playing ? 'Ⅱ' : '▶';
}

// 단축키: 슬라이더·버튼에 포커스가 있어도 동작해야 하므로 숫자·글자 입력창에서만 무시한다
function bindHotkeys() {
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(t.type));
    if (typing || document.querySelector('dialog[open]')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyS') { e.preventDefault(); save(); return; }
    if (ctrl && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undoAction(); return; }
    if (ctrl && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) { e.preventDefault(); redoAction(); return; }
    if (!ctrl && e.code === 'KeyM') { e.preventDefault(); toggleMetronome(); return; }
    if (ctrl && e.code === 'KeyA') { e.preventDefault(); selectAll(); return; }
    if (ctrl && e.code === 'KeyC') { e.preventDefault(); copySelected(); return; }
    if (ctrl && e.code === 'KeyX') { e.preventDefault(); cutSelected(); return; }
    if (ctrl && e.code === 'KeyV') { e.preventDefault(); startPaste(e.shiftKey); return; }
    if (e.code === 'Escape') { if (!cancelPaste()) clearSelection(); return; }
    if (!ctrl && (e.code === 'BracketLeft' || e.code === 'BracketRight')) { e.preventDefault(); setMainRate(stepRate(A.audio.rate, e.code === 'BracketRight' ? 1 : -1)); return; }
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) togglePlay(); return; }
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); deleteSelected(); }
  });
}

// 단축키 M: 메트로놈 켜기/끄기
function toggleMetronome() {
  const m = $('metro');
  if (m.disabled) return status('곡을 연 뒤에 메트로놈을 쓸 수 있습니다.', 'warn');
  m.checked = !m.checked;
  m.dispatchEvent(new Event('change'));
  status(m.checked ? '메트로놈을 켰습니다. 박자에 맞춰 딱딱 소리가 납니다. 음악과 어긋나면 BPM이나 시작점이 맞지 않는 것입니다.' : '메트로놈을 껐습니다.');
}

// 화면 갱신 루프: 재생 위치는 오디오 시계를 기준으로 한다
function frame() {
  const pos = A.audio.position;
  if (A.audio.playing) {
    const v = S.view;
    if (S.followPlayhead && (pos > v.start + v.span * 0.75 || pos < v.start)) {
      v.start = Math.max(0, pos - v.span * 0.25);
      A.vertical.clampView();
    }
    A.timeline.follow(pos);
    A.audio.scheduleHits(getHitTimes());
    scheduleMetronomeSounds();
    if (pos >= A.audio.durationMs - 30) $('btnPlay').textContent = '▶';
  }
  const dur = A.audio.durationMs || durationMs();
  $('timeLabel').textContent = `${formatTime(pos)} / ${formatTime(dur)}`;
  const bar = $('seek');
  if (document.activeElement !== bar) {
    bar.max = Math.max(1, Math.round(dur));
    bar.value = Math.round(pos);
  }
  A.vertical.draw(pos);
  A.timeline.draw(pos);
  requestAnimationFrame(frame);
}

// 히트사운드 시각 목록 (채보가 바뀔 때만 다시 만든다)
function getHitTimes() {
  if (hitVersion !== changeVersion) {
    hitTimes = notes().map((n) => ({ id: n.id, ms: S.map.tickToAudioMs(n.tick) })).sort((a, b) => a.ms - b.ms);
    hitVersion = changeVersion;
  }
  return hitTimes;
}

// [테스트] 팝업: 현재 채보로 낙하 미리보기와 터치 판정을 해 본다. startHere 가 'here' 이면 선택한 노트(없으면 현재 재생 위치)부터 시작하도록 팝업을 연다.
export const TEST_POPUP_HASH = '#rcw-test';
function testPopupUrl() {
  return window.location.href.split('#')[0] + TEST_POPUP_HASH;
}

function openTest(startHere) {
  if (!S.chart || !S.song) return status('먼저 곡을 열어 주세요.', 'warn');
  const win = window.open(testPopupUrl(), 'rhythm_test', 'width=540,height=920'); // 같은 앱을 #rcw-test 주소로 열면 테스트 화면이 뜬다(srcpp\main.ts)
  if (!win) return status('팝업이 막혔습니다. 주소창 오른쪽의 팝업 허용을 눌러 주세요.', 'warn');
  const hints = () => {
    const sel = notes().filter((n) => S.selectedIds.includes(n.id));
    return { positionMs: A.audio ? A.audio.position : 0, selectedTick: sel.length ? Math.min(...sel.map((n) => n.tick)) : null };
  };
  window.__getTestData = () => ({
    chart: JSON.parse(JSON.stringify(S.chart)), diffIndex: S.diffIndex, song: S.song, audioUrl: api.audioUrl(S.song),
    startMode: startHere === 'here' ? (hints().selectedTick !== null ? 'selected' : 'current') : null,
  });
  window.__getTestHints = hints;                 // 팝업이 시작할 때 현재 위치·선택을 물어본다
  window.__focusNote = (id) => { focusNote(id); window.focus(); }; // 팝업의 MISS 목록 클릭 → 메인 편집기에서 그 노트로 이동·선택
  if (startHere === 'here') status('선택한 노트(없으면 현재 재생 위치)부터 테스트할 수 있게 팝업을 열었습니다.');
}

boot();
