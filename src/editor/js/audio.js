// 오디오: 재생/일시정지/탐색/볼륨, 재생 위치(오디오 시계 기준), 히트사운드(종류 구분 없이 1종), 메트로놈(박자 소리), 소리 시작 지점 소리.
import { CLICK_SOUND } from './metronome.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.gain = null;
    this.source = null;
    this.playing = false;
    this.startCtx = 0; // 재생을 시작한 오디오 시계 시각(초)
    this.startPos = 0; // 재생을 시작한 곡 위치(ms)
    this.pausedPos = 0;
    this.rate = 1;     // 재생 속도 (1 = 원래 속도). 곡 위치(ms)는 항상 원래 곡 시간 기준
    this.volume = 0.8;
    this.hitEnabled = true;
    this.hitSet = new Set(); // 이미 예약한 히트사운드 노트 id
    this.metroEnabled = false;
    this.metroVolume = 0.6;
    this.onsetEnabled = false;
    this.metroKeys = new Set();  // 이미 예약한 박자 소리 (시각 키)
    this.onsetKeys = new Set();
    this.futureNodes = [];       // 예약했지만 아직 안 난 소리들 (일시정지·탐색·박자 변경 때 취소한다)
    this.scheduledLog = [];      // 확인용: 예약한 박자 소리의 음원 시각(ms) 기록 (최근 200개)
  }

  // 사용자 조작 안에서 호출해야 브라우저가 소리를 허용한다
  ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx.resume();
  }

  // 음원 파일을 내려받아 해독한다 (재생용 원본 그대로)
  async load(url, onProgress) {
    this.stop();
    let bytes = null;
    // 이 PC 에서는 큰 파일 전송이 가끔 끊겨(AdGuard 의심) 최대 3번까지 다시 받는다
    for (let attempt = 1; attempt <= 3 && !bytes; attempt++) {
      try {
        bytes = await this.download(url, onProgress);
      } catch (e) {
        if (attempt === 3) throw new Error('음원을 불러오지 못했습니다. 연결이 끊겼습니다. 다시 시도해 주세요.');
      }
    }
    this.ensureContextSilent();
    this.buffer = await this.ctx.decodeAudioData(bytes.buffer);
    this.pausedPos = 0;
    return this.buffer.duration * 1000;
  }

  // 음원 파일 내려받기 (진행률 표시)
  async download(url, onProgress) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('음원을 불러오지 못했습니다.');
    const total = Number(res.headers.get('Content-Length')) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (onProgress && total) onProgress(got / total);
    }
    if (total && got !== total) throw new Error('다운로드가 중간에 끊겼습니다.');
    const bytes = new Uint8Array(got);
    let pos = 0;
    for (const c of chunks) {
      bytes.set(c, pos);
      pos += c.length;
    }
    return bytes;
  }

  // 사용자 조작 없이도 해독만 하기 위한 준비 (소리는 재생 때 resume)
  ensureContextSilent() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
  }

  get durationMs() {
    return this.buffer ? this.buffer.duration * 1000 : 0;
  }

  // 현재 재생 위치(ms): 오디오 시계 기준
  get position() {
    if (!this.buffer) return 0;
    if (!this.playing) return this.pausedPos;
    const pos = this.startPos + (this.ctx.currentTime - this.startCtx) * 1000 * this.rate;
    return Math.min(pos, this.durationMs);
  }

  async play(fromMs) {
    if (!this.buffer) return;
    await this.ensureContext();
    this.stopSource();
    const pos = Math.max(0, Math.min(fromMs === undefined ? this.pausedPos : fromMs, this.durationMs - 1));
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    src.connect(this.gain);
    const when = this.ctx.currentTime + 0.03;
    src.start(when, pos / 1000);
    this.source = src;
    this.startCtx = when;
    this.startPos = pos;
    this.playing = true;
    this.hitSet.clear();
    this.cancelScheduled();
    src.onended = () => {
      if (this.source === src && this.playing && this.position >= this.durationMs - 50) {
        this.playing = false;
        this.pausedPos = this.durationMs;
      }
    };
  }

  // 재생 속도를 바꾼다. 재생 중이면 지금 곡 위치를 기준점으로 다시 잡아 위치가 튀지 않게 하고, 예약해 둔 소리는 취소한다.
  setRate(r) {
    if (this.playing) {
      const pos = this.position;
      this.startPos = pos;
      this.startCtx = this.ctx.currentTime;
      if (this.source) this.source.playbackRate.value = r;
      this.cancelScheduled();
    }
    this.rate = r;
  }

  pause() {
    this.cancelScheduled();
    if (!this.playing) return;
    this.pausedPos = this.position;
    this.stopSource();
    this.playing = false;
  }

  stopSource() {
    if (this.source) {
      try { this.source.onended = null; this.source.stop(); } catch (e) { /* 이미 멈춤 */ }
      this.source.disconnect();
      this.source = null;
    }
  }

  stop() {
    this.cancelScheduled();
    this.stopSource();
    this.playing = false;
    this.pausedPos = 0;
  }

  async toggle() {
    if (this.playing) this.pause();
    else await this.play(this.pausedPos >= this.durationMs - 50 ? 0 : this.pausedPos);
  }

  // 재생 위치 이동 (재생 중이면 그 자리에서 이어서 재생)
  async seek(ms) {
    const pos = Math.max(0, Math.min(ms, this.durationMs));
    if (this.playing) await this.play(pos);
    else this.pausedPos = pos;
  }

  setVolume(v) {
    this.volume = v;
    if (this.gain) this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015);
  }

  // 지금부터 lookahead(ms) 안에 있는 노트 시각에 짧은 소리를 예약한다. times: [{id, ms}] (재생 위치 순)
  scheduleHits(times, lookaheadMs = 120) {
    if (!this.playing || !this.hitEnabled) return;
    const pos = this.position;
    for (const t of times) {
      if (t.ms < pos) continue;
      if (t.ms > pos + lookaheadMs) break;
      if (this.hitSet.has(t.id)) continue;
      this.hitSet.add(t.id);
      this.click(this.startCtx + (t.ms - this.startPos) / 1000 / this.rate);
    }
  }

  // 예약해 둔 박자·시작 지점 소리를 모두 취소하고 다시 예약할 수 있게 비운다 (일시정지·탐색·BPM/시작점 변경 때)
  cancelScheduled() {
    const now = this.ctx ? this.ctx.currentTime : 0;
    for (const n of this.futureNodes) {
      if (n.when > now) {
        try { n.osc.stop(now); } catch (e) { /* 이미 끝남 */ }
      }
    }
    this.futureNodes = [];
    this.metroKeys.clear();
    this.onsetKeys.clear();
  }

  // 지금부터 lookaheadMs 안의 박자 소리를 예약한다. getBeats(fromMs, toMs) → [{ms, level}] (히트사운드와 같은 시간 기준)
  scheduleMetronome(getBeats, lookaheadMs = 160) {
    if (!this.playing || !this.metroEnabled) return;
    const pos = this.position;
    for (const b of getBeats(pos, pos + lookaheadMs)) {
      const key = Math.round(b.ms * 20);
      if (this.metroKeys.has(key)) continue;
      this.metroKeys.add(key);
      const when = this.startCtx + (b.ms - this.startPos) / 1000 / this.rate;
      if (when < this.ctx.currentTime - 0.005) continue;
      const s = CLICK_SOUND[b.level] || CLICK_SOUND.beat;
      this.tone(when, 'triangle', s.freq, 0.5 * s.gain * this.metroVolume, 0.05);
      this.scheduledLog.push(b.ms);
      if (this.scheduledLog.length > 200) this.scheduledLog.shift();
    }
  }

  // 분석으로 찾은 소리 시작 지점 소리 (가까운 구간만 예약). times: [ms] 오름차순
  scheduleOnsets(times, lookaheadMs = 160) {
    if (!this.playing || !this.onsetEnabled) return;
    const pos = this.position;
    for (const ms of times) {
      if (ms < pos) continue;
      if (ms > pos + lookaheadMs) break;
      const key = Math.round(ms * 20);
      if (this.onsetKeys.has(key)) continue;
      this.onsetKeys.add(key);
      this.tone(this.startCtx + (ms - this.startPos) / 1000 / this.rate, 'sine', 2600, 0.22 * this.metroVolume / 0.6, 0.025);
    }
  }

  // 짧은 소리 하나를 예약한다
  tone(when, type, freq, peak, length) {
    if (when < this.ctx.currentTime - 0.005) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + length);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(when);
    osc.stop(when + length + 0.02);
    this.futureNodes.push({ osc, when });
    if (this.futureNodes.length > 64) this.futureNodes = this.futureNodes.filter((n) => n.when > this.ctx.currentTime - 0.1);
  }

  // 히트사운드 1종: 짧은 '틱' 소리
  click(when) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1500;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.25, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(when);
    osc.stop(when + 0.05);
  }
}
