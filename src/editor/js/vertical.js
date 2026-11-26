// 세로 편집기 (이번 버전의 메인 편집기): 시간이 아래→위로 흐르고 왼쪽·오른쪽 2레인이 나란히 있다.
// 그리기와 마우스 조작만 담당하고, 둘 수 있는지의 판단은 edit_rules.js 에 맡긴다.
import { FOUR_KEY_LABELS, LANE_BOTH, MIN_LONG_TICKS, burstCountForLength, burstLengthForCount, clampBurstCount, fitBurstLength, conflictReason, idsInArea, isLong, noteEnd, snapTick, toggleId, tryAdd, tryMoveGroup, tryUpdate, unionIds, burstRate } from './edit_rules.js';
import { COLORS, drawBurst, drawHold, drawHoldBar, drawTap, drawTapBar } from './shapes.js';
import { barHeight, circleRadius, longHitHalfW, noteDrawWidth, tapHit, tapOutlineHalf, tapPadPx } from './note_shape.js';
import { fillWavePixels, stripWidth, waveColors } from './wave_strip.js';
import { theme } from './theme.js';
import { fmtBpm, moveTempoSection } from './tempo.js';
import { flipClip, tryPaste } from './edit_rules.js';
import { confirmPaste } from './actions.js';
import { addTapAt, applyDragPatch, applyGroupMove, createDrag, finishCreateNote, movePatch, resizeEndPatch, resizeStartPatch } from './note_ops.js';
import { S, commit, durationMs, emit, keyMode, on, gridStep, maxTick, notes, select, setNotes, setSelection, snapshot, status } from './state.js';

const GUTTER = 62; // 왼쪽 시간·마디 번호 영역
const PAD_TOP = 14;
const PAD_BOTTOM = 22;
const HANDLE = 7; // 끝단 손잡이 판정 폭(px)
const RES_BEAT = 960; // 1박 = 960 tick

export class VerticalEditor {
  // hooks: {seek(ms), askBurstCount(defaultCount, lengthMs) -> Promise<number|null>}
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;
    this.drag = null;
    this.hover = null;
    this.w = 0;
    this.h = 0;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerleave', () => { this.pasteHover = null; });
    this.pasteHover = null;   // 붙여넣기 미리보기: 마우스 위치 {x, y, shift} (편집기 밖이면 null)
    this.pasteCache = null;
    this.lastPasteReason = '';
    this.pasteTimer = setInterval(() => this.pasteAutoScroll(), 40);
    this.wv = { canvas: null, key: '', colors: null, colorKey: '' }; // 파형 띠 그림 캐시
    this.tempoHits = []; // 변속 지점 이름표(끌 수 있는 곳) 위치: [{index, x, y, w, h}]
    on('change', () => { this.pasteCache = null; });
    on('paste', () => { this.pasteCache = null; });
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  // 캔버스 크기를 화면 배율에 맞춘다
  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!r.width) return;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------- 좌표 변환 ----------
  yOfMs(ms) {
    return this.h - PAD_BOTTOM - ((ms - S.view.start) / S.view.span) * (this.h - PAD_TOP - PAD_BOTTOM);
  }

  msOfY(y) {
    return S.view.start + ((this.h - PAD_BOTTOM - y) / (this.h - PAD_TOP - PAD_BOTTOM)) * S.view.span;
  }

  yOfTick(tick) {
    return this.yOfMs(S.map.tickToAudioMs(tick));
  }

  tickOfY(y) {
    return S.map.audioMsToTick(this.msOfY(y));
  }

  // 파형 띠 폭 (띠를 끄면 0)
  get stripW() {
    return S.showWave ? stripWidth(this.w) : 0;
  }

  // 레인이 끝나는 x (오른쪽에 파형 띠가 있으면 그 앞)
  get right() {
    return this.w - (this.stripW ? this.stripW + 4 : 0);
  }

  // 레인 수 (2키 2 / 4키 4)
  get lanes() {
    return keyMode();
  }

  get laneW() {
    return (this.right - GUTTER) / this.lanes;
  }

  laneOfX(x) {
    if (x < GUTTER || x > this.right) return -1;
    return Math.min(this.lanes - 1, Math.floor((x - GUTTER) / this.laneW));
  }

  laneCenter(lane) {
    return GUTTER + this.laneW * (lane + 0.5);
  }

  // ---------- 보기 이동 ----------
  clampView() {
    const dur = durationMs() || 60000;
    S.view.span = Math.max(1500, Math.min(S.view.span, 40000));
    S.view.start = Math.max(-1000, Math.min(S.view.start, Math.max(0, dur - S.view.span * 0.5)));
  }

  scrollBy(direction) {
    S.view.start += direction * S.view.span * 0.8;
    this.clampView();
    emit('view');
  }

  // 해당 시각이 화면 안에 보이도록 옮긴다
  ensureVisible(ms) {
    if (ms < S.view.start || ms > S.view.start + S.view.span * 0.95) {
      S.view.start = ms - S.view.span * 0.25;
      this.clampView();
      emit('view');
    }
  }

  onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey) {
      const center = this.msOfY(e.offsetY);
      const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
      const newSpan = Math.max(1500, Math.min(S.view.span * factor, 40000));
      S.view.start = center - ((center - S.view.start) / S.view.span) * newSpan;
      S.view.span = newSpan;
    } else {
      S.view.start += (e.deltaY > 0 ? -1 : 1) * S.view.span * 0.12; // 아래로 굴리면 이전(아래쪽) 구간
    }
    this.clampView();
    emit('view');
  }

  // ---------- 노트 위치 계산 ----------
  noteGeom(n) {
    const cx = n.type === 'burst' ? GUTTER + (this.laneW * this.lanes) / 2 : this.laneCenter(n.lane); // 연타노트는 전체 레인의 한가운데

    const y0 = this.yOfTick(n.tick);
    const y1 = isLong(n) ? this.yOfTick(noteEnd(n)) : y0;
    return { cx, y0, y1 };
  }

  barWidth(n) {
    return noteDrawWidth(n, this.laneW, S.shape, this.lanes); // 연타노트는 전체 레인 폭, 바 모양은 레인 폭의 90%
  }

  // 노트 하나를 모양 설정에 맞게 그린다 (g = noteGeom 결과)
  drawOne(c, n, g, sel) {
    const bar = S.shape === 'bar';
    if (n.type === 'tap') {
      if (bar) drawTapBar(c, g.cx, g.y0, this.barWidth(n), barHeight(S.view.span), sel);
      else drawTap(c, g.cx, g.y0, circleRadius(this.laneW), sel);
    } else if (n.type === 'hold') {
      if (bar) drawHoldBar(c, g.cx, g.y0, g.y1, this.barWidth(n), barHeight(S.view.span), sel);
      else drawHold(c, g.cx, g.y0, g.y1, this.barWidth(n), sel);
    } else {
      drawBurst(c, g.cx, g.y0, g.y1, this.barWidth(n), n.count, sel);
    }
  }

  // 마우스 아래 노트와 부위(body / top=끝, bottom=시작)
  hitTest(x, y) {
    const list = notes();
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      const g = this.noteGeom(n);
      if (n.type !== 'burst' && n.lane !== this.laneOfX(x)) continue;
      if (n.type === 'tap') {
        if (tapHit(S.shape, x - g.cx, y - g.y0, this.laneW, S.view.span)) return { note: n, part: 'body' };
        continue;
      }
      const halfW = longHitHalfW(n, this.laneW, S.shape, this.lanes);
      if (Math.abs(x - g.cx) > halfW) continue;
      const top = Math.min(g.y0, g.y1);
      const bottom = Math.max(g.y0, g.y1);
      if (Math.abs(y - top) <= HANDLE) return { note: n, part: 'top' };
      if (Math.abs(y - bottom) <= HANDLE) return { note: n, part: 'bottom' };
      if (y > top && y < bottom) return { note: n, part: 'body' };
    }
    return null;
  }

  // 포인터 위치를 격자에 맞춘 tick 으로 (Shift 를 누르면 격자 무시)
  pointerTick(e, shift = false) {
    const raw = this.tickOfY(e.offsetY);
    return Math.max(0, shift ? Math.round(raw) : snapTick(raw, gridStep()));
  }

  // ---------- 마우스 조작 ----------
  onDown(e) {
    if (e.button !== 0 || !S.chart) return;
    this.canvas.setPointerCapture(e.pointerId);
    const x = e.offsetX;
    const y = e.offsetY;
    if (!S.paste && e.pointerType !== 'touch') {
      const th = this.tempoHitAt(x, y);
      if (th) {
        // 변속 지점 이름표를 끌면 그 구간의 시작을 박 단위로 옮긴다
        this.drag = { mode: 'tempo', index: th.index, orig: S.map.rows[th.index].tick, tick: S.map.rows[th.index].tick, changed: false };
        return;
      }
    }
    if (S.paste && x >= GUTTER && x <= this.right) {
      // 붙여넣기 미리보기 중: 클릭하면 그 자리에 붙인다 (안 되는 자리면 이유를 알리고 모드는 유지)
      this.pasteHover = { x, y, shift: e.shiftKey };
      confirmPaste(this.pasteTick());
      return;
    }
    if (x < GUTTER || x > this.right) {
      this.hooks.seek(this.msOfY(y)); // 왼쪽 시간 눈금(또는 오른쪽 파형 띠): 재생 위치 이동
      return;
    }
    const lane = this.laneOfX(x);
    const hit = this.hitTest(x, y);
    const before = snapshot();
    if (S.tool === 'select') {
      if (!hit) {
        // 빈 곳: 끌면 사각형 영역으로 여러 노트 선택, 거의 안 끌면 선택 해제
        this.drag = {
          mode: 'marquee', shift: e.shiftKey, base: e.shiftKey ? [...S.selectedIds] : [],
          x0: x, x1: x, ms0: this.msOfY(y), ms1: this.msOfY(y), lastY: y, moved: false,
        };
        this.startAutoScroll();
        return;
      }
      if (e.shiftKey) {
        setSelection(toggleId(S.selectedIds, hit.note.id)); // Shift+클릭: 선택에 더하거나 뺀다
        return;
      }
      if (S.selectedIds.length > 1 && S.selectedIds.includes(hit.note.id)) {
        // 여러 개 선택된 노트 위를 끌면 한꺼번에 위아래로 옮긴다
        this.drag = { mode: 'group-move', hitId: hit.note.id, before, changed: false, ids: [...S.selectedIds], base: JSON.parse(JSON.stringify(notes())), grab: this.tickOfY(y) };
        return;
      }
      select(hit.note.id);
      const mode = hit.part === 'top' ? 'resize-top' : hit.part === 'bottom' ? 'resize-bottom' : 'move';
      this.drag = {
        mode, id: hit.note.id, before, changed: false,
        grab: this.tickOfY(y) - hit.note.tick, orig: { ...hit.note },
      };
      return;
    }
    if (lane < 0) return;
    const tick = this.pointerTick(e, e.shiftKey);
    if (S.tool === 'tap') {
      addTapAt(lane, tick, before); // 음원 카드 타임라인과 같은 함수 (note_ops.js)
      return;
    }
    // 롱노트·연타: 드래그로 구간을 정한다 (연타는 레인 상관없이 양쪽)
    this.drag = createDrag(S.tool, lane, tick, before);
  }

  onMove(e) {
    if (!S.chart) return;
    if (S.paste) {
      this.pasteHover = e.offsetX >= GUTTER && e.offsetX <= this.right ? { x: e.offsetX, y: e.offsetY, shift: e.shiftKey } : null;
      this.canvas.style.cursor = 'copy';
      return;
    }
    if (!this.drag) {
      this.updateCursor(e);
      return;
    }
    const d = this.drag;
    const x = e.offsetX;
    const step = e.shiftKey ? 0 : gridStep();
    if (d.mode === 'tempo') {
      d.tick = Math.max(RES_BEAT, Math.round(this.tickOfY(e.offsetY) / RES_BEAT) * RES_BEAT);
      d.changed = d.tick !== d.orig;
      return;
    }
    if (d.mode === 'marquee') {
      d.x1 = x;
      d.lastY = e.offsetY;
      d.ms1 = this.msOfY(e.offsetY);
      if (Math.abs(x - d.x0) > 4 || Math.abs(this.yOfMs(d.ms1) - this.yOfMs(d.ms0)) > 4) d.moved = true;
      return;
    }
    if (d.mode === 'group-move') {
      const delta = Math.round(snapTick(this.tickOfY(e.offsetY) - d.grab, gridStep() || 1));
      applyGroupMove(d, delta);
      return;
    }
    if (d.mode === 'create') {
      d.end = this.pointerTick(e, e.shiftKey);
      d.changed = true;
      return;
    }
    const note = notes().find((n) => n.id === d.id);
    if (!note) return;
    const ptr = this.tickOfY(e.offsetY);
    let patch = null;
    if (d.mode === 'move') patch = movePatch(note, ptr, d.grab, this.laneOfX(x), step); // 연타노트는 세로로만 이동
    else if (d.mode === 'resize-top') patch = resizeEndPatch(note, ptr, step);
    else if (d.mode === 'resize-bottom') patch = resizeStartPatch(d.orig, ptr, step);
    if (patch) applyDragPatch(d, patch); // 음원 카드 타임라인과 같은 함수 (note_ops.js)
  }

  async onUp(e) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 이미 해제됨 */ }
    if (d.mode === 'tempo') {
      if (d.changed) await moveTempoSection(d.index, d.tick);
      return;
    }
    if (d.mode === 'marquee') {
      this.stopAutoScroll();
      this.finishMarquee(d);
      return;
    }
    if (d.mode === 'create') {
      await this.finishCreate(d);
      return;
    }
    if (d.mode === 'group-move' && !d.changed) {
      select(d.hitId); // 끌지 않고 클릭만 했으면 그 노트 1개만 선택
      return;
    }
    if (d.changed) commit(d.before);
    if (d.mode === 'group-move' && d.changed) status(`노트 ${d.ids.length}개를 함께 옮겼습니다.`);
  }

  // ---------- 붙여넣기 미리보기 ----------

  // 마우스 위치를 격자에 맞춘 기준점 tick (Shift 를 누르면 격자 무시)
  pasteTick() {
    const h = this.pasteHover;
    const raw = this.tickOfY(h.y);
    return Math.max(0, h.shift ? Math.round(raw) : snapTick(raw, gridStep()));
  }

  // 미리보기 중 편집기 위·아래 끝에 마우스가 닿으면 자동 스크롤한다
  pasteAutoScroll() {
    const h = this.pasteHover;
    if (!S.paste || !h) return;
    const edge = 24;
    let dir = 0;
    if (h.y < PAD_TOP + edge) dir = 1;
    else if (h.y > this.h - PAD_BOTTOM - edge) dir = -1;
    if (!dir) return;
    S.view.start += dir * S.view.span * 0.03;
    this.clampView();
    emit('view');
  }

  // 붙일 수 있는지 계산 (같은 위치·같은 설정이면 다시 계산하지 않는다)
  pasteResult(tick) {
    const key = `${tick}|${S.paste.flip}`;
    if (!this.pasteCache || this.pasteCache.key !== key) {
      const r = tryPaste(notes(), S.clip, tick, maxTick(), S.paste.flip);
      this.pasteCache = { key, r };
      if (!r.ok && r.reason !== this.lastPasteReason) status(r.reason);
      this.lastPasteReason = r.ok ? '' : r.reason;
    }
    return this.pasteCache.r;
  }

  // 반투명 미리보기: 붙일 수 있으면 파랑, 없으면 붉은색 + 이유
  drawPaste(c) {
    if (!S.paste || !S.clip || !this.pasteHover) return;
    const tick = this.pasteTick();
    const r = this.pasteResult(tick);
    const items = (S.paste.flip ? flipClip(S.clip) : S.clip).items;
    const ok = r.ok;
    c.save();
    for (const it of items) {
      const n = { ...it, tick: tick + it.rel };
      const g = this.noteGeom(n);
      c.globalAlpha = 0.55;
      this.drawOne(c, n, g, false);
      c.globalAlpha = 0.9;
      c.strokeStyle = ok ? theme.pasteOk : theme.pasteBad; // 가능 = 초록 점선, 불가 = 빨강 점선
      c.lineWidth = 1.5;
      c.setLineDash([5, 4]);
      const tapBox = tapOutlineHalf(S.shape, this.laneW, S.view.span);
      const half = n.type === 'tap' ? tapBox.hw : this.barWidth(n) / 2 + 3;
      const top = Math.min(g.y0, g.y1) - (n.type === 'tap' ? tapBox.hh : 3);
      const bottom = Math.max(g.y0, g.y1) + (n.type === 'tap' ? tapBox.hh : 3);
      c.strokeRect(g.cx - half + 0.5, top + 0.5, half * 2, bottom - top);
      c.setLineDash([]);
    }
    c.restore();
    if (!ok) {
      const h = this.pasteHover;
      c.font = theme.font(12, true);
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      const text = r.reason.length > 34 ? r.reason.slice(0, 34) + '…' : r.reason;
      const tw = c.measureText(text).width + 12;
      const x = Math.min(h.x + 14, this.w - tw - 4);
      c.fillStyle = theme.pasteBad;
      c.fillRect(x, h.y - 24, tw, 20);
      c.fillStyle = theme.selectInner;
      c.fillText(text, x + 6, h.y - 14);
    }
  }

  // ---------- 드래그 영역(사각형) 선택 ----------

  // 영역 끝에서 마우스가 위·아래 가장자리에 닿으면 구간을 자동으로 스크롤한다 (영역은 곡 위치(ms)로 기억하므로 스크롤돼도 정확하다)
  startAutoScroll() {
    this.stopAutoScroll();
    this.scrollTimer = setInterval(() => {
      const d = this.drag;
      if (!d || d.mode !== 'marquee') return;
      const edge = 24;
      let dir = 0;
      if (d.lastY < PAD_TOP + edge) dir = 1;
      else if (d.lastY > this.h - PAD_BOTTOM - edge) dir = -1;
      if (!dir) return;
      S.view.start += dir * S.view.span * 0.03;
      this.clampView();
      d.ms1 = this.msOfY(d.lastY);
      emit('view');
    }, 40);
  }

  stopAutoScroll() {
    clearInterval(this.scrollTimer);
    this.scrollTimer = 0;
  }

  // 사각형 영역 → tick 범위와 걸친 레인
  marqueeArea(d) {
    const xa = Math.min(d.x0, d.x1);
    const xb = Math.max(d.x0, d.x1);
    const lanes = [];
    for (let l = 0; l < this.lanes; l++) {
      const left = GUTTER + this.laneW * l;
      if (xb >= left && xa <= left + this.laneW) lanes.push(l);
    }
    const ta = S.map.audioMsToTick(Math.min(d.ms0, d.ms1));
    const tb = S.map.audioMsToTick(Math.max(d.ms0, d.ms1));
    const padTick = Math.abs(S.map.audioMsToTick(this.msOfY(this.h / 2 - tapPadPx(S.shape, S.view.span))) - S.map.audioMsToTick(this.msOfY(this.h / 2))); // 단타 모양(동그라미 반지름 / 바 반쪽 높이)만큼
    return { t0: ta, t1: tb, lanes, pad: padTick };
  }

  finishMarquee(d) {
    if (!d.moved) {
      if (!d.shift) setSelection([]); // 영역이 아주 작으면 기존처럼 "빈 곳 클릭 = 선택 해제"
      return;
    }
    const hit = idsInArea(notes(), this.marqueeArea(d));
    const ids = d.shift ? unionIds(d.base, hit) : hit;
    setSelection(ids);
    if (ids.length > 1) status(`노트 ${ids.length}개를 선택했습니다.`);
    else if (!ids.length) status('영역 안에 노트가 없습니다.');
  }

  // 롱노트·연타노트 만들기 마무리 (음원 카드 타임라인과 같은 함수: note_ops.js)
  async finishCreate(d) {
    await finishCreateNote(d, this.hooks.askBurstCount);
  }

  // 마우스 모양: 끝단은 크기 조절 모양
  updateCursor(e) {
    let cursor = S.tool === 'select' ? 'default' : 'crosshair';
    if (this.tempoHitAt(e.offsetX, e.offsetY)) {
      this.canvas.style.cursor = 'ns-resize';
      return;
    }
    if (e.offsetX < GUTTER) cursor = 'pointer';
    else if (S.tool === 'select') {
      const hit = this.hitTest(e.offsetX, e.offsetY);
      if (hit) cursor = hit.part === 'body' ? 'grab' : 'ns-resize';
      this.hover = hit ? hit.note.id : null;
    }
    this.canvas.style.cursor = cursor;
  }

  // ---------- 그리기 ----------
  draw(playMs) {
    if (!this.w) return;
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = COLORS.bg;
    c.fillRect(0, 0, this.w, this.h);
    const lw = this.laneW;
    const lanes = this.lanes;
    for (let l = 0; l < lanes; l++) {
      c.fillStyle = l % 2 ? COLORS.laneB : COLORS.laneA;
      c.fillRect(GUTTER + l * lw, PAD_TOP, lw - 1, this.h - PAD_TOP - PAD_BOTTOM);
    }
    if (lanes === 4) {
      // 4키: 레인 구분선 (가운데 선은 조금 더 진하게)
      for (let l = 1; l < lanes; l++) {
        c.strokeStyle = theme.textDim;
        c.globalAlpha = l === 2 ? 0.55 : 0.3;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(GUTTER + l * lw - 0.5, PAD_TOP);
        c.lineTo(GUTTER + l * lw - 0.5, this.h - PAD_BOTTOM);
        c.stroke();
      }
      c.globalAlpha = 1;
    }
    c.fillStyle = theme.text;
    c.font = theme.font(11);
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    // 글자 뒤에 반투명 어두운 알약을 깔아 연타 막대 위에서도 읽히게 한다 (글자 위치는 그대로)
    const laneLabels = lanes === 4 ? FOUR_KEY_LABELS.map((k, i) => [`${i + 1}레인 ${k}`, GUTTER + lw * (i + 0.5)]) : [['왼쪽', GUTTER + lw / 2], ['오른쪽', GUTTER + lw * 1.5]];
    for (const [label, cx] of laneLabels) {
      const tw = c.measureText(label).width + 12;
      c.fillStyle = theme.lanePill;
      c.beginPath();
      c.roundRect(cx - tw / 2, 0, tw, 16, 8);
      c.fill();
      c.fillStyle = theme.textStrong || theme.text;
      c.fillText(label, cx, 11);
    }
    if (!S.chart) {
      c.fillStyle = theme.textDim;
      c.fillText('곡을 열면 여기에 노트가 나타납니다', this.w / 2, this.h / 2);
      return;
    }
    this.drawWave(c);
    this.drawGrid(c);
    this.drawTempo(c);
    this.drawNotes(c);
    this.drawPreview(c);
    this.drawMarquee(c);
    this.drawPaste(c);
    const y = this.yOfMs(playMs);
    if (y >= PAD_TOP && y <= this.h - PAD_BOTTOM) {
      c.strokeStyle = theme.playhead; // 재생 위치 = 흰색 굵은 선 + 왼쪽 작은 삼각형
      c.fillStyle = theme.playhead;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(GUTTER - 2, y);
      c.lineTo(this.w, y);
      c.stroke();
      c.beginPath();
      c.moveTo(GUTTER - 12, y - 5);
      c.lineTo(GUTTER - 3, y);
      c.lineTo(GUTTER - 12, y + 5);
      c.closePath();
      c.fill();
    }
  }

  // ---------- 파형 띠 (오른쪽 끝) ----------
  // 가운데 세로선 기준 좌우 대칭. 폭 = 그 시각의 소리 크기(제곱근 보정), 색 = 저음(주황)·중음(초록)·고음(하늘) 비율.
  drawWave(c) {
    const sw = this.stripW;
    if (!sw) return;
    const x0 = this.w - sw;
    const top = PAD_TOP;
    const innerH = this.h - PAD_TOP - PAD_BOTTOM;
    const wave = S.wave;
    // 바탕
    c.fillStyle = theme.wvBg || theme.bg;
    c.fillRect(x0, top, sw, innerH);
    if (wave) {
      const rows = Math.max(1, Math.round(innerH));
      const colorKey = `${theme.wvBg}|${theme.wvLow}|${theme.wvMid}|${theme.wvHigh}`;
      const f = this.wv;
      if (!f.colors || f.colorKey !== colorKey) {
        f.colors = waveColors(theme.wvLow, theme.wvMid, theme.wvHigh, theme.wvBg);
        f.colorKey = colorKey;
        f.key = '';
      }
      const key = `${wave.frames}|${S.view.start.toFixed(2)}|${S.view.span}|${rows}|${this.h}|${sw}|${colorKey}`;
      if (!f.canvas) f.canvas = document.createElement('canvas');
      if (f.key !== key) {
        f.canvas.width = Math.round(sw);
        f.canvas.height = rows;
        const fc = f.canvas.getContext('2d');
        const img = fc.createImageData(f.canvas.width, rows);
        // r 번째 줄 위쪽 가장자리의 y = PAD_TOP + r * innerH / rows → 편집기와 같은 msOfY 로 시간을 구한다
        fillWavePixels(img.data, wave, f.canvas.width, rows, (r) => this.msOfY(top + (r * innerH) / rows), f.colors);
        fc.putImageData(img, 0, 0);
        f.key = key;
      }
      c.imageSmoothingEnabled = true;
      c.drawImage(f.canvas, 0, 0, f.canvas.width, rows, x0, top, sw, innerH);
    } else {
      c.fillStyle = theme.textDim;
      c.font = theme.font(10);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(S.waveBusy ? '계산 중…' : '정보 없음', x0 + sw / 2, top + innerH / 2);
    }
    // 가운데 세로선
    c.fillStyle = theme.wvCenter || theme.textDim;
    c.fillRect(Math.round(x0 + sw / 2), top, 1, innerH);
    // 선택한 노트의 시각: 가로선
    if (S.selectedIds.length && S.selectedIds.length <= 64) {
      c.strokeStyle = theme.wvSel || theme.playhead;
      c.lineWidth = 1.5;
      for (const n of notes()) {
        if (!S.selectedIds.includes(n.id)) continue;
        const y = this.yOfTick(n.tick);
        if (y < top || y > top + innerH) continue;
        c.beginPath();
        c.moveTo(x0, Math.round(y) + 0.5);
        c.lineTo(this.w, Math.round(y) + 0.5);
        c.stroke();
      }
    }
  }

  // 격자선, 마디선과 번호, 왼쪽 시간 눈금
  drawGrid(c) {
    const startTick = Math.max(0, Math.floor(S.map.audioMsToTick(S.view.start)));
    const endTick = Math.ceil(S.map.audioMsToTick(S.view.start + S.view.span));
    const step = gridStep();
    const bars = S.map.barLines(endTick);
    const barSet = new Map(bars.map((b) => [b.tick, b.bar]));
    c.lineWidth = 1;
    if (step > 0) {
      const first = Math.ceil(startTick / step);
      for (let i = first, count = 0; i * step <= endTick && count < 1500; i++, count++) {
        const t = i * step;
        const y = this.yOfTick(t);
        const isBar = barSet.has(t);
        const isBeat = t % 960 === 0;
        if (isBar) continue;
        c.strokeStyle = isBeat ? theme.gridBeat : theme.gridFine;
        const yy = Math.round(y) + 0.5; // 반 픽셀 보정: 선이 흐려지지 않게
        c.beginPath();
        c.moveTo(GUTTER, yy);
        c.lineTo(this.right, yy);
        c.stroke();
      }
    }
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.font = theme.font(11, true);
    for (const b of bars) {
      if (b.tick < startTick - 3840 || b.tick > endTick) continue;
      const y = this.yOfTick(b.tick);
      if (y < PAD_TOP - 2 || y > this.h - PAD_BOTTOM + 2) continue;
      c.strokeStyle = theme.gridBar;
      c.lineWidth = 1;
      const by = Math.round(y) + 0.5;
      c.beginPath();
      c.moveTo(GUTTER - 6, by);
      c.lineTo(this.right, by);
      c.stroke();
      c.fillStyle = theme.text;
      c.fillText(`${b.bar}마디`, 6, y - 8);
      c.fillStyle = theme.textDim;
      c.font = theme.font(10);
      c.fillText(formatTime(S.map.tickToAudioMs(b.tick)), 6, y + 6);
      c.font = theme.font(11, true);
    }
  }

  // ---------- 변속 지점 ----------
  // 이름표(끌 수 있는 곳) 위치에 마우스가 있으면 그 구간 번호. 첫 구간(곡 처음)은 끌 수 없다.
  tempoHitAt(x, y) {
    for (const h of this.tempoHits) {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }

  // 변속 지점마다 가로 점선과 'BPM 123.4' 이름표. 자동 찾기 후보는 다른 색 점선. 끄는 중이면 옮겨질 위치를 미리 보여 준다.
  drawTempo(c) {
    this.tempoHits = [];
    const rows = S.map.rows;
    const dragging = this.drag && this.drag.mode === 'tempo' ? this.drag : null;
    const line = (y, color, label, draggableIndex, alpha = 1) => {
      if (y < PAD_TOP - 1 || y > this.h - PAD_BOTTOM + 1) return;
      const yy = Math.round(y) + 0.5;
      c.save();
      c.globalAlpha = alpha;
      c.strokeStyle = color;
      c.lineWidth = 1.5;
      c.setLineDash([7, 4]);
      c.beginPath();
      c.moveTo(GUTTER - 6, yy);
      c.lineTo(this.right, yy);
      c.stroke();
      c.setLineDash([]);
      c.font = theme.font(11, true);
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      const tw = c.measureText(label).width + 12;
      const bx = GUTTER + 4;
      const by = Math.max(PAD_TOP, Math.min(this.h - PAD_BOTTOM - 16, yy - 17));
      c.fillStyle = theme.lanePill;
      c.beginPath();
      c.roundRect(bx, by, tw, 16, 8);
      c.fill();
      c.strokeStyle = color;
      c.lineWidth = 1;
      c.stroke();
      c.fillStyle = color;
      c.fillText(label, bx + 6, by + 8.5);
      c.restore();
      if (draggableIndex !== null) this.tempoHits.push({ index: draggableIndex, x: bx, y: by, w: tw, h: 16 });
    };
    for (let i = 1; i < rows.length; i++) {
      if (dragging && dragging.index === i) continue; // 끄는 중에는 원래 자리의 점선을 흐리게
      const r = rows[i];
      const meter = r.bpb !== 4 || r.unit !== 4 ? ' ' + r.bpb + '/' + r.unit : '';
      line(this.yOfTick(r.tick), theme.tempo, 'BPM ' + fmtBpm(r.bpm) + meter, canDragTempo() ? i : null);
    }
    if (dragging) {
      const r = rows[dragging.index];
      line(this.yOfTick(dragging.orig), theme.tempo, 'BPM ' + fmtBpm(r.bpm), null, 0.35);
      line(this.yOfTick(dragging.tick), theme.tempo, S.map.barBeat(dragging.tick) + ' · BPM ' + fmtBpm(r.bpm), dragging.index);
    }
    if (S.tempoFound) {
      for (const cand of S.tempoFound.result.candidates) {
        if (!S.tempoFound.checked.has(cand.section)) continue;
        line(this.yOfMs(cand.timeMs), theme.tempoCand, '후보 BPM ' + fmtBpm(cand.bpm), null);
      }
    }
  }

  drawNotes(c) {
    const lo = S.view.start - 200;
    const hi = S.view.start + S.view.span + 200;
    for (const n of notes()) {
      const startMs = S.map.tickToAudioMs(n.tick);
      const endMs = isLong(n) ? S.map.tickToAudioMs(noteEnd(n)) : startMs;
      if (endMs < lo || startMs > hi) continue;
      const g = this.noteGeom(n);
      this.drawOne(c, n, g, S.selectedIds.includes(n.id));
    }
  }

  // 드래그 영역(점선 사각형)
  drawMarquee(c) {
    const d = this.drag;
    if (!d || d.mode !== 'marquee' || !d.moved) return;
    const x = Math.min(d.x0, d.x1);
    const y = Math.min(this.yOfMs(d.ms0), this.yOfMs(d.ms1));
    const w = Math.abs(d.x1 - d.x0);
    const h = Math.abs(this.yOfMs(d.ms0) - this.yOfMs(d.ms1));
    c.globalAlpha = 0.1;
    c.fillStyle = theme.marquee;
    c.fillRect(x, y, w, h);
    c.globalAlpha = 1;
    c.setLineDash([5, 4]);
    c.strokeStyle = theme.marquee;
    c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, w, h);
    c.setLineDash([]);
  }

  // 롱노트·연타를 만드는 중의 미리보기
  drawPreview(c) {
    const d = this.drag;
    if (!d || d.mode !== 'create') return;
    const a = Math.min(d.start, d.end);
    const b = Math.max(d.start, d.end);
    c.globalAlpha = 0.6;
    if (d.type === 'burst') {
      const w = this.laneW * this.lanes - 16;
      const mid = GUTTER + (this.laneW * this.lanes) / 2;
      if (b - a < MIN_LONG_TICKS) drawBurst(c, mid, this.yOfTick(a), this.yOfTick(a + 960), w, '?', false);
      else drawBurst(c, mid, this.yOfTick(a), this.yOfTick(b), w, '?', false);
    } else {
      const cx = this.laneCenter(d.lane);
      const short = b - a < MIN_LONG_TICKS;
      this.drawOne(c, short ? { type: 'tap', lane: d.lane } : { type: 'hold', lane: d.lane }, { cx, y0: this.yOfTick(a), y1: short ? this.yOfTick(a) : this.yOfTick(b) }, false);
    }
    c.globalAlpha = 1;
  }
}

// 이름표를 끌 수 있는 환경인가: 마우스(포인터가 정밀한 기기)가 있을 때만. 폰은 끌기 없이 [변속 구간] 카드의 숫자 입력을 쓴다.
function canDragTempo() {
  try {
    return window.matchMedia('(pointer: fine)').matches;
  } catch (err) {
    return true;
  }
}

// 0:00.0 형식 시간
export function formatTime(ms) {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export { burstRate };
