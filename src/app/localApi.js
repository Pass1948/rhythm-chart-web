// 로컬 API: 원본 편집기의 서버 호출(api.js)을 브라우저 안 기능으로 대신한다. 이름과 반환 모양은 원본 api.js 와 같다(계약 4번).
// - 곡 저장은 IndexedDB(songStore), 설정은 localStorage(settingsStore), 분석은 Web Worker(workerClient)를 쓴다.
// - 서버 주소로 요청을 보내는 코드는 어디에도 없다(저장은 이 기기 안, 분석은 이 브라우저 안).
// - 이 파일은 JS 이식 대상이라 타입 검사에서 빠진다. 입출력은 JSDoc 으로 적는다.
import { analyzeFileWithMode } from '../analysis/modes/api.ts';
import { cancelAnalysis, normalizeOptions, AnalysisAborted, decodeToMono22k, computeWaveInWorker } from '../analysis/index.ts';
import { gridFitStats } from '../analysis/beats.ts';
import {
  ChartFormatError, ExportBlocked, MODE_DESCRIPTIONS, KEEP_SOUND, chartToJson, exportEditJson, exportUnity, exportUnitySplit, loadChartData,
  loadJudgeConfig, loadPresets, loadValidateConfig, newChart, retimeChart, safeName, sha256Hex,
} from '../core/index.ts';
import { generateChart, thumbRules } from '../generate/index.ts';
import { SongStore } from '../storage/songStore.ts';
import { buildExportFiles } from '../storage/exportFiles.ts';
import { buildUnityBundle } from '../storage/unityBundle.ts';
import { readBundle } from '../storage/bundle.ts';
import { looksLikeZip } from '../storage/zip.ts';
import { saveFile } from '../storage/saveFiles.ts';
import { fromUserSettingsPatch, keyProblem, loadSettings, saveSettings, toUserSettings } from '../storage/settingsStore.ts';

const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|flac)$/i;
const SONG_INFO_MAX = 100; // [2.1] 곡 제목·아티스트 최대 글자 수
const MAX_ANALYSIS_MINUTES = 12; // config\app.json 의 analysis_max_minutes 와 같은 값(아래 deps 로 덮어쓸 수 있다)

// 바꿔 끼울 수 있는 의존 기능(단위 테스트가 메모리 저장소·가짜 분석을 넣는다)
const defaults = {
  openStore: () => SongStore.open(),
  analyzeFile: (file, opts, onProgress) => analyzeFileWithMode(file, opts, onProgress),
  cancelAnalysis: () => cancelAnalysis(),
  decode: (bytes) => decodeToMono22k(bytes),
  download: browserDownload,
  saveFile: (target) => saveFile(target),
  computeWave: (samples, onProgress) => computeWaveInWorker(samples, onProgress),
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
};
let deps = { ...defaults };
let storePromise = null;
const jobs = new Map();      // 곡 id → 분석 작업 {state, progress, text, error, key}
const audioUrls = new Map(); // 곡 id → {url, blob}: 연 곡의 음원 blob: 주소 (audioUrl 이 바로 돌려줄 수 있게 미리 만든다)

/** 테스트용: 의존 기능을 바꿔 끼우고 내부 상태를 비운다. 인자 없이 부르면 기본값으로 되돌린다. */
export function configureLocalApi(over) {
  for (const a of audioUrls.values()) deps.revokeObjectUrl(a.url);
  audioUrls.clear();
  jobs.clear();
  deps = { ...defaults, ...(over || {}) };
  storePromise = over && over.store ? Promise.resolve(over.store) : null;
}

/** 곡 저장소 (처음 부를 때 연다) */
export function getSongStore() {
  if (!storePromise) storePromise = Promise.resolve(deps.openStore());
  return storePromise;
}

/** 오류 응답을 Error 로 만든다(status·data 는 원본 api.js 와 같은 이름) */
function fail(message, status = 400, data = null) {
  const err = new Error(message);
  err.status = status;
  err.data = data;
  return err;
}

/** 파일을 브라우저 다운로드로 저장한다 */
function browserDownload(name, text, mime = 'application/json') {
  const blob = text instanceof Blob ? text : new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

/** 곡을 찾는다. 없으면 안내 오류 */
async function needSong(id, withAudio = false) {
  const store = await getSongStore();
  const rec = await store.get(id, withAudio);
  if (!rec || rec.trashedAt) throw fail(`'${id}' 곡을 찾을 수 없습니다. 먼저 곡을 올려 주세요.`, 404);
  return { store, rec };
}

/** 연 곡의 음원 blob: 주소를 만들어 둔다 */
function rememberAudio(id, blob) {
  const old = audioUrls.get(id);
  if (old && old.blob === blob) return old.url;
  if (old) deps.revokeObjectUrl(old.url);
  const url = deps.createObjectUrl(blob);
  audioUrls.set(id, { url, blob });
  return url;
}

/** 한 곡의 요약(목록용) — 분석 중 표시를 붙인다 */
function withBusy(summary) {
  const j = jobs.get(summary.id);
  return { ...summary, analyzing: !!j && j.state === 'running' };
}

// ---------- 분석 보조 ----------

/** 분석 요청 본문 → 분석 옵션. 분석 방식 프리셋에 최소 간격이 있으면 그 값을 쓴다 */
function buildOptions(body, prevUser) {
  const detector = body.detector || 'hybrid';
  const opt = { detector, sensitivity: body.sensitivity === undefined ? 60 : Number(body.sensitivity) };
  if (body.min_gap_ms !== undefined) {
    opt.minGapMs = Number(body.min_gap_ms);
  } else {
    const preset = (loadPresets().presets || []).find((p) => p.enabled && p.settings && p.settings.detector === detector && p.settings.min_gap_ms);
    if (preset) opt.minGapMs = Number(preset.settings.min_gap_ms);
  }
  if (body.manual) opt.manual = { bpm: body.manual.bpm, audio_offset_ms: body.manual.audio_offset_ms };
  else if (prevUser && !body.reset_manual) opt.manual = { bpm: prevUser.bpm, audio_offset_ms: prevUser.audio_offset_ms };
  return normalizeOptions(opt);
}

/** 저장된 분석과 분석 방식·민감도·최소 간격이 같은가 (같으면 다시 계산하지 않고 박자만 고친다) */
function sameBase(analysis, opt) {
  const o = analysis.options || {};
  return o.detector === opt.detector && Number(o.sensitivity) === opt.sensitivity && Number(o.min_gap_ms) === opt.minGapMs;
}

/** 저장된 분석 결과의 박자 선택(직접 입력/자동)만 바꾼 복사본을 만든다. 소리 시작 지점은 그대로. */
function retimedAnalysis(analysis, manual) {
  const out = JSON.parse(JSON.stringify(analysis));
  const auto = out.timing.auto;
  const user = manual ? { bpm: manual.bpm, audio_offset_ms: manual.audio_offset_ms === null || manual.audio_offset_ms === undefined ? auto.audio_offset_ms : manual.audio_offset_ms } : null;
  out.timing = user
    ? { source: 'manual', bpm: user.bpm, audio_offset_ms: user.audio_offset_ms, auto, user }
    : { source: 'auto', bpm: auto.bpm, audio_offset_ms: auto.audio_offset_ms, auto, user: null };
  out.grid_fit = gridFitStats(out.candidates.map((c) => c.time_ms), out.timing.bpm, out.timing.audio_offset_ms);
  return out;
}

/** 같은 박자 선택인가 */
function sameTiming(a, manual) {
  const u = a.timing.user;
  if (!manual) return !u;
  return !!u && u.bpm === manual.bpm && (manual.audio_offset_ms === null || manual.audio_offset_ms === undefined || u.audio_offset_ms === manual.audio_offset_ms);
}

/** 분석 작업을 시작한다 (끝나면 저장소에 분석 결과를 저장). status() 로 진행을 읽는다. */
function startJob(store, rec, opt, key) {
  const job = { song: rec.id, key, state: 'running', progress: 0, text: '소리 불러오는 중', error: null };
  jobs.set(rec.id, job);
  store.busy.add(rec.id);
  const run = async () => {
    try {
      const res = await deps.analyzeFile(rec.audioBlob, opt, (p, label) => {
        if (job.state !== 'running') return;
        job.progress = Math.round(p * 100);
        job.text = label;
      });
      if (job.state !== 'running') return; // 취소됨
      const wave = res.wave;
      delete res.wave; // 파형은 분석 기록과 따로 보관한다(곡 목록을 가볍게)
      res.song = (rec.chart && rec.chart.song && rec.chart.song.title) || rec.name;
      res.audio_sha256 = rec.audioMeta.sha256;
      if (rec.audioMeta.durationMs > MAX_ANALYSIS_MINUTES * 60000) {
        res.warnings.push(`곡이 ${MAX_ANALYSIS_MINUTES}분보다 깁니다. 분석에 시간이 오래 걸리거나 브라우저 메모리가 부족할 수 있습니다.`);
      }
      await store.saveAnalysis(rec.id, res);
      if (wave) await store.saveWave(rec.id, wave).catch((e) => console.warn('파형 저장 실패', e));
      job.state = 'done';
      job.progress = 100;
    } catch (e) {
      if (job.state !== 'running') return;
      if (e instanceof AnalysisAborted || (e && e.name === 'AnalysisAborted')) {
        job.state = 'canceled';
      } else {
        job.state = 'error';
        job.error = (e && e.message) || '분석하지 못했습니다. 다시 시도해 주세요.';
        console.warn('분석 오류', e);
      }
    } finally {
      store.busy.delete(rec.id);
    }
  };
  job.promise = run();
  return job;
}

/** 화면용: 지금 도는 분석이 끝날 때까지 기다린다(테스트용) */
export async function waitForAnalysis(song) {
  const j = jobs.get(song);
  if (j && j.promise) await j.promise;
}

// ---------- 공개 API (원본 api.js 와 같은 이름) ----------

export const api = {
  // 서버 개념이라 "항상 준비됨" 값만 돌려주는 빈 구현
  shutdown: async () => ({ ok: true }),
  alive: async () => ({ ok: true }),
  analyzer: async () => ({ state: 'on', text: '켜짐', mode: 'local', notice: '' }),
  analyzerOn: async () => ({ state: 'on', text: '켜짐', mode: 'local', notice: '' }),
  analyzerOff: async () => ({ state: 'on', text: '켜짐', mode: 'local', notice: '' }),

  /** 판정 폭·검증 기준 */
  config: async () => ({ judge: { ...loadJudgeConfig() }, validate: { ...loadValidateConfig() } }),

  /** [테스트] 팝업 설정(원본 user_settings 모양) */
  userSettings: async () => ({ settings: toUserSettings(loadSettings()), notes: [] }),
  saveUserSettings: async (patch) => {
    for (const name of ['key_left', 'key_right']) {
      if (patch && patch[name] !== undefined) {
        const why = keyProblem(patch[name]);
        if (why) throw fail(why, 400);
      }
    }
    const res = saveSettings(fromUserSettingsPatch(patch || {}));
    return { settings: toUserSettings(res.settings), notes: res.notes };
  },

  /** 분석 방식·난이도·레인 방식 목록(config\presets.json) */
  presets: async () => {
    const data = JSON.parse(JSON.stringify(loadPresets()));
    // [14] 레퍼런스·통합 규칙의 난이도별 기본값(코드 기본값 + presets.json 덮어쓰기). 화면이 "규칙 기본값"을 미리 채울 때 쓴다
    data.rule_defaults = { reference: {}, unified: {} };
    for (const d of ['EASY', 'NORMAL', 'HARD', 'CUSTOM']) {
      data.rule_defaults.reference[d] = thumbRules(d);
      data.rule_defaults.unified[d] = thumbRules(d);
    }
    return data;
  },

  /** 곡 목록(휴지통 제외) */
  songs: async () => {
    const store = await getSongStore();
    return { songs: (await store.list(false)).map(withBusy) };
  },

  /** 곡을 휴지통으로 보낸다 → 곡별 결과 {song, status(moved/missing/skipped), reason, trash} */
  deleteSongs: async (songs) => {
    const store = await getSongStore();
    const results = [];
    for (const id of Array.isArray(songs) ? songs : []) {
      const item = { song: id, status: 'skipped', reason: '', trash: null };
      results.push(item);
      if (typeof id !== 'string' || !id) {
        item.reason = '곡 이름이 올바르지 않아 건너뛰었습니다.';
        continue;
      }
      const j = jobs.get(id);
      if (j && j.state === 'running') {
        item.reason = '분석이 끝나거나 취소된 뒤에 지울 수 있습니다.';
        continue;
      }
      const rec = await store.get(id, false);
      if (!rec || rec.trashedAt) {
        item.status = 'missing';
        item.reason = '이미 없습니다.';
        continue;
      }
      await store.trash(id);
      item.status = 'moved';
      item.trash = id;
    }
    return { results, moved: results.filter((r) => r.status === 'moved').length };
  },

  /** 휴지통의 곡을 되돌린다 → {song, renamed} */
  restoreSong: async (trash) => {
    const store = await getSongStore();
    const r = await store.restore(trash);
    if (!r) throw fail('되돌릴 곡을 휴지통에서 찾을 수 없습니다.', 400);
    return { song: r.id, renamed: r.renamed };
  },

  /** 같은 음원(SHA-256 같음)이 이미 있으면 그 곡의 요약을, 없으면 null (화면이 "이미 있는 곡입니다" 를 묻는 데 쓴다) */
  findDuplicate: async (file) => {
    const store = await getSongStore();
    const sha = await sha256Hex(await file.arrayBuffer());
    return (await store.findBySha(sha)) || null;
  },

  /** 음원 파일을 곡으로 올린다 → 곡 요약 */
  importFile: async (file) => {
    if (!file || !AUDIO_EXT.test(file.name || '')) throw fail('지원하지 않는 파일 형식입니다. mp3, wav, m4a, ogg, flac 파일을 사용해 주세요.');
    const store = await getSongStore();
    let bytes;
    try {
      bytes = await file.arrayBuffer();
    } catch (e) {
      throw fail('파일을 열지 못했습니다. 다시 선택해 주세요.');
    }
    const sha = await sha256Hex(bytes);
    const dup = await store.findBySha(sha);
    if (dup) return withBusy(dup);
    let dec;
    try {
      dec = await deps.decode(bytes.slice(0));
    } catch (e) {
      throw fail(e && e.name === 'AnalysisError' && e.message ? e.message : '음원을 읽을 수 없습니다. 파일이 손상되었거나 이 브라우저가 지원하지 않는 형식일 수 있습니다. 다른 mp3, wav, m4a, ogg, flac 파일로 다시 시도해 주세요.');
    }
    const title = file.name.replace(AUDIO_EXT, '');
    const durationMs = Math.round(dec.durationMs);
    const chart = newChart(title, '', file.name, durationMs);
    chart.song.audio_sha256 = sha;
    const rec = await store.addSong({
      name: title,
      blob: file,
      meta: { fileName: file.name, mime: file.type || '', size: file.size, sha256: sha, durationMs },
      chart,
    });
    rememberAudio(rec.id, rec.audioBlob || file);
    const list = await store.list(false);
    return withBusy(list.find((s) => s.id === rec.id));
  },

  /** 저장된 분석 결과 */
  analysis: async (song) => {
    const { rec } = await needSong(song);
    if (!rec.analysis) throw fail('분석 결과가 없습니다. 먼저 분석을 해 주세요.', 404);
    return rec.analysis;
  },

  /** 파형 요약(분석 결과 안에 들어 있다) */
  waveform: async (song) => {
    const { rec } = await needSong(song);
    if (!rec.analysis || !rec.analysis.waveform) throw fail('파형이 아직 없습니다. 먼저 분석을 해 주세요.', 404);
    return rec.analysis.waveform;
  },

  /**
   * 음원 blob: 주소. 곡을 열 때(getChart) 미리 만들어 두므로 바로 돌려준다.
   * 아직 준비되지 않은 곡이면 오류.
   */
  audioUrl: (song) => {
    const a = audioUrls.get(song);
    if (!a) throw fail('음원을 아직 준비하지 못했습니다. 곡을 다시 열어 주세요.', 404);
    return a.url;
  },

  /** 채보를 읽는다(곡을 여는 첫 호출이라 음원 주소도 여기서 준비한다) */
  getChart: async (song) => {
    const { rec } = await needSong(song, true);
    if (!rec.audioBlob) throw fail('이 곡의 음원 파일이 없습니다.', 404);
    rememberAudio(song, rec.audioBlob);
    if (!rec.chart) throw fail('저장된 채보가 없습니다.', 404);
    const res = loadChartData(rec.chart);
    return { chart: res.chart, issues: res.issues, converted_from: res.converted_from, conversion_notes: res.conversion_notes };
  },

  /** 채보를 저장한다(이전 버전은 같은 곡 안에 최근 20개 보관) */
  putChart: async (song, chart) => {
    const { store } = await needSong(song);
    if (!chart) throw fail('저장할 채보 내용이 없습니다.');
    const res = loadChartData(chart);
    const stamped = JSON.parse(chartToJson(res.chart));
    await store.saveChart(song, stamped);
    return { saved: true, issues: res.issues };
  },

  /**
   * [2.1] 곡 제목·아티스트를 저장한다 → 갱신된 곡 요약(+ artist).
   * 앞뒤 공백을 자르고 연속 공백은 하나로 줄인다. 빈 제목이면 음원 파일 이름(확장자 제외)으로 되돌린다. 제목·아티스트는 각각 100자까지.
   */
  saveSongInfo: async (song, info) => {
    const { store, rec } = await needSong(song);
    const tidy = (v) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
    const artist = tidy((info || {}).artist);
    let title = tidy((info || {}).title);
    if (!title) title = tidy((rec.audioMeta.fileName || '').replace(AUDIO_EXT, '')) || rec.name;
    const len = (s) => [...s].length;
    if (len(title) > SONG_INFO_MAX) throw fail(`곡 제목은 ${SONG_INFO_MAX}자까지 쓸 수 있습니다. 지금 ${len(title)}자입니다. 줄여서 다시 입력해 주세요. (저장하지 않았습니다)`);
    if (len(artist) > SONG_INFO_MAX) throw fail(`아티스트는 ${SONG_INFO_MAX}자까지 쓸 수 있습니다. 지금 ${len(artist)}자입니다. 줄여서 다시 입력해 주세요. (저장하지 않았습니다)`);
    const summary = await store.saveSongInfo(song, { title, artist });
    return { ...withBusy(summary), artist };
  },

  /**
   * 분석을 시작한다. 같은 설정의 분석 결과가 이미 있으면 다시 계산하지 않고 {finished:true} 를 돌려준다(박자만 직접 입력으로 고친다).
   * 새로 계산해야 하면 {started:true} 를 돌려주고, 진행은 status() 로 읽는다.
   */
  analyze: async (body) => {
    const { store, rec } = await needSong((body || {}).song, true);
    let opt;
    try {
      opt = buildOptions(body, rec.analysis && rec.analysis.timing ? rec.analysis.timing.user : null);
    } catch (e) {
      throw fail(e.message, 400);
    }
    const key = JSON.stringify(opt);
    const running = jobs.get(rec.id);
    if (running && running.state === 'running') {
      if (running.key === key) return { started: true, finished: false };
      running.state = 'canceled'; // 새 요청이 앞의 분석을 대신한다
      deps.cancelAnalysis();
      store.busy.delete(rec.id);
    }
    if (rec.analysis && sameBase(rec.analysis, opt)) {
      if (!sameTiming(rec.analysis, opt.manual)) await store.saveAnalysis(rec.id, retimedAnalysis(rec.analysis, opt.manual));
      jobs.delete(rec.id);
      return { started: false, finished: true };
    }
    if (!rec.audioBlob) throw fail('이 곡의 음원 파일을 찾을 수 없습니다. 곡을 다시 올려 주세요.', 404);
    startJob(store, rec, opt, key);
    return { started: true, finished: false };
  },

  /** 분석 진행 {state: idle/running/done/error/canceled, progress(0~100), text, error} */
  status: async (song) => {
    const j = jobs.get(song);
    if (!j) return { state: 'idle', progress: 0, text: '아직 분석하지 않았습니다.', error: null };
    return { state: j.state, progress: j.progress, text: j.text, error: j.error };
  },

  /** 분석 취소 */
  cancel: async (song) => {
    const j = jobs.get(song);
    if (!j || j.state !== 'running') return { canceled: false };
    j.state = 'canceled';
    j.text = '분석을 취소했습니다.';
    deps.cancelAnalysis();
    const store = await getSongStore();
    store.busy.delete(song);
    return { canceled: true };
  },

  /** 저장된 분석 결과로 노트를 만든다 */
  generate: async (body) => {
    const { rec } = await needSong((body || {}).song);
    if (!rec.analysis) throw fail('분석 결과가 없습니다. 먼저 분석을 해 주세요.');
    const keys = ['ratios', 'hold_beats', 'burst_count', 'difficulty', 'lane_mode', 'key_mode', 'four_key_density', 'four_key_simultaneous', 'user_set', 'density_scale', 'rule_overrides', 'grid_division', 'nps_base', 'max_nps', 'min_gap_ms', 'grid_tolerance', 'design_mode', 'range_start_ms', 'range_end_ms', 'target_nps', 'allow_burst', 'bpm_map', 'audio_offset_ms'];
    const options = {};
    for (const k of keys) if (body[k] !== undefined) options[k] = body[k];
    let result;
    try {
      result = generateChart(rec.analysis, options);
    } catch (e) {
      throw fail(e && e.message ? e.message : '노트를 만들지 못했습니다.', 400);
    }
    result.chart.song.audio_file = rec.audioMeta.fileName;
    result.chart.song.title = (rec.chart && rec.chart.song && rec.chart.song.title) || rec.name;
    result.chart.song.artist = (rec.chart && rec.chart.song && rec.chart.song.artist) || ''; // [2.1] 저장된 아티스트 유지
    return result;
  },

  /** 채보 검사 → {errors, warnings, issues} */
  validate: async (chart) => {
    const res = loadChartData(chart || {});
    const issues = res.issues;
    return { errors: issues.filter((i) => i.level === 'error').length, warnings: issues.filter((i) => i.level !== 'error').length, issues };
  },

  /** BPM·시작점 바꾸기 → {chart, messages, mode_description} */
  retime: async (body) => {
    const chart = loadChartData(body.chart || {}).chart;
    const mode = body.mode || KEEP_SOUND;
    let out;
    try {
      out = retimeChart(chart, body.bpm_map || chart.timing.bpm_map, body.audio_offset_ms === undefined ? chart.song.audio_offset_ms || 0 : body.audio_offset_ms, mode);
    } catch (e) {
      throw fail(e.message, 400);
    }
    return { chart: out.chart, messages: out.messages, mode_description: MODE_DESCRIPTIONS[mode] || '' };
  },

  /** JSON 불러오기: 읽은 채보를 검사해서 돌려준다(저장은 하지 않는다) */
  loadChart: async (obj) => {
    if (!obj) throw fail('불러올 채보 내용이 없습니다.');
    try {
      const res = loadChartData(obj);
      return { chart: res.chart, issues: res.issues, converted_from: res.converted_from, conversion_notes: res.conversion_notes };
    } catch (e) {
      if (e instanceof ChartFormatError) throw fail(e.message, 400);
      throw e;
    }
  },

  /**
   * [04d] 내보낼 파일을 만든다(저장은 하지 않는다). {song, chart, what: 'chart'|'audio'|'both', kind: 'edit'|'unity', split}
   * → {files: [{name, blob, mime, label, size}]}. 오류가 있는 채보는 Unity용을 막는다(422).
   */
  prepareExport: async (body) => {
    const what = body.what || 'chart';
    if (!['chart', 'audio', 'both', 'unity'].includes(what)) throw fail('내보낼 것은 채보 JSON, 음원, 채보 JSON + 음원, 유니티 묶음 중에서 골라 주세요.');
    const kind = body.kind === undefined ? 'unity' : body.kind;
    if (what === 'chart' && kind !== 'edit' && kind !== 'unity') throw fail('내보내기 종류는 edit(편집용) 또는 unity(Unity용) 입니다.');
    const { rec } = await needSong(body.song, what !== 'chart');
    let chart = body.chart || rec.chart;
    chart = loadChartData(chart).chart;
    try {
      const files = await buildExportFiles({
        what, kind, split: !!body.split, chart, audioBlob: rec.audioBlob || null, audioFileName: rec.audioMeta && rec.audioMeta.fileName,
      });
      return { files };
    } catch (e) {
      if (e instanceof ExportBlocked) throw fail(e.message, 422, { issues: e.issues.filter((i) => i.level === 'error') });
      if (e && (e.name === 'ZipError' || e.name === 'UnityBundleError')) throw fail(e.message, 400);
      throw e;
    }
  },

  /** [16] 유니티 묶음({folder, files, summary})만 만든다(저장·전송은 하지 않는다). {song, chart} 오류 처리는 prepareExport 와 같다. */
  prepareUnityBundle: async (body) => {
    const { rec } = await needSong(body.song, true);
    const chart = loadChartData(body.chart || rec.chart).chart;
    try {
      return await buildUnityBundle({ chart, audioBlob: rec.audioBlob || null, audioFileName: rec.audioMeta && rec.audioMeta.fileName });
    } catch (e) {
      if (e instanceof ExportBlocked) throw fail(e.message, 422, { issues: e.issues.filter((i) => i.level === 'error') });
      if (e && e.name === 'UnityBundleError') throw fail(e.message, 400);
      throw e;
    }
  },

  /** [04d] 만든 파일 하나를 저장한다(downloads → 저장 창 → <a download>). 결과 {status, method, message, ...} */
  saveExportFile: async (file, name) => deps.saveFile({ name: name || file.name, blob: file.blob }),

  /**
   * 내보내기(확인 창 없이 바로 저장): {song, chart, kind: 'edit'|'unity', split, what?} → {exported: [파일 이름…]}.
   * 화면은 prepareExport + 저장 확인 창 + saveExportFile 을 쓴다. 이 함수는 예전 호출(와 단위 테스트)을 위해 남겼다.
   */
  exportChart: async (body) => {
    const { files } = await api.prepareExport(body);
    for (const f of files) deps.download(f.name, f.mime === 'application/json' ? await f.blob.text() : f.blob, f.mime);
    return { exported: files.map((f) => f.name) };
  },

  /** [04d] 불러오기용 ZIP 을 읽는다 → {chartText, chartName, audio:{name, blob}|null}. ZIP 이 아니면 null */
  readBundle: async (file) => {
    if (!(await looksLikeZip(file))) return null;
    try {
      return await readBundle(file);
    } catch (e) {
      if (e && e.name === 'ZipError') throw fail(e.message, 400);
      throw e;
    }
  },

  /** [04e] 저장된 파형 (없으면 null) */
  wave: async (song) => {
    const { store } = await needSong(song);
    return store.getWave(song);
  },

  /**
   * [04e] 파형이 없는 곡(예전에 저장한 곡)이면 한 번 계산해서 채운다. 이미 있으면 그대로 돌려준다.
   * onProgress(0~1). 계산하지 못하면 null (편집은 막지 않는다).
   */
  ensureWave: async (song, onProgress) => {
    const { store, rec } = await needSong(song, true);
    const have = await store.getWave(song);
    if (have) return have;
    if (!rec.audioBlob) return null;
    try {
      const dec = await deps.decode((await rec.audioBlob.arrayBuffer()).slice(0));
      if (!dec.samples) return null;
      const wave = await deps.computeWave(dec.samples, onProgress);
      await store.saveWave(song, wave);
      return wave;
    } catch (e) {
      console.warn('파형 계산 실패', e);
      return null;
    }
  },

  // ----- 02단계에서 더한 호환 추가 -----

  /** 휴지통의 곡 목록 */
  trashSongs: async () => {
    const store = await getSongStore();
    return { songs: await store.list(true) };
  },
  /** 휴지통의 곡을 영구 삭제(되돌릴 수 없음) */
  purgeSong: async (id) => {
    const store = await getSongStore();
    return { purged: await store.purge(id) };
  },
  /** 저장 기능 상태: 새로고침 뒤에도 남는가 */
  storageInfo: async () => {
    const store = await getSongStore();
    return { persistent: store.persistent };
  },
};
