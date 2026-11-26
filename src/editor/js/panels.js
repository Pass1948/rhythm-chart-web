// 패널: 왼쪽 열(곡 정보·검사·분석) 카드, 건강검진, 선택한 노트 패널, 대화상자. DOM 연결과 표시 갱신을 담당한다.
import {
  A, TRACK, applyTiming, cancelAnalyze, cancelPaste, copySelected, cutSelected, startPaste, togglePasteFlip, clearNotes, convertSelected, deleteSelected, exportChart, focusNote, generate, gridFitText, importFile, loadJson,
  openSong, repickSoon, runAnalyze, save, saveSongInfo, startDemo, swapSelectedLane, updateSelected,
} from './actions.js';
import { BURST_MAX, BURST_MIN, FOUR_KEY_LABELS, TYPE_NAMES, burstRate, clampBurstCount, healthStats, isBurstNote, isLong, laneText, noteEnd } from './edit_rules.js';
import { formatTime } from './vertical.js';
import { renderHelp } from './help_rules.js';
import { normalizeShape } from './note_shape.js';
import { optionsFor, saveOptions } from './gen_options.js';
import { fields } from '../../generate/ruleFields.ts';
import { thumbRules } from '../../generate/rules.ts';
import { loadSettings, saveSettings } from '../../storage/settingsStore.ts';
import { nudgeOffset } from './metronome.js';
import { initUnityLinkUi, refreshUnityLinkUi } from './unity_link_ui.js';
import { askDeleteSong, initSongDelete } from './song_delete.js';
import { initTempo } from './tempo.js';
import { S, applyKeyMode, commit, durationMs, emit, endPaste, keyMode, notes, on, selectedNote, snapshot, status, syncKeyMode } from './state.js';

const $ = (id) => document.getElementById(id);

const DETECTOR_HELP = {
  hybrid: '주파수 변화와 음량 증가를 함께 봅니다. 팝·밴드처럼 여러 악기가 섞인 곡에 알맞습니다.',
  flux: '새롭게 나타나는 소리를 찾습니다. 드럼·피아노처럼 소리의 시작이 또렷한 곡에 알맞습니다.',
  bass: '낮은 소리(킥·베이스)의 변화를 봅니다. 킥이 뚜렷한 EDM·힙합에 알맞습니다. 킥만 따로 분리하는 기능은 아닙니다.',
  treble: '높은 소리(하이햇·타악기)의 변화를 봅니다. 보컬의 자음도 잡힐 수 있습니다.',
  energy: '음량이 갑자기 커지는 순간을 찾습니다. 조용한 곳과 강한 타격이 뚜렷한 곡에 알맞고, 계속 큰 소리가 나는 곡에는 불리합니다.',
  drums: '[근사] 악기를 실제로 분리한 것이 아니라 소리 특징으로 추정합니다. 타악(드럼) 성분의 변화를 봅니다. 다른 악기가 섞여 들어갈 수 있습니다.',
  melody: '[근사] 악기를 실제로 분리한 것이 아니라 소리 특징으로 추정합니다. 음높이가 바뀌는 순간(멜로디·화음)을 봅니다. 드럼 소리가 일부 섞일 수 있습니다.',
  vocal: '[근사] 가운데 소리와 사람 목소리 대역(300~3400Hz)을 봅니다. 스테레오 음원에서 더 정확하고, 모노 음원은 정확도가 낮습니다.',
};

// 프리셋 파일의 키는 글자순일 수 있으므로 화면 순서를 고정한다
const DETECTOR_ORDER = ['hybrid', 'flux', 'bass', 'treble', 'energy', 'drums', 'melody', 'vocal'];

// ---------- 공통 보조 ----------

let toastTimer = 0;
function showToast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export function initPanels() {
  initSongDelete();
  initTempo();
  initSongInfoInputs();
  on('status', ({ text, kind }) => {
    const el = $('statusLine');
    el.textContent = text;
    el.className = 'status' + (kind && kind !== 'info' ? ' ' + kind : '');
    el.title = text;
    if (kind === 'warn' || kind === 'error') showToast(text);
  });

  // ----- 곡 등록(맨 위 가로 줄) -----
  const drop = $('dropZone');
  drop.addEventListener('click', () => $('fileInput').click());
  $('btnOpen').addEventListener('click', () => $('fileInput').click());
  $('btnWelcomeUpload').addEventListener('click', () => $('fileInput').click());
  $('btnDemo').addEventListener('click', startDemo);
  $('fileInput').addEventListener('change', (e) => {
    if (e.target.files[0]) importFile(e.target.files[0]);
    e.target.value = '';
  });
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); });
  drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]); });

  // ----- 분석 -----
  const det = $('detector');
  det.addEventListener('change', () => { renderDetectorHelp(); repickSoon(); });
  $('sensitivity').addEventListener('input', (e) => { $('sensitivityVal').textContent = e.target.value + '%'; repickSoon(); });
  $('btnAnalyze').addEventListener('click', runAnalyze);
  $('btnCancel').addEventListener('click', cancelAnalyze);
  const bpmIn = $('bpmInput');
  const offIn = $('offsetInput');
  const applyInputs = () => applyTiming(Number(bpmIn.value), Number(offIn.value));
  bpmIn.addEventListener('change', applyInputs);
  offIn.addEventListener('change', applyInputs);
  for (const b of document.querySelectorAll('.nudge')) b.addEventListener('click', () => nudgeStart(Number(b.dataset.delta)));
  $('bpmHalf').addEventListener('click', () => applyTiming(Math.round(Number(bpmIn.value) * 50) / 100, Number(offIn.value)));
  $('bpmDouble').addEventListener('click', () => applyTiming(Math.round(Number(bpmIn.value) * 200) / 100, Number(offIn.value)));
  $('retimeMode').addEventListener('change', (e) => { S.retimeMode = e.target.value; });
  on('progress', renderProgress);
  setInterval(renderProgress, 150); // 최소 표시 시간·완료 후 3초 유지를 시계로 처리한다

  // ----- 노트 자동 생성 -----
  $('btnGenerate').addEventListener('click', generate);
  $('btnClear').addEventListener('click', clearNotes);
  $('density').addEventListener('input', (e) => { $('densityVal').textContent = e.target.value + '%'; });
  $('difficulty').addEventListener('change', () => {
    const g = { EASY: 4, NORMAL: 8, HARD: 16, GLIITCH: 16 }[$('difficulty').value];
    $('gridSelect').value = String(g);
    S.gridDiv = g;
  });
  $('gridSelect').addEventListener('change', (e) => { S.gridDiv = e.target.value === 'free' ? 'free' : Number(e.target.value); emit('view'); });
  for (const [id,key] of [['density','density'],['holdAmount','amount'],['fkSim','simultaneous']]) {
    $(id).addEventListener('change', () => {
      const diff = $('difficulty').value;
      saveOptions(diff, {...optionsFor(diff), [key]: Number($(id).value)});
      fillGenFields();
    });
  }
  $('difficulty').addEventListener('change', fillGenFields);
  $('btnGenReset').addEventListener('click', () => { saveOptions($('difficulty').value, {}); fillGenFields(); });
  fillGenFields();

  // ----- 상단 버튼 -----
  $('btnSave').addEventListener('click', save);
  $('btnLoadJson').addEventListener('click', () => $('jsonInput').click());
  $('jsonInput').addEventListener('change', (e) => { if (e.target.files[0]) loadJson(e.target.files[0]); e.target.value = ''; });
  $('btnExport').addEventListener('click', () => {
    if (!S.chart) return status('내보낼 곡이 없습니다.', 'warn');
    // 유니티 묶음은 4키 채보만: 2키 채보면 라디오를 잠그고 이유를 보여 준다(선택돼 있었다면 채보 JSON 으로 되돌림)
    const four = S.chart.keyMode === 4;
    $('exportUnityRadio').disabled = !four;
    $('exportUnityWhy').hidden = four;
    if (!four && $('exportUnityRadio').checked) document.querySelector('input[name=what][value=chart]').checked = true;
    syncExportOpts();
    $('dlgExport').showModal();
  });
  // 내보낼 것(채보 JSON / 음원 / 채보 JSON + 음원 / 유니티 묶음): 채보 JSON 일 때만 파일 종류·난이도별 옵션이 보인다
  const syncExportOpts = () => {
    const what = document.querySelector('input[name=what]:checked').value;
    $('exportChartOpts').hidden = what !== 'chart';
    $('unityLinkBox').hidden = what !== 'unity';
    $('exportOk').hidden = what === 'unity'; // 유니티 묶음은 영역 안의 [유니티로 보내기]·[ZIP으로 저장]을 쓴다
    refreshUnityLinkUi();
    $('exportHelp').textContent = what === 'chart'
      ? '오류가 있는 채보는 Unity용으로 내보낼 수 없습니다. 다음 창에서 파일 이름을 확인하고 저장합니다.'
      : what === 'audio'
        ? '업로드한 원본 음원이 ZIP 하나에 담겨 나갑니다(안의 파일 이름·형식은 그대로). 다음 창에서 파일 이름을 확인하고 저장합니다.'
        : what === 'unity'
          ? '음원·채보·정보 표(CSV)가 한 ZIP에 담깁니다. 유니티 프로젝트의 ChartInbox 폴더에 풀면 유니티의 Chart Sync 창에서 동기화할 수 있습니다.'
          : '편집용 채보 JSON, 원본 음원, 안내 글이 ZIP 하나에 담겨 나갑니다. 다시 열 때는 [불러오기]에서 이 ZIP 을 고르세요.';
  };
  for (const r of document.querySelectorAll('input[name=what]')) r.addEventListener('change', syncExportOpts);
  syncExportOpts();
  initUnityLinkUi();
  $('exportForm').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'ok') {
      const what = document.querySelector('input[name=what]:checked').value;
      const kind = document.querySelector('input[name=kind]:checked').value;
      exportChart(what, kind, $('exportSplit').checked);
    }
  });
  initViewOptions();

  // ----- 세로 편집기 도구 -----
  for (const b of document.querySelectorAll('#tools .tool, #tlTools .tool')) { // 오른쪽 채보 편집과 음원 카드의 도구 버튼은 같은 S.tool 을 쓴다
    b.addEventListener('click', () => setTool(b.dataset.tool));
  }
  setTool('select');
  $('btnPrev').addEventListener('click', () => A.vertical.scrollBy(-1));
  $('btnNext').addEventListener('click', () => A.vertical.scrollBy(1));
  $('diffSelect').addEventListener('change', (e) => { S.diffIndex = Number(e.target.value); S.selectedId = null; emit('change'); });

  // ----- 갱신 연결 -----
  on('song', renderSong);
  on('songs', renderSong);
  on('analysis', renderAnalyze);
  on('timing', renderAnalyze);
  on('change', () => { renderHealth(); renderSelected(); renderSong(); });
  on('health', renderHealth);
  on('select', renderSelected);
  on('paste', renderSelected);
  on('live', renderSelected);
}

export function setTool(tool) {
  S.tool = tool;
  endPaste(); // 도구를 바꾸면 붙여넣기 미리보기를 끝낸다
  for (const b of document.querySelectorAll('#tools .tool, #tlTools .tool')) b.classList.toggle('active', b.dataset.tool === tool);
  renderHelp($('toolHelp'), tool);
}

// ---------- 보기 설정: 파형 띠 / 노트 모양 (설정 rcw.settings.v1 에 저장) ----------
function initViewOptions() {
  const st = loadSettings();
  S.shape = normalizeShape(st.editNoteShape);
  S.showWave = st.showWave === null || st.showWave === undefined ? window.innerWidth >= 1024 : st.showWave; // 기본: PC 켬, 폰 끔
  const paint = () => {
    const b = $('btnWave');
    b.classList.toggle('on', S.showWave);
    b.setAttribute('aria-pressed', String(S.showWave));
    for (const sb of document.querySelectorAll('.shapeseg .shape')) {
      const on = sb.dataset.shape === S.shape;
      sb.classList.toggle('active', on);
      sb.setAttribute('aria-pressed', String(on));
    }
  };
  $('btnWave').addEventListener('click', () => {
    S.showWave = !S.showWave;
    saveSettings({ showWave: S.showWave });
    paint();
    status(S.showWave ? '파형을 켰습니다. 폭은 소리 크기, 색은 저음(주황)·중음(초록)·고음(하늘)입니다.' : '파형을 껐습니다.');
  });
  for (const sb of document.querySelectorAll('.shapeseg .shape')) {
    sb.addEventListener('click', () => {
      S.shape = normalizeShape(sb.dataset.shape);
      saveSettings({ editNoteShape: S.shape });
      paint();
    });
  }
  paint();
}

// ---------- 디자인 모드: 기존 방식 / 레퍼런스 규칙 ----------
export function fillGenFields() {
  const diff = $('difficulty').value;
  const saved = optionsFor(diff);
  const rules = {...thumbRules(diff), ...saved.rules};
  $('density').value = saved.density ?? 55;
  $('densityVal').textContent = $('density').value + '%';
  $('holdAmount').value = saved.amount ?? 2;
  $('fkSim').max = rules.chord;
  $('fkSim').value = Math.min(saved.simultaneous ?? rules.chord, rules.chord);
  const box = $('advRulesBody');
  box.replaceChildren();
  for (const field of fields) {
    const label = document.createElement('label');
    label.className = 'advrow';
    label.textContent = field.label;
    const input = document.createElement('input');
    Object.assign(input, {type:'number', min:0, max:field.max, step:field.step, value:rules[field.key]});
    input.addEventListener('change', () => {
      if (input.reportValidity()) saveOptions(diff, {...optionsFor(diff), rules:{...optionsFor(diff).rules, [field.key]:input.valueAsNumber}});
      fillGenFields();
    });
    label.append(input);
    box.append(label);
  }
}

function renderSongHeader() {
  const name = S.chart ? (S.chart.song.title || S.song) : '';
  const nameEl = $('songName');
  nameEl.textContent = name || '곡을 열어 주세요';
  nameEl.title = name || '';
  const meta = $('songMeta');
  meta.textContent = S.chart ? `${notes().length}개 노트 · ${S.dirty ? '저장하지 않은 변경' : '저장됨'}` : '';
  meta.classList.toggle('dirty', !!(S.chart && S.dirty));
  $('audioTitle').textContent = S.chart ? `${name} · ${formatTime(durationMs())}` : '곡을 열어 주세요';
  $('noteCount').textContent = `${S.chart ? notes().length : 0}개 노트`;
}

// [2.1] 곡 제목·아티스트 입력 칸: Enter 또는 포커스 이동(change) 때 확정해 저장한다. 값이 그대로면 저장하지 않는다.
function initSongInfoInputs() {
  const t = $('songTitleInput'), a = $('songArtistInput');
  const commitInfo = () => {
    if (!S.chart) return;
    if (t.value === (S.chart.song.title || '') && a.value === (S.chart.song.artist || '')) return;
    saveSongInfo(t.value, a.value);
  };
  for (const el of [t, a]) {
    el.addEventListener('change', commitInfo);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
  }
}

// 입력 칸을 현재 채보 값으로 맞춘다(곡이 없으면 비활성). 입력 중인 칸은 덮어쓰지 않는다.
function syncSongInfoInputs() {
  for (const [id, key] of [['songTitleInput', 'title'], ['songArtistInput', 'artist']]) {
    const el = $(id);
    el.disabled = !S.chart;
    if (document.activeElement !== el) el.value = S.chart ? (S.chart.song[key] || '') : '';
  }
}

export function renderSong() {
  renderSongHeader();
  syncSongInfoInputs();
  $('welcome').hidden = !!S.chart || (S.songs || []).some((x) => x.has_audio); // 처음 방문(곡이 하나도 없을 때)에만 안내를 보인다
  const sum = $('songSummary');
  if (!S.chart) {
    sum.textContent = '열려 있는 곡이 없습니다.';
  } else {
    const dur = durationMs();
    const cands = S.analysis ? S.analysis.beats.bpm_candidates.map((c) => c.bpm).join(' / ') : '분석 전';
    sum.innerHTML = `<b>${esc(S.chart.song.title || S.song)}</b><br>길이 ${formatTime(dur)} · 노트 ${notes().length}개${S.dirty ? ' · <span style="color:var(--warn)">저장 안 됨</span>' : ''}<br>BPM 후보: ${cands}`;
  }
  const ul = $('songList');
  ul.innerHTML = '';
  for (const s of S.songs) {
    if (!s.has_audio) continue;
    const li = document.createElement('li');
    const name = s.title || s.id;
    li.className = s.id === S.song ? 'on' : '';
    li.tabIndex = 0;
    li.title = name;
    li.innerHTML = `<span class="sname">${esc(name)}</span><small>${s.note_count ? '노트 ' + s.note_count : s.analyzed ? '분석됨' : ''}</small><button type="button" class="ghost songdel" title="‘${esc(name)}’ 작업 지우기" aria-label="‘${esc(name)}’ 작업 지우기">×</button>`;
    li.addEventListener('click', () => openSong(s.id));
    li.addEventListener('keydown', (e) => {
      if (e.target === li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSong(s.id); }
    });
    // [×] 는 곡을 열지 않고 지우기 확인만 띄운다 (줄의 열기 동작으로 번지지 않게 막는다)
    const del = li.querySelector('.songdel');
    del.addEventListener('click', (e) => { e.stopPropagation(); askDeleteSong(s.id); });
    ul.appendChild(li);
  }
  $('btnRecentClear').hidden = !ul.children.length;
  if (!ul.children.length) ul.innerHTML = '<li class="help">아직 작업한 곡이 없습니다. 맨 위 곡 등록 줄에 음원 파일을 끌어다 놓으면 여기에 나타납니다.</li>';
}

// ---------- 분석 카드 ----------
export function initAnalyzeCard() {
  const det = $('detector');
  const names = (S.presets && S.presets.detectors) || {};
  const keep = det.value;
  det.innerHTML = DETECTOR_ORDER.filter((k) => names[k]).map((k) => `<option value="${k}">${esc(names[k])}</option>`).join('');
  det.value = keep || 'hybrid';
  const box = $('presetCards');
  box.innerHTML = '';
  for (const p of (S.presets && S.presets.presets) || []) {
    const d = document.createElement('div');
    d.className = 'pcard' + (p.enabled ? '' : ' off') + (p.id === S.preset ? ' on' : '');
    d.hidden = !p.enabled; // 쓸 수 없는 프리셋 카드는 숨긴다(요소는 남김)
    d.innerHTML = `<b>${esc(p.name)}</b><small>${esc(p.enabled ? p.description : p.reason)}</small>`;
    if (p.enabled) {
      d.addEventListener('click', () => {
        S.preset = p.id;
        // 분석 방식 프리셋(종합·베이스·드럼·멜로디·보컬)은 분석 방식과 민감도를 함께 바꾼다
        const cfg = p.settings || {};
        if (cfg.detector && S.presets.detectors && S.presets.detectors[cfg.detector]) {
          $('detector').value = cfg.detector;
          if (cfg.sensitivity !== undefined) {
            $('sensitivity').value = cfg.sensitivity;
            $('sensitivityVal').textContent = cfg.sensitivity + '%';
          }
          if (S.analysis) repickSoon();
        }
        initAnalyzeCard();
        renderAnalyze();
        status(p.id === 'manual' ? '수동: BPM과 시작점을 직접 입력하고 세로 편집기에서 노트를 만드세요. 분석·자동 생성은 쓰지 않습니다.' : '종합: [분석] 후 [노트 자동 생성]을 누르세요.');
      });
    }
    box.appendChild(d);
  }
  if (det.value) renderDetectorHelp();
  fillGenFields(); // [14] 프리셋(규칙 기본값)을 읽은 뒤 조절 칸을 채운다
}

function renderDetectorHelp() {
  $('detectorHelp').textContent = DETECTOR_HELP[$('detector').value] || '';
}

// 시작점 미세 조정 [-10][-1][+1][+10]: 연속으로 눌러도 서버 호출이 밀리지 않게 짧은 지연 뒤 한 번에 반영한다.
// 누르는 즉시 입력칸과 메트로놈은 새 시작점을 따라간다.
let nudgeTimer = 0;
let nudgeFrom = null;
function nudgeStart(delta) {
  if (!S.chart) return status('먼저 곡을 열어 주세요.', 'warn');
  const current = S.pendingOffset === null ? S.chart.song.audio_offset_ms || 0 : S.pendingOffset;
  if (nudgeFrom === null) nudgeFrom = S.chart.song.audio_offset_ms || 0;
  S.pendingOffset = nudgeOffset(current, delta);
  $('offsetInput').value = S.pendingOffset;
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(async () => {
    const target = S.pendingOffset;
    const from = nudgeFrom;
    nudgeFrom = null;
    const bpm = S.map.rows[0].bpm;
    await applyTiming(bpm, target);
    S.pendingOffset = null;
    status(`시작점 ${from}ms → ${S.chart.song.audio_offset_ms}ms 로 바꿨습니다. (직접 고친 값이라 다시 분석해도 유지됩니다)`);
  }, 450);
}

// [분석]·[노트 자동 생성] 버튼 옆 진행 표시(회전 표시 + 짧은 글자)와 [분석] 아래 가는 막대를 그린다
function paintBadge(prefix, v) {
  const badge = $(prefix + 'Badge');
  badge.hidden = !v.visible;
  badge.className = 'pbadge' + (v.visible && !v.running ? ' ' + v.tone : '');
  $(prefix + 'BadgeText').textContent = v.label;
  badge.title = v.label;
  badge.querySelector('.spin').hidden = !v.spinner;
}

export function renderProgress() {
  const t = performance.now();
  const a = TRACK.analyze.view(t);
  paintBadge('analyze', a);
  const wrap = $('progressWrap');
  wrap.hidden = !a.running;
  wrap.classList.toggle('indet', a.running && a.percent === null);
  $('progressBar').style.width = a.running && a.percent !== null ? Math.max(2, a.percent) + '%' : '0';
  $('btnCancel').hidden = !(a.running && a.cancelable);
  const manual = S.preset === 'manual';
  $('btnAnalyze').disabled = manual || !S.song || TRACK.analyze.isRunning();
  if (a.running) {
    const s = TRACK.analyze.state;
    $('analyzeMsg').textContent = s.phase === 'progress' ? `${s.text} (${Math.round(s.percent || 0)}%)` : '분석을 시작하는 중입니다…';
  } else if (renderProgress.wasRunning) {
    renderAnalyze(); // 끝난 직후 안내 문장을 다시 쓴다
  }
  renderProgress.wasRunning = a.running;
  paintBadge('gen', TRACK.generate.view(t));
  renderStates(a);
}

// 상태별 표시(스타일 위주): 곡 등록 줄의 "분석 중" 칩, 분석 실패 오류 상자, 버튼이 왜 흐린지 한 줄 이유
function renderStates(a) {
  $('songBusy').hidden = !TRACK.analyze.isRunning();
  const noSong = !S.song;
  const hint = $('analyzeHint');
  hint.hidden = !noSong;
  hint.textContent = noSong ? '곡을 먼저 열어 주세요.' : '';
  const failed = a.visible && !a.running && a.tone === 'error';
  $('analyzeError').hidden = !failed;
  if (failed) {
    const sl = $('statusLine');
    $('analyzeErrorText').textContent = sl.classList.contains('error') && sl.textContent ? sl.textContent : a.label;
    $('analyzeMsg').textContent = ''; // 실패했는데 이전 진행 문구(%)가 남지 않게 한다
  }
  let why = '';
  if (noSong) why = '곡을 먼저 열어 주세요.';
  else if (TRACK.analyze.isRunning()) why = '분석이 끝난 뒤에 만들 수 있습니다.';
  else if (!S.analysis) why = '먼저 [분석]을 해 주세요.';
  const g = $('genHint');
  g.hidden = !why;
  g.textContent = why;
  $('btnGenerate').classList.toggle('dim', !!why); // 흐리게만 한다(누르면 기존 안내가 나온다)
}

export function renderAnalyze() {
  const manual = S.preset === 'manual';
  $('btnAnalyze').disabled = manual || !S.song || TRACK.analyze.isRunning();
  $('btnGenerate').disabled = manual;
  const bpmIn = $('bpmInput');
  const offIn = $('offsetInput');
  const multi = S.chart && S.map.isMulti;
  bpmIn.readOnly = !!multi;
  $('bpmHalf').disabled = !!multi;
  $('bpmDouble').disabled = !!multi;
  if (S.chart) {
    if (document.activeElement !== bpmIn) bpmIn.value = Math.round(S.map.rows[0].bpm * 1000) / 1000;
    if (document.activeElement !== offIn) offIn.value = S.chart.song.audio_offset_ms || 0;
  }
  $('bpmNote').textContent = multi ? 'BPM 이 여러 구간인 곡이라 BPM 은 [변속 구간] 카드에서 구간별로 바꿉니다. (시작점은 여기서 바꿀 수 있습니다)' : S.analysis && S.analysis.timing.source === 'manual' ? '직접 입력한 값을 쓰는 중입니다 (재분석해도 유지됩니다).' : '';
  const cbox = $('bpmCandidates');
  cbox.innerHTML = '';
  if (S.analysis) {
    for (const c of S.analysis.beats.bpm_candidates) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sm';
      b.textContent = `${c.bpm} (${c.kind}${c.confidence >= 1 ? ', 가장 유력' : ''})`;
      b.title = `신뢰도 ${c.confidence}`;
      b.disabled = !!multi;
      b.addEventListener('click', () => applyTiming(c.bpm, Number(offIn.value)));
      cbox.appendChild(b);
    }
  }
  const warnBox = $('analyzeWarn');
  const warns = S.analysis && S.analysis.warnings ? S.analysis.warnings : [];
  warnBox.hidden = !warns.length;
  warnBox.innerHTML = warns.map((w) => `<li>${esc(w)}</li>`).join('');
  if (S.analysis && !TRACK.analyze.isRunning()) {
    $('analyzeMsg').textContent = `분석 완료. 소리 시작 지점 ${S.analysis.candidate_count}곳. 다음으로 노트 자동 생성을 눌러 보세요.${gridFitText(S.analysis)}`;
  }
}

// ---------- 건강검진 ----------
export function renderHealth() {
  const body = $('healthBody');
  const list = $('issueList');
  if (!S.chart || !notes().length) {
    body.textContent = S.chart ? '노트가 아직 없습니다.' : '채보가 없습니다.';
    list.innerHTML = '';
    setLight('ok', '이상 없음');
    setBadge('ok', 0, 0);
    return;
  }
  const h = healthStats(notes(), (t) => S.map.tickToChartMs(t));
  const lanePct = (v) => (h.laneTotal ? Math.round((1000 * v) / h.laneTotal) / 10 : 0); // 연타(양쪽)는 제외한 단타·롱노트 기준
  body.innerHTML = `<table>
    <tr><td>초당 노트 수</td><td>평균 ${h.npsAvg}개 · 최대 ${h.npsMax}개</td></tr>
    <tr><td>${h.lane.length === 4 ? '레인 비율' : '좌·우 비율'} (연타 제외)</td><td>${h.lane.length === 4 ? h.lane.map((v, i) => `${i + 1}레인(${FOUR_KEY_LABELS[i]}) ${lanePct(v)}%`).join(' · ') : `왼쪽 ${lanePct(h.lane[0])}% · 오른쪽 ${lanePct(h.lane[1])}%`}</td></tr>
    <tr><td>노트 종류</td><td>단타 ${h.count.tap}개(${h.percent.tap}%) · 롱노트 ${h.count.hold}개(${h.percent.hold}%) · 연타 ${h.count.burst}개(${h.percent.burst}%)</td></tr>

    <tr><td>같은 레인 연속 최대 (연타 제외)</td><td>${h.maxSameLaneRun}개</td></tr>
    <tr><td>전체 노트</td><td>${h.total}개</td></tr></table>`;
  const errors = S.issues.filter((i) => i.level === 'error');
  const warns = S.issues.filter((i) => i.level !== 'error');
  if (errors.length) setLight('bad', `오류 ${errors.length}개`);
  else if (warns.length) setLight('warn', `경고 ${warns.length}개`);
  else setLight('ok', '이상 없음');
  setBadge(errors.length ? 'bad' : warns.length ? 'warn' : 'ok', errors.length, warns.length);
  list.innerHTML = '';
  addLegacyBurstItems(list);
  const counts = new Map();
  for (const issue of S.issues) counts.set(issue.code, (counts.get(issue.code) || 0) + 1);
  if (counts.size) {
    const summary = document.createElement('p');
    summary.textContent = [...counts].map(([key,count]) => key + ' ' + count + '건').join(' · ');
    body.append(summary);
  }
  if (S.gen?.options_used?.changes?.length) {
    const details = document.createElement('details');
    const title = document.createElement('summary');
    title.textContent = '생성 중 바뀐 노트';
    details.append(title);
    for (const change of S.gen.options_used.changes) {
      const row = document.createElement('div');
      row.textContent = formatTime(S.map.tickToAudioMs(change.tick)) + ' · ' + change.action;
      details.append(row);
    }
    body.append(details);
  }
  for (const i of S.issues) {
    const li = document.createElement('li');
    li.className = i.level === 'error' ? 'error' : 'warn';
    li.textContent = (i.level === 'error' ? '오류 · ' : '경고 · ') + i.code + ' · ' + i.message + ' ' + (i.note_ids || []).map(id => '#' + id).join(', ');
    li.title = '눌러서 해당 노트로 이동';
    li.addEventListener('click', () => { if (i.note_ids && i.note_ids.length) focusNote(i.note_ids[0]); });
    list.appendChild(li);
  }
}

// [2.2] 구형 저장본에 남은 연타노트를 난이도별로 안내한다(위치는 마디:박). 있으면 검사 목록 맨 위에 붙이고, 누르면 그 난이도·노트로 이동한다.
function addLegacyBurstItems(list) {
  const diffs = S.chart.difficulties;
  for (let d = 0; d < diffs.length; d++) {
    const bursts = diffs[d].notes.filter(isBurstNote);
    if (!bursts.length) continue;
    const places = bursts.slice(0, 5).map(describeBurstPlace).join(', ');
    const more = bursts.length > 5 ? ` 외 ${bursts.length - 5}개` : '';
    const li = document.createElement('li');
    li.className = 'error';
    li.textContent = `연타노트 · ${diffs[d].name} 난이도 ${bursts.length}개 (${places}${more}) — 삭제하고 단타·롱노트로 다시 입력하지 않으면 유니티로 내보낼 수 없습니다.`;
    li.title = '눌러서 첫 연타노트로 이동';
    li.addEventListener('click', () => focusLegacyBurst(d, bursts[0].id));
    list.appendChild(li);
  }
}

// 연타노트 위치 글자: "마디:박"
function describeBurstPlace(note) {
  return S.map.barBeat(note.tick);
}

// 다른 난이도의 연타로 가려면 난이도부터 바꾼 뒤 노트로 이동한다
function focusLegacyBurst(diffIndex, noteId) {
  if (S.diffIndex !== diffIndex) {
    S.diffIndex = diffIndex;
    S.selectedId = null;
    emit('change');
  }
  focusNote(noteId);
}

function setBadge(kind, errors, warns) {
  const b = $('inspectBadge');
  b.className = 'ibadge ' + (kind === 'ok' ? 'ok' : kind);
  // 이상 없음 = 초록, 오류 있음 = 빨강 "오류 N", 경고만 = 호박색 "경고 N"
  b.textContent = !errors && !warns ? '이상 없음' : errors ? `오류 ${errors}${warns ? ` · 경고 ${warns}` : ''}` : `경고 ${warns}`;
}

function setLight(kind, text) {
  const el = $('healthLight');
  el.className = 'light ' + kind;
  el.textContent = text;
}

// ---------- 선택한 노트 패널 ----------
export function renderSelected() {
  const box = $('selectedBody');
  const diffSel = $('diffSelect');
  if (S.chart && S.chart.difficulties.length > 1) {
    diffSel.hidden = false;
    diffSel.innerHTML = S.chart.difficulties.map((d, i) => `<option value="${i}" ${i === S.diffIndex ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  } else {
    diffSel.hidden = true;
  }
  const n = selectedNote();
  if (S.paste && S.clip) {
    // 붙여넣기 미리보기 모드
    box.className = '';
    box.innerHTML = `<div class="help"><b>붙여넣기 중</b> · 노트 ${S.clip.items.length}개 · 편집기에서 위치를 고르고 클릭하면 붙습니다. 빨간 점선이면 붙일 수 없는 자리입니다. (Esc: 취소)</div>
      <div class="row"><button id="pasteFlip" type="button" class="sm">좌우 반전: ${S.paste.flip ? '켜짐' : '꺼짐'}</button><button id="pasteCancel" type="button" class="sm">취소</button></div>`;
    $('pasteFlip').addEventListener('click', togglePasteFlip);
    $('pasteCancel').addEventListener('click', cancelPaste);
    return;
  }
  if (S.selectedIds.length > 1) {
    box.className = '';
    box.innerHTML = `<div class="help"><b>${S.selectedIds.length}개 선택됨</b> · 선택한 노트 위를 끌면 함께 위아래로 움직입니다. (Esc: 선택 해제)</div><div class="row"><button id="selDelete" type="button" class="sm">삭제</button></div>${clipButtons()}`;
    $('selDelete').addEventListener('click', deleteSelected);
    bindClipButtons();
    return;
  }
  if (!n) {
    box.className = '';
    box.innerHTML = `<div class="help">노트를 클릭해 선택하세요. 빈 곳을 끌면 여러 개를 한꺼번에 선택할 수 있습니다. (Shift: 추가, Ctrl+A: 모두 선택)<br>여러 노트를 끌어서 선택한 뒤 Ctrl+C 로 복사하고, Ctrl+V 로 붙여넣을 위치를 고르세요.</div>${clipButtons(true)}`;
    bindClipButtons();
    return;
  }
  if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'number') return; // 입력 중에는 다시 그리지 않는다
  const lenBeats = isLong(n) ? n.length_tick / 960 : 0;
  const lenMs = isLong(n) ? S.map.tickToChartMs(noteEnd(n)) - S.map.tickToChartMs(n.tick) : 0;
  const limit = (S.config && S.config.validate && S.config.validate.max_burst_per_sec) || 12;
  const rate = n.type === 'burst' ? burstRate(n.count, lenMs) : 0;
  box.className = '';
  box.innerHTML = `<div class="help">종류: <b>${TYPE_NAMES[n.type]}</b> · ${n.type === 'burst' ? '' : `레인: <b>${laneText(n.lane)}</b> · `}${n.type === 'burst' ? (keyMode() === 4 ? '4레인 전체 폭 · ' : '양쪽 레인 전체 폭 · ') : ''} 시작: <b>${S.map.barBeat(n.tick)}</b> (${formatTime(S.map.tickToAudioMs(n.tick))})</div>
    ${n.type === 'hold' ? `<label>길이 (박) <input id="selLen" class="num small" type="number" min="0.25" step="0.25" value="${Math.round(lenBeats * 100) / 100}"> <small class="help">${Math.round(lenMs)}ms</small></label>` : ''}
    ${n.type === 'burst' ? `<div class="help" style="color:var(--warn)">옛 연타노트입니다(${n.count}회). 더 이상 고칠 수 없고 이대로는 유니티로 내보낼 수 없습니다. [삭제] 후 단타·롱노트로 다시 입력하거나, 아래 [단타]·[롱노트]로 바꿔 주세요.</div>` : ''}
    <div class="row">${n.type === 'burst' ? '' : '<button id="selSwap" type="button" class="sm">레인 교체</button>'}<button id="selDelete" type="button" class="sm">삭제</button></div>
    ${clipButtons()}
    <div class="row"><small class="help">종류 바꾸기:</small>${['tap', 'hold'].map((t) => `<button type="button" class="sm conv" data-type="${t}" ${t === n.type ? 'disabled' : ''}>${TYPE_NAMES[t]}</button>`).join('')}</div>`;
  bindClipButtons();
  for (const b of box.querySelectorAll('.conv')) b.addEventListener('click', () => convertSelected(b.dataset.type));
  $('selDelete').addEventListener('click', deleteSelected);
  if ($('selSwap')) $('selSwap').addEventListener('click', swapSelectedLane);
  const len = $('selLen');
  if (len) len.addEventListener('change', () => updateSelected({ length_tick: Math.round(Number(len.value) * 960) }));
}

// ---------- 복사·붙여넣기 버튼 ----------

// 선택 패널의 [복사] [잘라내기] [붙여넣기] 버튼. 복사한 노트가 없으면 [붙여넣기]는 비활성 + 도움말
function clipButtons(pasteOnly = false) {
  const has = !!S.clip;
  const paste = `<button id="selPaste" type="button" class="sm" ${has ? '' : 'disabled'} title="${has ? '붙여넣을 위치를 고릅니다 (Ctrl+V)' : '복사한 노트가 없습니다. 노트를 선택해 먼저 복사하세요.'}">붙여넣기</button>`;
  const copy = pasteOnly ? '' : '<button id="selCopy" type="button" class="sm" title="Ctrl+C">복사</button><button id="selCut" type="button" class="sm" title="Ctrl+X">잘라내기</button>';
  return `<div class="row">${copy}${paste}</div>${has ? '' : '<div class="help">복사한 노트가 없습니다. 노트를 선택해 [복사]를 누르세요.</div>'}`;
}

function bindClipButtons() {
  if ($('selCopy')) $('selCopy').addEventListener('click', copySelected);
  if ($('selCut')) $('selCut').addEventListener('click', cutSelected);
  if ($('selPaste')) $('selPaste').addEventListener('click', () => startPaste(false));
}

// ---------- 연타 횟수 대화상자 ----------
export function askBurstCount(defaultCount, lengthMs) {
  return new Promise((resolve) => {
    const dlg = $('dlgBurst');
    const range = $('dlgBurstRange');
    const num = $('dlgBurstNum');
    const limit = (S.config && S.config.validate && S.config.validate.max_burst_per_sec) || 12;
    const refresh = () => {
      const rate = burstRate(Number(num.value), lengthMs);
      $('burstRate').textContent = `필요한 연타 속도: 초당 ${Math.round(rate * 10) / 10}회` + (rate > limit ? ` — 한계(${limit}회/초)를 넘습니다. 그래도 만들 수 있지만 경고가 표시됩니다.` : '');
      $('burstRate').style.color = rate > limit ? 'var(--warn)' : '';
    };
    const start = clampBurstCount(defaultCount).value;
    range.value = start;
    num.value = start;
    $('burstInfo').textContent = `연타 구간 길이는 ${Math.round(lengthMs)}ms 입니다. 이 구간에서 몇 번 눌러야 성공일까요? (${BURST_MIN}~${BURST_MAX}회)`;
    refresh();
    range.oninput = () => { num.value = range.value; refresh(); };
    num.oninput = () => { range.value = num.value; refresh(); };
    dlg.onclose = () => {
      dlg.onclose = null;
      if (dlg.returnValue !== 'ok') return resolve(null);
      const c = clampBurstCount(num.value);
      if (c.adjusted) status(c.message, 'warn');
      resolve(c.value);
    };
    dlg.returnValue = '';
    dlg.showModal();
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
