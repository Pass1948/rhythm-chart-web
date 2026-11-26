// 가로 타임라인(음원 카드): 파형, 소리 시작 지점, 좌/우 노트, 마디선, 재생 위치, 세로 편집기 현재 구간.
// 09: 폭 1024px 이상(PC)에서는 왼쪽·오른쪽 "노트 줄" 안에서만 오른쪽 채보 편집과 같은 방식으로 노트를 편집한다
//     (도구는 S.tool 하나를 같이 쓰고, 데이터 변경은 note_ops.js 의 같은 함수). 눈금자·파형·소리 시작 지점 영역을 누르면 지금처럼 재생 위치 이동.
//     폰·태블릿(폭 1024 미만)은 보기 전용 그대로.
import { COLORS, drawBurst } from './shapes.js';
import { theme } from './theme.js';
import { idsInArea, isLong, noteEnd, snapTick, toggleId } from './edit_rules.js';
import { addTapAt, applyDragPatch, applyGroupMove, createDrag, finishCreateNote, movePatch, resizeEndPatch, resizeStartPatch } from './note_ops.js';
import { LEFT, MIN_LONG_TICKS, hitNote, inLaneArea, laneAtY, layoutFor, BASE_H, marqueeArea, tapRadius, holdHalfHeight, timelineEditEnabled } from './timeline_rules.js';
import { S, commit, durationMs, emit, gridStep, keyMode, notes, select, setSelection, snapshot } from './state.js';
import { FOUR_KEY_LABELS } from './edit_rules.js';

export class Timeline {
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks; // {seek(ms), askBurstCount(기본횟수, 길이ms)}
    this.w = 0;
    this.h = 0;
    this.drag = null;
    this.L = layoutFor(BASE_H);
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!r.width) return;
    this.w = r.width;
    this.h = r.height;
    this.L = layoutFor(r.height, keyMode());
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // 키 모드(노트 줄 수)가 바뀌었으면 세로 배치를 다시 계산한다 (2키 2줄 / 4키 4줄)
  ensureLayout() {
    const lanes = keyMode();
    if (this.L.LANE_Y.length !== lanes) this.L = layoutFor(this.h || BASE_H, lanes);
  }

  xOfMs(ms) {
    return LEFT + ((ms - S.tl.start) / S.tl.span) * (this.w - LEFT - 6);
  }

  msOfX(x) {
    return S.tl.start + ((x - LEFT) / (this.w - LEFT - 6)) * S.tl.span;
  }

  clamp() {
    const dur = durationMs() || 60000;
    S.tl.span = Math.max(4000, Math.min(S.tl.span, 120000));
    S.tl.start = Math.max(0, Math.min(S.tl.start, Math.max(0, dur - S.tl.span)));
  }

  // ---------- 노트 줄 편집 (09) ----------
  xOfTick(tick) {
    return this.xOfMs(S.map.tickToAudioMs(tick));
  }

  tickOfX(x) {
    return S.map.audioMsToTick(this.msOfX(x));
  }

  // 편집을 켤 수 있는 화면인가(PC 폭). 아니면 보기 전용
  editOn() {
    return timelineEditEnabled(window.innerWidth) && !S.paste;
  }

  // 포인터 위치를 격자에 맞춘 tick (Shift 를 누르면 격자 무시)
  pointerTick(e, shift = false) {
    const raw = this.tickOfX(e.offsetX);
    return Math.max(0, shift ? Math.round(raw) : snapTick(raw, gridStep()));
  }

  onDown(e) {
    if (!S.chart || e.button !== 0) return;
    this.ensureLayout();
    const x = e.offsetX;
    const y = e.offsetY;
    // 노트 줄 밖(눈금자·파형·소리 시작 지점·이름 칸)이거나 보기 전용이면 재생 위치 이동
    if (!this.editOn() || x < LEFT || !inLaneArea(y, this.L)) {
      this.hooks.seek(this.msOfX(x));
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    const lane = laneAtY(y, this.L);
    const hit = hitNote(notes(), x, y, (t) => this.xOfTick(t), this.L);
    const before = snapshot();
    if (S.tool === 'select') {
      if (!hit) {
        // 빈 곳: 끌면 사각형 영역으로 여러 노트 선택, 거의 안 끌면 선택 해제
        this.drag = { mode: 'marquee', shift: e.shiftKey, base: e.shiftKey ? [...S.selectedIds] : [], x0: x, x1: x, y0: y, y1: y, moved: false };
        return;
      }
      if (e.shiftKey) {
        setSelection(toggleId(S.selectedIds, hit.note.id)); // Shift+클릭: 선택에 더하거나 뺀다
        return;
      }
      if (S.selectedIds.length > 1 && S.selectedIds.includes(hit.note.id)) {
        // 여러 개 선택된 노트 위를 끌면 한꺼번에 옮긴다
        this.drag = { mode: 'group-move', hitId: hit.note.id, before, changed: false, ids: [...S.selectedIds], base: notes(), grab: this.tickOfX(x), grabLane: lane, axisStart: x };
        return;
      }
      select(hit.note.id);
      const mode = hit.part === 'end' ? 'resize-end' : hit.part === 'start' ? 'resize-start' : 'move';
      this.drag = { mode, id: hit.note.id, before, changed: false, grab: this.tickOfX(x) - hit.note.tick, orig: { ...hit.note }, axisStart: x };
      return;
    }
    const tick = this.pointerTick(e, e.shiftKey);
    if (S.tool === 'tap') {
      addTapAt(lane, tick, before);
      return;
    }
    // 롱노트·연타: 드래그로 구간을 정한다 (연타는 레인 상관없이 양쪽)
    this.drag = createDrag(S.tool, lane, tick, before);
  }

  onMove(e) {
    if (!S.chart) return;
    const d = this.drag;
    if (!d) {
      this.updateCursor(e);
      return;
    }
    const step = e.shiftKey ? 0 : gridStep();
    if (d.mode === 'marquee') {
      d.x1 = e.offsetX;
      d.y1 = e.offsetY;
      if (Math.abs(d.x1 - d.x0) > 4 || Math.abs(d.y1 - d.y0) > 4) d.moved = true;
      return;
    }
    if (d.mode === 'group-move') {
      const delta = Math.abs(e.offsetX - d.axisStart) < 3 ? 0 : Math.round(snapTick(this.tickOfX(e.offsetX) - d.grab, step || 1));
      applyGroupMove(d, delta, laneAtY(e.offsetY, this.L));
      return;
    }
    if (d.mode === 'create') {
      d.end = this.pointerTick(e, e.shiftKey);
      d.changed = true;
      return;
    }
    const note = notes().find((n) => n.id === d.id);
    if (!note) return;
    const ptr = this.tickOfX(e.offsetX);
    let patch = null;
    if (d.mode === 'move') {
      const moveTick = Math.abs(e.offsetX - d.axisStart) < 3 ? d.orig.tick + d.grab : ptr;
      const lane = laneAtY(e.offsetY, this.L);
      patch = movePatch(d.orig, moveTick, d.grab, lane < 0 ? note.lane : lane, step);
    }
    else if (d.mode === 'resize-end') patch = resizeEndPatch(note, ptr, step);
    else if (d.mode === 'resize-start') patch = resizeStartPatch(d.orig, ptr, step);
    if (patch) applyDragPatch(d, patch);
  }

  async onUp(e) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 이미 해제됨 */ }
    if (d.mode === 'marquee') {
      if (!d.moved) {
        if (!d.shift) setSelection([]); // 영역이 아주 작으면 "빈 곳 클릭 = 선택 해제"
        return;
      }
      const pad = this.tickOfX(this.xOfTick(0) + tapRadius(this.L)) - this.tickOfX(this.xOfTick(0));
      const hit = idsInArea(notes(), marqueeArea(d, this.L, (x) => this.tickOfX(x), Math.abs(pad)));
      const ids = d.shift ? [...new Set([...d.base, ...hit])] : hit;
      setSelection(ids);
      return;
    }
    if (d.mode === 'create') {
      await finishCreateNote(d, this.hooks.askBurstCount);
      return;
    }
    if (d.mode === 'group-move' && !d.changed) {
      select(d.hitId); // 끌지 않고 클릭만 했으면 그 노트 1개만 선택
      return;
    }
    if (d.changed) commit(d.before);
  }

  // 마우스 모양: 노트 줄 안에서만 편집 모양. 롱노트·연타의 앞뒤 끝은 좌우 크기 조절 모양
  updateCursor(e) {
    let cursor = 'default';
    if (this.editOn() && e.offsetX >= LEFT && inLaneArea(e.offsetY, this.L)) {
      if (S.tool === 'select') {
        const hit = hitNote(notes(), e.offsetX, e.offsetY, (t) => this.xOfTick(t), this.L);
        cursor = !hit ? 'default' : hit.part === 'body' ? 'grab' : 'ew-resize';
      } else {
        cursor = 'crosshair';
      }
    }
    this.canvas.style.cursor = cursor;
  }

  onWheel(e) {
    e.preventDefault();
    S.tl.start += (e.deltaY > 0 ? 1 : -1) * S.tl.span * 0.15;
    this.clamp();
    emit('view');
  }

  // 재생 위치가 화면 밖으로 나가면 따라간다
  follow(ms) {
    if (ms < S.tl.start || ms > S.tl.start + S.tl.span * 0.9) {
      S.tl.start = ms - S.tl.span * 0.1;
      this.clamp();
    }
  }

  draw(playMs) {
    if (!this.w) return;
    this.ensureLayout();
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = COLORS.bg;
    c.fillRect(0, 0, this.w, this.h);
    c.fillStyle = theme.laneB;
    c.fillRect(0, 0, LEFT - 2, this.h);
    c.fillStyle = theme.textDim;
    c.font = theme.font(10);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('파형', LEFT / 2, this.L.WAVE_TOP + this.L.WAVE_H / 2);
    c.fillText('시작', LEFT / 2, this.L.CAND_Y + 6);
    const lanes = this.L.LANE_Y.length;
    if (lanes === 4) {
      // 4키: 줄 이름 1~4 (S D K L)
      for (let l = 0; l < 4; l++) c.fillText(`${l + 1} ${FOUR_KEY_LABELS[l]}`, LEFT / 2, this.L.LANE_Y[l] + this.L.LANE_H / 2);
    } else {
      c.fillText('왼쪽', LEFT / 2, this.L.LANE_Y[0] + this.L.LANE_H / 2);
      c.fillText('오른쪽', LEFT / 2, this.L.LANE_Y[1] + this.L.LANE_H / 2);
    }
    for (let l = 0; l < lanes; l++) {
      c.fillStyle = l % 2 ? COLORS.laneB : COLORS.laneA;
      c.fillRect(LEFT, this.L.LANE_Y[l], this.w - LEFT, this.L.LANE_H);
    }
    if (lanes === 4) {
      // 레인 구분선
      c.strokeStyle = theme.textDim;
      c.globalAlpha = 0.35;
      c.lineWidth = 1;
      for (let l = 1; l < lanes; l++) {
        const y = this.L.LANE_Y[l] - 0.5;
        c.beginPath();
        c.moveTo(LEFT, y);
        c.lineTo(this.w, y);
        c.stroke();
      }
      c.globalAlpha = 1;
    }
    if (!S.chart) return;
    this.drawBars(c);
    this.drawWave(c);
    this.drawCandidates(c);
    this.drawNotes(c);
    this.drawPreview(c);
    this.drawMarquee(c);
    this.drawViewWindow(c);
    const x = this.xOfMs(playMs);
    if (x >= LEFT && x <= this.w) {
      c.strokeStyle = theme.playhead; // 재생 위치 = 흰색 굵은 선 + 위쪽 작은 삼각형
      c.fillStyle = theme.playhead;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x, this.L.RULER - 2);
      c.lineTo(x, this.h);
      c.stroke();
      c.beginPath();
      c.moveTo(x - 5, this.L.RULER - 8);
      c.lineTo(x + 5, this.L.RULER - 8);
      c.lineTo(x, this.L.RULER - 1);
      c.closePath();
      c.fill();
    }
  }

  drawBars(c) {
    const endTick = Math.ceil(S.map.audioMsToTick(S.tl.start + S.tl.span));
    c.font = theme.font(10);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    for (const b of S.map.barLines(endTick)) {
      const x = this.xOfMs(S.map.tickToAudioMs(b.tick));
      if (x < LEFT || x > this.w) continue;
      c.strokeStyle = theme.gridBar;
      c.lineWidth = 1;
      const bx = Math.round(x) + 0.5;
      c.beginPath();
      c.moveTo(bx, this.L.RULER);
      c.lineTo(bx, this.h);
      c.stroke();
      c.fillStyle = theme.text;
      c.fillText(String(b.bar), x + 3, 10);
    }
  }

  drawWave(c) {
    const mid = this.L.WAVE_TOP + this.L.WAVE_H / 2;
    c.strokeStyle = theme.gridBeat;
    c.beginPath();
    c.moveTo(LEFT, mid);
    c.lineTo(this.w, mid);
    c.stroke();
    const wf = S.waveform;
    if (!wf) {
      c.fillStyle = theme.textDim;
      c.font = theme.font(11);
      c.textAlign = 'center';
      c.fillText('파형은 분석 후에 표시됩니다', (LEFT + this.w) / 2, mid - 4);
      return;
    }
    c.strokeStyle = theme.wave;
    c.lineWidth = 1;
    const n = wf.min.length;
    c.beginPath();
    for (let x = LEFT; x < this.w - 6; x += 1) {
      const a = Math.max(0, Math.floor(this.msOfX(x) / wf.step_ms));
      const b = Math.min(n, Math.max(a + 1, Math.ceil(this.msOfX(x + 1) / wf.step_ms)));
      let lo = 0;
      let hi = 0;
      for (let i = a; i < b; i++) {
        if (wf.min[i] < lo) lo = wf.min[i];
        if (wf.max[i] > hi) hi = wf.max[i];
      }
      c.moveTo(x + 0.5, mid - hi * (this.L.WAVE_H / 2));
      c.lineTo(x + 0.5, mid - lo * (this.L.WAVE_H / 2));
    }
    c.stroke();
  }

  drawCandidates(c) {
    const a = S.analysis;
    if (!a) return;
    c.lineWidth = 1;
    for (const cand of a.candidates) {
      if (cand.time_ms < S.tl.start || cand.time_ms > S.tl.start + S.tl.span) continue;
      const x = this.xOfMs(cand.time_ms);
      c.globalAlpha = 0.35 + 0.65 * cand.strength; // 소리 시작 지점 = 노트와 다른 색의 작은 눈금
      c.strokeStyle = theme.onset;
      c.beginPath();
      c.moveTo(x + 0.5, this.L.CAND_Y);
      c.lineTo(x + 0.5, this.L.CAND_Y + Math.max(8, Math.round(this.L.LANE_H * 0.3)));
      c.stroke();
      c.globalAlpha = 1;
    }
  }

  drawNotes(c) {
    for (const n of notes()) {
      const s = S.map.tickToAudioMs(n.tick);
      const e = isLong(n) ? S.map.tickToAudioMs(noteEnd(n)) : s;
      if (e < S.tl.start || s > S.tl.start + S.tl.span) continue;
      const x0 = this.xOfMs(s);
      const x1 = this.xOfMs(e);
      const sel = S.selectedIds.includes(n.id);
      if (n.type === 'burst') {
        // 연타노트: 모든 줄(2키 두 줄 / 4키 네 줄)에 걸친 하나의 노트
        const top = this.L.LANE_Y[0] + 3;
        const height = this.L.LANE_Y[this.L.LANE_Y.length - 1] + this.L.LANE_H - 3 - top;
        const w = Math.max(3, x1 - x0);
        c.fillStyle = theme.burst;
        c.fillRect(x0, top, w, height);
        c.fillStyle = theme.burstText;
        for (let x = x0 + 2; x < x1 - 2; x += 6) c.fillRect(x, top, 2, 5); // 톱니 느낌
        if (sel) this.selectBox(c, x0, top, w, height);
        continue;
      }
      const cy = this.L.LANE_Y[n.lane] + this.L.LANE_H / 2;
      const rr = tapRadius(this.L); // 단타 반지름, 롱노트 반높이는 줄 높이에 비례
      const hh = holdHalfHeight(this.L);
      if (n.type === 'tap') {
        c.beginPath();
        c.arc(x0, cy, rr, 0, Math.PI * 2);
        c.fillStyle = theme.tap;
        c.fill();
        if (sel) this.selectBox(c, x0 - rr, cy - rr, rr * 2, rr * 2);
      } else {
        c.fillStyle = theme.hold;
        c.fillRect(x0, cy - hh, Math.max(3, x1 - x0), hh * 2);
        if (sel) this.selectBox(c, x0, cy - hh, Math.max(3, x1 - x0), hh * 2);
      }
    }
  }

  // 롱노트·연타를 만드는 중의 반투명 미리보기 (오른쪽 채보 편집과 같은 색)
  drawPreview(c) {
    const d = this.drag;
    if (!d || d.mode !== 'create') return;
    const a = Math.min(d.start, d.end);
    const b = Math.max(d.start, d.end);
    const x0 = this.xOfTick(a);
    const x1 = this.xOfTick(b < a + MIN_LONG_TICKS ? a + MIN_LONG_TICKS : b);
    c.save();
    c.globalAlpha = 0.6;
    if (d.type === 'burst') {
      const top = this.L.LANE_Y[0] + 3;
      const height = this.L.LANE_Y[this.L.LANE_Y.length - 1] + this.L.LANE_H - 3 - top;
      c.fillStyle = theme.burst;
      c.fillRect(x0, top, Math.max(3, x1 - x0), height);
    } else {
      const cy = this.L.LANE_Y[d.lane] + this.L.LANE_H / 2;
      if (d.type === 'tap' || b - a < MIN_LONG_TICKS) {
        c.beginPath();
        c.arc(x0, cy, tapRadius(this.L), 0, Math.PI * 2);
        c.fillStyle = theme.tap;
        c.fill();
      } else {
        const hh = holdHalfHeight(this.L);
        c.fillStyle = theme.hold;
        c.fillRect(x0, cy - hh, Math.max(3, x1 - x0), hh * 2);
      }
    }
    c.restore();
  }

  // 영역 선택 점선 사각형
  drawMarquee(c) {
    const d = this.drag;
    if (!d || d.mode !== 'marquee' || !d.moved) return;
    const x = Math.min(d.x0, d.x1);
    const y = Math.min(d.y0, d.y1);
    const w = Math.abs(d.x1 - d.x0);
    const h = Math.abs(d.y1 - d.y0);
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

  // 선택 표시: 바깥 흰색 2px + 안쪽 어두운 1px
  selectBox(c, x, y, w, h) {
    c.lineWidth = 2;
    c.strokeStyle = theme.selectOuter;
    c.strokeRect(x - 2, y - 2, w + 4, h + 4);
    c.lineWidth = 1;
    c.strokeStyle = theme.selectInner;
    c.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  }

  // 세로 편집기가 지금 보고 있는 구간
  drawViewWindow(c) {
    const x0 = Math.max(LEFT, this.xOfMs(S.view.start));
    const x1 = Math.min(this.w, this.xOfMs(S.view.start + S.view.span));
    if (x1 <= LEFT || x0 >= this.w) return;
    c.fillStyle = theme.viewWindow;
    c.fillRect(x0, 0, x1 - x0, this.h);
    c.strokeStyle = theme.gridBar;
    c.lineWidth = 1;
    c.strokeRect(x0 + 0.5, 0.5, x1 - x0 - 1, this.h - 1);
  }
}
