// 새 플레이 화면 "10-C": 720×1280 Canvas 2D 렌더러. 규칙(점수·판정·콤보·피버·부정수치)은 만들지 않고, 컨트롤러가 넘겨 주는 상태를 그리기만 한다.
// 그림 코드는 참고 HTML(reference\playscreen_10C.html)의 drawLane / drawGauges / drawJudgeCircles / drawNotes / drawMonster / drawProj /
// drawHitFx / drawCharacter / drawHUD / drawCombo / drawPillars 를 실제 플레이 상태에 맞게 옮긴 것이다. 데모의 랜덤 채보·자동 판정은 쓰지 않는다.
import type { Grade } from '../play/core/config/gameConfig';
import type { ChartNote } from '../play/core/chart/types';
import type { GameBurstAnchors, GameEffects, GameRenderer, GameStatus } from '../play/gameRenderer';
import { NOTE_STATE, fillNoteSpan, type NoteSpan, type VisibleNotes } from '../play/noteLayout';
import barShape from './barShape.json' with { type: 'json' };
import { V10C, V10C_VIEW } from './config10c';
import { loadImages10c, type Images10c } from './images10c';
import {
  drainStep, edgeL, edgeR, gaugeLines, hpRatio, judgeCenter, judgeRadius, judgeYLane, laneX, monsterRect, notePose, titleScrollOffset, widthAt,
  type NotePose,
} from './geometry10c';

const W = V10C_VIEW.width;
const H = V10C_VIEW.height;
const { pink: PINK, mint: MINT, cream: CREAM } = V10C.colors;

/** 렌더러를 만들 때 필요한 값 */
export interface Renderer10cInit {
  /** 2D 그림용 canvas (WebGL 에 쓴 canvas 와 다른 것) */
  canvas: HTMLCanvasElement;
  notes: readonly ChartNote[];
  keyMode: 2 | 4;
  /** 화면 맨 위 곡명 칸에 흐르는 글자 (업로드한 파일 이름) */
  songName: string;
  /** 재생 중인 채보의 난이도 이름 (곡명 글자 색) */
  difficulty: string;
  /** 판정원 아래 키 글자 (레인 순서). null 이면 표시하지 않는다(터치 기기) */
  keyLabels: readonly string[] | null;
  /** 내부 그림 배율 (화면에 보이는 크기에 맞춘 값, 1~2) */
  pixelScale: number;
}

interface Ring { x: number; y: number; t: number; grade: Grade | 'small'; r: number }
interface HitFx { x: number; y: number; t: number; big: boolean; size: number; rot: number }
interface Proj { sx: number; sy: number; hx: number; hy: number; side: -1 | 1; t: number; dur: number; big: boolean; done: boolean }
interface Float { text: string; lane: number; x: number; y: number; t: number; grade: Grade }
interface Pillar { lane: number; t: number }

const GRADE_TEXT: Record<Grade, string> = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', bad: 'BAD', miss: 'MISS' };

function font(size: number, weight = 800): string {
  return `${weight} ${size}px "Noto Sans KR","Malgun Gothic",system-ui,sans-serif`;
}

export class Renderer10C implements GameRenderer {
  /** 컨트롤러가 보이는 노트를 모을 때 쓰는 값: 놓친 노트가 판정선 아래로 떨어지다 사라지는 진행도 */
  readonly shape = { bottomProgress: V10C.note.missFallTo };
  readonly burstAnchors: GameBurstAnchors = { count: 0, noteIndex: new Int32Array(0), x: new Float32Array(0), y: new Float32Array(0) };
  readonly effects: GameEffects;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly notes: readonly ChartNote[];
  private readonly lanes: number;
  private readonly songName: string;
  private readonly difficulty: string;
  private readonly keyLabels: readonly string[] | null;
  private readonly pixelScale: number;
  private readonly images: Images10c;
  /** 노트마다 같은 시각에 다른 레인 노트와 짝이면 그 짝의 번호 (없으면 −1) */
  private readonly pair: Int32Array;

  private status: GameStatus = { score: 0, combo: 0, feverGaugePercent: 0, negativePercent: 0, progress: 0, burstRemaining: () => 0 };
  private readonly laneDown: boolean[] = [false, false, false, false];
  private readonly holdOn: boolean[] = [false, false, false, false];
  private rings: Ring[] = [];
  private hitFxs: HitFx[] = [];
  private projs: Proj[] = [];
  private floats: Float[] = [];
  private pillars: Pillar[] = [];
  private hitStop = 0;
  private shakeT = 0;
  private monShake = 0;
  private monFlash = 0;
  private monKick = 0;
  private monKickDir = 0;
  private hpShown = 1;
  private hpPrev = 1;
  private hpChangedAt = 0;
  private overkill = 0;
  private lastScore = 0;
  private lastHit = { side: 1 as -1 | 1, t: 99 };
  private swing = { any: false, t: 99, dir: 1 as -1 | 1, tx: W / 2, ty: 1050 };
  private readonly pose: NotePose = { x: 0, y: 0, scale: 1, alpha: 1 };
  private readonly pose2: NotePose = { x: 0, y: 0, scale: 1, alpha: 1 };
  private readonly span: NoteSpan = { head: 0, tail: 0 };
  private lastNowMs = 0;
  private titleWidth = 0;
  private totalNotes: number;

  constructor(init: Renderer10cInit) {
    const ctx = init.canvas.getContext('2d');
    if (ctx === null) throw new Error('2D 그림을 쓸 수 없어요.');
    this.ctx = ctx;
    this.notes = init.notes;
    this.totalNotes = init.notes.length;
    this.lanes = init.keyMode;
    this.songName = init.songName;
    this.difficulty = init.difficulty.toUpperCase();
    this.keyLabels = init.keyLabels;
    this.pixelScale = Math.max(1, Math.min(2, init.pixelScale));
    init.canvas.width = Math.round(W * this.pixelScale);
    init.canvas.height = Math.round(H * this.pixelScale);
    this.images = loadImages10c();
    this.pair = this.findPairs();
    this.effects = {
      hit: () => undefined, // 판정 연출은 judged() 가 한 번에 한다 (롱노트 끝의 GOOD 은 연출 없음)
      holdTick: (lane) => this.addRing(lane, 'small'),
      holdStart: (lane) => {
        this.holdOn[lane] = true;
      },
      holdEnd: (lane) => {
        this.holdOn[lane] = false;
      },
      burstPress: () => this.rings.push({ x: W / 2, y: V10C.rail.judgeY - 40, t: 0, grade: 'small', r: judgeRadius(this.lanes) * 1.1 }),
      burstSuccess: () => this.burstSuccess(),
      clear: () => this.clearEffects(),
    };
  }

  // ---------- 컨트롤러가 부르는 것 ----------

  setStatus(status: GameStatus): void {
    this.status = status;
  }

  setLaneDown(lane: number, down: boolean): void {
    this.laneDown[lane] = down;
  }

  setFeverGlow(): void {
    // 피버 발광은 좌측 게이지 선의 색으로 보인다 (별도 레일 발광은 없음)
  }

  /** 새 판(처음부터 다시) 준비: 연출을 모두 비우고 체력·점수 표시를 처음으로 */
  clear(): void {
    this.clearEffects();
    this.hpShown = 1;
    this.hpPrev = 1;
    this.overkill = 0;
    this.lastScore = 0;
    this.swing.any = false;
    this.swing.t = 99;
    this.lastHit.t = 99;
    this.laneDown.fill(false);
    this.holdOn.fill(false);
  }

  dispose(): void {
    this.clearEffects();
  }

  /** 판정 하나(단타·롱노트 머리·연타 결과): 판정 글자, 링, 타격 이펙트, 빛기둥, 캐릭터 타격, 투사체, 히트스톱·흔들림 */
  judged(lane: number, grade: Grade, _nowMs: number): void {
    const n = this.lanes;
    const c = judgeCenter(Math.max(0, Math.min(n - 1, lane)), n);
    const radius = judgeRadius(n);
    const feel = V10C.feel;
    // 레인당 글자 1개만: 같은 레인의 이전 글자를 지운다
    if (V10C.bottom.judgeText.onePerLane) this.floats = this.floats.filter((f) => f.lane !== lane);
    this.floats.push({ text: GRADE_TEXT[grade], lane, x: laneX(lane, V10C.rail.judgeY, n), y: c.y - 92, t: 0, grade });
    this.rings.push({ x: c.x, y: c.y, t: 0, grade, r: radius });
    if (grade === 'miss') return;
    const big = grade === 'perfect';
    const mul = grade === 'perfect' ? 3.0 : grade === 'great' ? 2.3 : 1.7;
    this.hitFxs.push({ x: c.x, y: c.y, t: 0, big, size: radius * mul, rot: ((lane * 37) % 10) / 12 - 0.4 });
    this.swing.any = true;
    this.swing.t = 0;
    this.swing.dir = lane < n / 2 ? -1 : 1;
    this.swing.tx = c.x;
    this.swing.ty = c.y;
    const side: -1 | 1 = lane < n / 2 ? -1 : 1;
    this.lastHit.side = side;
    this.lastHit.t = 0;
    if (feel.hitStopOn && (grade === 'perfect' || grade === 'great')) this.hitStop = Math.max(this.hitStop, feel.hitStopMs / 1000);
    if (grade === 'perfect' && feel.shakePx > 0) this.shakeT = feel.shakeMs / 1000;
    if (feel.pillarOpacityPercent > 0) this.pillars.push({ lane, t: 0 });
    if (grade === 'perfect' || grade === 'great') this.shoot(c.x, c.y, side, grade === 'perfect');
  }

  // ---------- 연출 도우미 ----------

  private clearEffects(): void {
    this.rings = [];
    this.hitFxs = [];
    this.projs = [];
    this.floats = [];
    this.pillars = [];
    this.hitStop = 0;
    this.shakeT = 0;
    this.holdOn.fill(false);
  }

  private addRing(lane: number, kind: 'small'): void {
    const c = judgeCenter(Math.max(0, Math.min(this.lanes - 1, lane)), this.lanes);
    this.rings.push({ x: c.x, y: c.y, t: 0, grade: kind, r: judgeRadius(this.lanes) * 0.9 });
  }

  /** 연타 성공: 모든 레인에 빛기둥, 가운데 큰 링과 타격 이펙트, 양쪽 투사체, GREAT 글자 */
  private burstSuccess(): void {
    const n = this.lanes;
    for (let lane = 0; lane < n; lane += 1) this.pillars.push({ lane, t: 0 });
    const y = V10C.rail.judgeY;
    this.rings.push({ x: W / 2, y, t: 0, grade: 'perfect', r: judgeRadius(n) * 1.6 });
    this.hitFxs.push({ x: W / 2, y, t: 0, big: true, size: judgeRadius(n) * 3.4, rot: 0.2 });
    this.floats = this.floats.filter((f) => f.lane !== -1);
    this.floats.push({ text: GRADE_TEXT.great, lane: -1, x: W / 2, y: y - 92, t: 0, grade: 'great' });
    this.shoot(W / 2 - 40, y, -1, true);
    this.shoot(W / 2 + 40, y, 1, true);
    if (V10C.feel.hitStopOn) this.hitStop = Math.max(this.hitStop, V10C.feel.hitStopMs / 1000);
    this.swing.any = true;
    this.swing.t = 0;
    this.swing.dir = 1;
    this.swing.tx = W / 2;
    this.swing.ty = y;
    this.lastHit.t = 0;
  }

  /** 몬스터의 맞는 자리 (왼쪽 레인 쪽 / 오른쪽 레인 쪽) */
  private hitPoint(side: -1 | 1): { x: number; y: number } {
    const m = monsterRect(this.images.monsterAspect());
    return { x: V10C.rail.cx + side * m.bh * 0.22, y: m.bottom - m.bh * 0.5 };
  }

  private shoot(sx: number, sy: number, side: -1 | 1, big: boolean): void {
    const p = this.hitPoint(side);
    this.projs.push({ sx, sy, hx: p.x, hy: p.y, side, t: 0, dur: (big ? V10C.top.projectileFlightMs : (V10C.top.projectileFlightMs * 267) / 227) / 1000, big, done: false });
    if (this.projs.length > 24) this.projs.shift();
  }

  /** 같은 시각(30ms 이내)에 다른 레인에서 함께 나오는 노트끼리 짝을 맺는다 (동시 노트 연결선·색) */
  private findPairs(): Int32Array {
    const pair = new Int32Array(this.notes.length).fill(-1);
    for (let i = 0; i < this.notes.length - 1; i += 1) {
      const a = this.notes[i]!;
      const b = this.notes[i + 1]!;
      if (pair[i]! < 0 && pair[i + 1]! < 0 && a.type !== 'burst' && b.type !== 'burst' && Math.abs(b.timeMs - a.timeMs) <= 30 && a.lane !== b.lane) {
        pair[i] = i + 1;
        pair[i + 1] = i;
      }
    }
    return pair;
  }

  // ---------- 한 프레임 ----------

  render(songMs: number, visualOffsetMs: number, fallTimeMs: number, visible: VisibleNotes, states: Uint8Array, nowMs: number, dtMs: number): void {
    const ctx = this.ctx;
    const dt = Math.min(0.05, Math.max(0, dtMs) / 1000);
    this.lastNowMs = nowMs;
    // 히트스톱: 노트·판정은 그대로 흐르고, 캐릭터·이펙트·몬스터 연출만 멈춘다
    let vdt = dt;
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      vdt = 0;
    }
    let sx = 0;
    let sy = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const m = (V10C.feel.shakePx * Math.max(0, this.shakeT)) / (V10C.feel.shakeMs / 1000);
      sx = Math.sin(nowMs * 0.9) * m;
      sy = Math.cos(nowMs * 1.3) * m;
    }
    this.lastHit.t += dt;
    // 몬스터 체력 = 남은 노트 수 ÷ 전체 노트 수 (끝난 노트 = 화면에서 치워졌거나 놓쳐서 회색이 된 노트)
    let resolved = 0;
    for (let i = 0; i < this.notes.length; i += 1) {
      const s = states[i];
      if (s === NOTE_STATE.done || s === NOTE_STATE.broken) resolved += 1;
    }
    const hp = hpRatio(this.totalNotes, resolved);
    if (hp < this.hpPrev - 1e-6) this.hpChangedAt = nowMs;
    this.hpPrev = hp;
    const drain = V10C.top.hpDrain;
    if (!drain.on) this.hpShown = hp;
    else if (nowMs - this.hpChangedAt > drain.waitMs) this.hpShown = drainStep(this.hpShown, hp, vdt, drain.speedPercentPerSec / 100);
    else this.hpShown = Math.max(hp, this.hpShown);
    // OVERKILL: 체력이 0 이 된 뒤에 규칙이 올린 점수의 절반 (데모와 같은 식, 점수는 규칙의 값)
    const gained = Math.max(0, this.status.score - this.lastScore);
    if (hp <= 0 && gained > 0) this.overkill += gained * 0.5;
    this.lastScore = this.status.score;

    ctx.setTransform(this.pixelScale, 0, 0, this.pixelScale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(sx, sy);
    this.drawBg();
    this.drawLane();
    this.drawPillars(vdt);
    this.drawGauges();
    this.drawJudgeCircles();
    this.drawRings(vdt);
    this.drawMonster(vdt, hp);
    this.drawNotes(visible, states, songMs, visualOffsetMs, fallTimeMs);
    this.drawProj(dt);
    this.drawCharacter(vdt);
    this.drawHitFx(vdt);
    ctx.restore();
    this.drawHud();
    this.drawCombo();
    this.drawFloats(dt);
  }

  // ---------- 배경·레일 ----------

  private drawBg(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0e0a10');
    g.addColorStop(0.5, '#1c121d');
    g.addColorStop(1, '#0a070b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = '#ff6fb0';
    ctx.lineWidth = 2;
    for (let x = -H; x < W; x += 46) {
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + H * 0.5, 0);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = '#ff4d97';
    ctx.lineWidth = 3;
    for (let r = 90; r < 520; r += 70) {
      ctx.beginPath();
      ctx.arc(640, 420, r, 0, 7);
      ctx.stroke();
    }
    ctx.restore();
  }

  private alphaGradient(rgb: string): CanvasGradient {
    const R = V10C.rail;
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, R.farY, 0, R.bottomY);
    const span = R.bottomY - R.farY;
    const bp = (R.baseY - R.farY) / span;
    const ep = Math.min(1, (R.baseY + R.soft - R.farY) / span);
    g.addColorStop(0, `rgba(${rgb},0)`);
    g.addColorStop(bp, `rgba(${rgb},${R.fadeA})`);
    if (R.soft > 0) g.addColorStop(ep, `rgba(${rgb},1)`);
    else g.addColorStop(Math.min(1, bp + 0.0008), `rgba(${rgb},1)`);
    g.addColorStop(1, `rgba(${rgb},1)`);
    return g;
  }

  private drawLane(): void {
    const R = V10C.rail;
    const ctx = this.ctx;
    const y0 = R.farY;
    const y1 = H;
    const n = this.lanes;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(edgeL(y0), y0);
    ctx.lineTo(edgeR(y0), y0);
    ctx.lineTo(edgeR(y1), y1);
    ctx.lineTo(edgeL(y1), y1);
    ctx.closePath();
    ctx.fillStyle = this.alphaGradient('15,12,18');
    ctx.fill();
    const span = y1 - y0;
    for (let i = 0; i <= n; i += 1) {
      const edge = i === 0 || i === n;
      if (!edge && !R.dividers) continue;
      const xa = edgeL(y0) + (i / n) * widthAt(y0);
      const xb = edgeL(y1) + (i / n) * widthAt(y1);
      const sg = ctx.createLinearGradient(0, y0, 0, y1);
      const c = edge ? '170,160,180' : '120,110,130';
      sg.addColorStop(0, `rgba(${c},0)`);
      sg.addColorStop((R.baseY - y0) / span, `rgba(${c},${R.fadeA})`);
      sg.addColorStop(Math.min(1, (R.baseY + Math.max(R.soft, 4) - y0) / span), `rgba(${c},.9)`);
      sg.addColorStop(1, `rgba(${c},.9)`);
      ctx.strokeStyle = sg;
      ctx.lineWidth = edge ? 3 : 2.5;
      ctx.beginPath();
      ctx.moveTo(xa, y0);
      ctx.lineTo(xb, y1);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPillars(dt: number): void {
    const n = this.lanes;
    const ctx = this.ctx;
    const feel = V10C.feel;
    const life = feel.pillarLifeMs / 1000;
    for (let i = this.pillars.length - 1; i >= 0; i -= 1) {
      const o = this.pillars[i]!;
      o.t += dt;
      if (o.t > life) {
        this.pillars.splice(i, 1);
        continue;
      }
      const k = o.t / life;
      const yb = judgeYLane(o.lane, n) + judgeRadius(n) * 0.6;
      const yt = yb - feel.pillarHeight * (0.75 + 0.25 * Math.min(1, k * 3));
      const left = (y: number): number => edgeL(y) + (o.lane / n) * widthAt(y);
      const right = (y: number): number => edgeL(y) + ((o.lane + 1) / n) * widthAt(y);
      const col = o.lane < n / 2 ? '77,232,189' : '255,46,147';
      const a = (feel.pillarOpacityPercent / 100) * (1 - k);
      const g = ctx.createLinearGradient(0, yb, 0, yt);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.25, `rgba(${col},${a * 0.8})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(left(yt), yt);
      ctx.lineTo(right(yt), yt);
      ctx.lineTo(right(yb), yb);
      ctx.lineTo(left(yb), yb);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private drawGauges(): void {
    const ctx = this.ctx;
    const g = V10C.gauge;
    const lines = gaugeLines(this.status.feverGaugePercent, this.status.negativePercent);
    const gx = (side: -1 | 1, y: number): number => (side < 0 ? edgeL(y) - g.offset : edgeR(y) + g.offset);
    const ln = (side: -1 | 1, ya: number, yb: number, style: string, w: number, glow: number, glowColor: string): void => {
      ctx.save();
      ctx.strokeStyle = style;
      ctx.lineWidth = w;
      ctx.lineCap = 'butt';
      if (glow > 0) {
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = glow;
      }
      ctx.beginPath();
      ctx.moveTo(gx(side, ya), ya);
      ctx.lineTo(gx(side, yb), yb);
      ctx.stroke();
      ctx.restore();
    };
    const base = 'rgba(255,255,255,.3)';
    ln(-1, lines.top, lines.bottom, base, g.thickness, 0, '');
    ln(1, lines.top, lines.bottom, base, g.thickness, 0, '');
    ln(-1, lines.fever.y0, lines.fever.y1, PINK, g.thickness + 2, 14, PINK); // 왼쪽 피버: 아래에서 위로
    ln(1, lines.safe.y0, lines.safe.y1, MINT, g.thickness + 2, 12, 'rgba(77,232,189,.7)'); // 오른쪽 부정수치: 남은 부분
    if (lines.eroded !== null) ln(1, lines.eroded.y0, lines.eroded.y1, '#3b0a14', g.thickness + 3, 16, '#c0142e'); // 침식: 위에서 내려옴
  }

  private drawJudgeCircles(): void {
    const ctx = this.ctx;
    const n = this.lanes;
    const r = judgeRadius(n);
    const jc = V10C.judgeCircle;
    for (let i = 0; i < n; i += 1) {
      const { x, y } = judgeCenter(i, n);
      const col = i < n / 2 ? MINT : PINK;
      ctx.save();
      ctx.fillStyle = 'rgba(20,16,22,.9)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 7);
      ctx.fill();
      ctx.lineWidth = jc.lineWidth;
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 7);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#f3e6dc';
      ctx.beginPath();
      ctx.arc(x, y, r * jc.innerRatio, 0, 7);
      ctx.stroke();
      ctx.restore();
      if (this.laneDown[i] || this.holdOn[i]) {
        ctx.save();
        ctx.globalAlpha = this.holdOn[i] ? 0.5 + 0.2 * Math.sin(this.lastNowMs / 45) : 0.5;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
        ctx.restore();
      }
      const label = this.keyLabels?.[i];
      if (label !== undefined) {
        ctx.save();
        ctx.font = font(22);
        ctx.fillStyle = 'rgba(255,246,238,.75)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y + r + jc.labelOffset);
        ctx.restore();
      }
    }
  }

  private drawRings(dt: number): void {
    const ctx = this.ctx;
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const o = this.rings[i]!;
      o.t += dt;
      const d = 0.35;
      if (o.t > d) {
        this.rings.splice(i, 1);
        continue;
      }
      const k = o.t / d;
      const color = o.grade === 'miss' ? '#9a8aa0' : o.grade === 'perfect' ? '#ffffff' : o.grade === 'great' ? MINT : o.grade === 'small' ? '#d8ccf0' : CREAM;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = (o.grade === 'small' ? 4 : 7) * (1 - k) + 1;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r * (1 + k * 0.9), 0, 7);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------- 노트 ----------

  private drawNotes(visible: VisibleNotes, states: Uint8Array, songMs: number, visualOffsetMs: number, fallTimeMs: number): void {
    const ctx = this.ctx;
    const n = this.lanes;
    const aspect = this.images.monsterAspect();
    const r0 = judgeRadius(n);
    const simple = V10C.note.simultaneous;
    const poses = new Map<number, NotePose>();
    const missFall = V10C.note.missFallTo;
    // 1) 연타(전체 폭 줄무늬 막대)와 롱노트 몸통
    for (let k = 0; k < visible.count; k += 1) {
      const idx = visible.indices[k]!;
      const note = this.notes[idx]!;
      const state = states[idx]!;
      if (state === NOTE_STATE.done) continue;
      fillNoteSpan(this.span, note, songMs, visualOffsetMs, fallTimeMs);
      if (note.type === 'burst') {
        this.drawBurstBar(idx, note, state);
        continue;
      }
      if (note.type !== 'hold') continue;
      const attached = state === NOTE_STATE.holding;
      const broken = state === NOTE_STATE.broken;
      const top = Math.max(this.span.tail, 0);
      let bottom = attached ? Math.min(this.span.head, 1) : this.span.head;
      bottom = Math.min(bottom, missFall);
      if (!(bottom > 0) || top >= bottom) continue;
      const lane = note.lane as number;
      const colored = simple.differentColor && this.pair[idx]! >= 0;
      const col = broken ? '#6a2a4c' : colored ? simple.color : PINK;
      const N = 16;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      let prevPose: NotePose | null = null;
      let prevX = 0;
      let prevY = 0;
      let prevS = 0;
      for (let q = 0; q <= N; q += 1) {
        const pp = top + ((bottom - top) * q) / N;
        notePose(lane, pp, n, aspect, this.pose);
        if (prevPose !== null) {
          const w = r0 * 0.95 * ((prevS + this.pose.scale) / 2);
          ctx.globalAlpha = (broken ? 0.4 : 0.55) * this.pose.alpha;
          ctx.strokeStyle = col;
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(this.pose.x, this.pose.y);
          ctx.stroke();
          ctx.globalAlpha = (broken ? 0.4 : 0.9) * this.pose.alpha;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = Math.max(1.5, w * 0.12);
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(this.pose.x, this.pose.y);
          ctx.stroke();
        }
        prevPose = this.pose;
        prevX = this.pose.x;
        prevY = this.pose.y;
        prevS = this.pose.scale;
      }
      // 꼬리 끝 동그라미, 누르는 동안 판정원에 빛
      notePose(lane, top, n, aspect, this.pose2);
      ctx.globalAlpha = broken ? 0.5 : 1;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(this.pose2.x, this.pose2.y, r0 * this.pose2.scale * 0.5, 0, 7);
      ctx.fill();
      ctx.restore();
    }
    // 2) 단타 위치 계산 + 동시 노트 연결선
    for (let k = 0; k < visible.count; k += 1) {
      const idx = visible.indices[k]!;
      const note = this.notes[idx]!;
      const state = states[idx]!;
      if (note.type === 'burst') continue;
      if (note.type === 'tap' && state === NOTE_STATE.done) continue;
      if (note.type === 'hold' && state !== NOTE_STATE.waiting) continue; // 롱노트 머리는 아직 안 친 것만 단타처럼 그린다
      fillNoteSpan(this.span, note, songMs, visualOffsetMs, fallTimeMs);
      const p = this.span.head;
      if (p < 0 || p > missFall) continue;
      const pose: NotePose = { x: 0, y: 0, scale: 1, alpha: 1 };
      notePose(note.lane as number, p, n, aspect, pose);
      poses.set(idx, pose);
    }
    if (simple.line) {
      for (const [i, A] of poses) {
        const j = this.pair[i]!;
        if (j <= i) continue;
        const B = poses.get(j);
        if (B === undefined) continue;
        ctx.save();
        ctx.globalAlpha = Math.min(A.alpha, B.alpha) * 0.9;
        ctx.lineCap = 'round';
        ctx.strokeStyle = simple.differentColor ? simple.color : '#ffd1e6';
        ctx.lineWidth = simple.width * Math.min(A.scale, B.scale, 1);
        ctx.shadowColor = simple.differentColor ? simple.color : PINK;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.stroke();
        ctx.restore();
      }
    }
    // 3) 단타 원
    for (const [i, P] of poses) {
      const colored = simple.differentColor && this.pair[i]! >= 0;
      const r = r0 * P.scale * V10C.note.radiusRatio;
      ctx.save();
      ctx.globalAlpha = P.alpha;
      ctx.shadowColor = colored ? simple.color : 'rgba(255,46,147,.6)';
      ctx.shadowBlur = 14 * P.scale;
      ctx.fillStyle = colored ? simple.color : PINK;
      ctx.beginPath();
      ctx.arc(P.x, P.y, r, 0, 7);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(P.x, P.y, r * 0.34, 0, 7);
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * 연타 막대: 레일 전체 폭(2·4레인 모두)을 덮는 굵은 줄무늬 막대. 데모에 연타가 없어 새로 정한 모양이다.
   * 어두운 바탕 + 크림색 사선 줄무늬(노트 시간에 붙어 내려옴) + 밝은 테두리, 가운데에 남은 횟수 "×n".
   * 누르는 동안(구간 안)은 막대 아래 끝이 판정선에 붙어 줄어든다.
   */
  private drawBurstBar(idx: number, note: ChartNote, state: number): void {
    const ctx = this.ctx;
    const n = this.lanes;
    const ref = n === 4 ? 1 : 0; // 높이 식에 쓸 레인(바깥 레인의 판정원 높이 차이는 쓰지 않는다)
    let head = this.span.head;
    const tail = this.span.tail;
    if (state === NOTE_STATE.waiting || state === NOTE_STATE.holding) head = Math.min(head, 1);
    const top = Math.max(tail, 0);
    if (!(head > 0) || top >= head) return;
    const y0 = noteYForBurst(ref, top, n);
    const y1 = noteYForBurst(ref, head, n);
    const inset = 8;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(edgeL(y0) + inset * 0.4, y0);
    ctx.lineTo(edgeR(y0) - inset * 0.4, y0);
    ctx.lineTo(edgeR(y1) - inset, y1);
    ctx.lineTo(edgeL(y1) + inset, y1);
    ctx.closePath();
    ctx.fillStyle = '#241a28';
    ctx.fill();
    ctx.clip();
    // 사선 줄무늬: 시간(진행도)에 붙어 내려온다
    ctx.strokeStyle = CREAM;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 16;
    const shift = (head * 900) % 56;
    for (let y = y0 - 80 - shift; y < y1 + 80; y += 56) {
      ctx.beginPath();
      ctx.moveTo(0, y + 120);
      ctx.lineTo(W, y - 120);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = state === NOTE_STATE.broken ? '#9a8aa0' : '#fff6ee';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(edgeL(y0) + inset * 0.4, y0);
    ctx.lineTo(edgeR(y0) - inset * 0.4, y0);
    ctx.lineTo(edgeR(y1) - inset, y1);
    ctx.lineTo(edgeL(y1) + inset, y1);
    ctx.closePath();
    ctx.stroke();
    // 남은 횟수
    const remain = this.status.burstRemaining(idx);
    const ym = (y0 + y1) / 2;
    ctx.font = font(Math.max(26, Math.min(64, (y1 - y0) * 0.6)));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(14,9,15,.95)';
    ctx.strokeText(`×${remain}`, W / 2, ym);
    ctx.fillStyle = CREAM;
    ctx.fillText(`×${remain}`, W / 2, ym);
    ctx.restore();
    void note;
  }

  // ---------- 몬스터·체력바 ----------

  private drawMonster(dt: number, hp: number): void {
    const ctx = this.ctx;
    const imgs = this.images;
    const m = monsterRect(imgs.monsterAspect());
    const bw = m.bw;
    const bh = m.bh;
    this.monShake = Math.max(0, this.monShake - dt * 5);
    this.monFlash = Math.max(0, this.monFlash - dt * 5);
    this.monKick = Math.max(0, this.monKick - dt * 6);
    const kb = V10C.top.knockbackPx;
    const sx = (Math.sin(this.lastNowMs * 0.8) * 5 * this.monShake) + (kb > 0 ? this.monKickDir * kb * Math.sin(Math.min(1, this.monKick) * Math.PI * 0.5) * this.monKick : 0);
    const cx = V10C.rail.cx;
    const mon = imgs.monster();
    if (mon !== null) {
      ctx.drawImage(mon, cx + sx - bw / 2, m.bottom - bh, bw, bh);
      const white = imgs.monsterWhite();
      if (this.monFlash > 0 && white !== null) {
        ctx.save();
        ctx.globalAlpha = this.monFlash * 0.4;
        ctx.drawImage(white, cx + sx - bw / 2, m.bottom - bh, bw, bh);
        ctx.restore();
      }
    }
    // 체력바: 바탕 + (줄어든 만큼 노랑) + 초록(체력) + 끝 선 + 틀
    const bar = barShape;
    const bs = (bw * 1.14 * V10C.top.barScalePercent) / 100 / bar.w;
    const bwp = bar.w * bs;
    const bhp = bar.h * bs;
    const bx = cx - bwp / 2;
    const by = m.bottom - bhp * 0.56 + V10C.top.barOffsetY;
    const frame = imgs.barFrame();
    const back = imgs.barBack();
    const green = imgs.barGreen();
    const yellow = imgs.barYellow();
    if (frame !== null && back !== null && green !== null && yellow !== null) {
      const xa = bar.xa;
      const span = bar.xb + 1 - xa;
      ctx.drawImage(back, bx, by, bwp, bhp);
      const part = (img: CanvasImageSource, f0: number, f1: number): void => {
        if (f1 <= f0) return;
        const c0 = xa + span * f0;
        const c1 = xa + span * f1;
        ctx.save();
        ctx.beginPath();
        ctx.rect(bx + c0 * bs, by, (c1 - c0) * bs, bhp);
        ctx.clip();
        ctx.drawImage(img, bx, by, bwp, bhp);
        ctx.restore();
      };
      if (V10C.top.hpDrain.on && this.hpShown > hp) part(yellow, hp, this.hpShown);
      part(green, 0, hp);
      if (hp > 0 && hp < 1) {
        const ex = Math.round(xa + span * hp);
        const ei = Math.min(bar.w - 1, ex);
        const yt = bar.yt[ei]!;
        const yb = bar.yb[ei]!;
        if (yt >= 0) {
          ctx.save();
          ctx.strokeStyle = 'rgba(236,248,220,.95)';
          ctx.lineWidth = Math.max(1, 1.4 * bs);
          ctx.beginPath();
          ctx.moveTo(bx + ex * bs, by + yt * bs);
          ctx.lineTo(bx + ex * bs, by + (yb + 1) * bs);
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.drawImage(frame, bx, by, bwp, bhp);
      if (hp <= 0 && this.overkill > 0) {
        ctx.save();
        ctx.font = font(22);
        ctx.textAlign = 'center';
        ctx.fillStyle = CREAM;
        ctx.shadowColor = 'rgba(0,0,0,.9)';
        ctx.shadowBlur = 6;
        ctx.fillText(`OVERKILL +${Math.round(this.overkill).toLocaleString('en-US')}`, cx, by + bhp + 22);
        ctx.restore();
      }
    }
  }

  private drawProj(dt: number): void {
    const ctx = this.ctx;
    const quad = (a: number, b: number, c: number, t: number): number => {
      const u = 1 - t;
      return u * u * a + 2 * u * t * b + t * t * c;
    };
    for (let i = this.projs.length - 1; i >= 0; i -= 1) {
      const o = this.projs[i]!;
      o.t += dt;
      const k = Math.min(1, o.t / o.dur);
      const cxp = o.side < 0 ? edgeL(o.sy) - 110 : edgeR(o.sy) + 110; // 궤적이 레인 밖으로 나가도록 제어점을 바깥쪽으로
      const cyp = (o.sy + o.hy) / 2 + 40;
      const n = o.big ? 12 : 8;
      ctx.save();
      ctx.lineCap = 'round';
      for (let s = 0; s < n; s += 1) {
        const a = Math.max(0, k - s * 0.045);
        const b = Math.max(0, k - (s + 1) * 0.045);
        ctx.globalAlpha = (1 - s / n) * (o.big ? 1 : 0.7);
        ctx.strokeStyle = o.big ? '#ffd1e6' : '#a8f5de';
        ctx.lineWidth = (o.big ? 15 : 8) * (1 - s / n) + 1;
        ctx.beginPath();
        ctx.moveTo(quad(o.sx, cxp, o.hx, a), quad(o.sy, cyp, o.hy, a));
        ctx.lineTo(quad(o.sx, cxp, o.hx, b), quad(o.sy, cyp, o.hy, b));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.shadowColor = o.big ? PINK : MINT;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(quad(o.sx, cxp, o.hx, k), quad(o.sy, cyp, o.hy, k), o.big ? 14 : 8, 0, 7);
      ctx.fill();
      ctx.restore();
      if (k >= 1 && !o.done) {
        o.done = true; // 피격: 몬스터가 번쩍이고 맞은 반대쪽으로 밀린다 (데미지 숫자는 끔)
        this.monShake = o.big ? 1 : 0.5;
        this.monFlash = o.big ? 1 : 0.55;
        this.monKick = Math.max(this.monKick, o.big ? 1 : 0.55);
        this.monKickDir = -o.side;
      }
      if (o.t > o.dur + 0.05) this.projs.splice(i, 1);
    }
  }

  // ---------- 캐릭터·타격 이펙트 ----------

  private drawHitFx(dt: number): void {
    const img = this.images.fx();
    if (img === null) return;
    const ctx = this.ctx;
    for (let i = this.hitFxs.length - 1; i >= 0; i -= 1) {
      const o = this.hitFxs[i]!;
      o.t += dt;
      const d = o.big ? 0.38 : 0.3;
      if (o.t > d) {
        this.hitFxs.splice(i, 1);
        continue;
      }
      const k = o.t / d;
      const ease = 1 - Math.pow(1 - k, 3);
      const sz = o.size * (0.5 + 0.8 * ease);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.pow((k - 0.15) / 0.85, 1.6);
      ctx.translate(o.x, o.y);
      ctx.rotate(o.rot + k * (o.big ? 0.9 : 0.5));
      ctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
      if (o.big && k < 0.5) {
        ctx.globalAlpha *= 0.6;
        const s2 = sz * 0.55;
        ctx.drawImage(img, -s2 / 2, -s2 / 2, s2, s2);
      }
      ctx.restore();
    }
  }

  private drawCharacter(dt: number): void {
    const hero = this.images.hero();
    if (hero === null) return;
    const ctx = this.ctx;
    const b = V10C.bottom.hero;
    const homeH = b.homeHeight;
    const strikeH = b.strikeHeight;
    const hb = H - b.baselineBottom;
    this.swing.t += dt;
    const holdSec = b.holdMs / 1000;
    const strike = this.images.strike();
    const w1 = (homeH * hero.width) / hero.height;
    const cx = V10C.rail.cx;
    if (!this.swing.any) {
      ctx.drawImage(hero, cx - w1 / 2, hb - homeH, w1, homeH);
      return;
    }
    const flip = this.swing.dir > 0; // 오른쪽 레인이면 좌우 반전(캐릭터가 레인 안쪽에 서도록)
    const sw = strikeH * b.strikeAspect;
    const fxe = flip ? 1 - b.hammerFx : b.hammerFx;
    const tgt = { x: this.swing.tx - fxe * sw, y: this.swing.ty - b.hammerFy * strikeH, w: sw, h: strikeH };
    const draw = (img: CanvasImageSource, x: number, y: number, w: number, h: number, mirror: boolean): void => {
      ctx.save();
      if (mirror) {
        ctx.translate(x + w / 2, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, -w / 2, y, w, h);
      } else ctx.drawImage(img, x, y, w, h);
      ctx.restore();
    };
    if (b.stay) {
      // 친 자리에 대기: 타격 자세를 잠깐 유지한 뒤 그 자리에서 준비 자세
      if (this.swing.t < holdSec && strike !== null) {
        draw(strike, tgt.x, tgt.y, tgt.w, tgt.h, flip);
        return;
      }
      const bodyX = flip ? tgt.x + tgt.w - 0.58 * tgt.w : tgt.x + 0.58 * tgt.w;
      const feetY = tgt.y + tgt.h;
      draw(hero, bodyX - w1 / 2, feetY - homeH, w1, homeH, flip);
      return;
    }
    // 가운데로 복귀
    const total = holdSec + b.returnMs / 1000;
    if (!(this.swing.t < total && strike !== null)) {
      ctx.drawImage(hero, cx - w1 / 2, hb - homeH, w1, homeH);
      return;
    }
    const hw = homeH * b.strikeAspect;
    const home = { x: cx - hw * 0.58, y: hb - homeH, w: hw, h: homeH };
    let mix = 1;
    if (this.swing.t >= holdSec) {
      const r = Math.min(1, (this.swing.t - holdSec) / Math.max(0.001, b.returnMs / 1000));
      mix = 1 - r * r * (3 - 2 * r);
    }
    draw(strike, home.x + (tgt.x - home.x) * mix, home.y + (tgt.y - home.y) * mix, home.w + (tgt.w - home.w) * mix, home.h + (tgt.h - home.h) * mix, flip);
  }

  // ---------- 글자·HUD ----------

  private drawHud(): void {
    const ctx = this.ctx;
    const t = V10C.top;
    ctx.fillStyle = '#2a2230';
    ctx.fillRect(0, t.progressBar.y, W, t.progressBar.height);
    const g = ctx.createLinearGradient(0, 0, W * 0.2, 0);
    g.addColorStop(0, PINK);
    g.addColorStop(1, MINT);
    ctx.fillStyle = g;
    ctx.fillRect(0, t.progressBar.y, Math.max(0, Math.min(W, this.status.progress * W)), t.progressBar.height);
    // 곡명 칸 (글자가 가로로 반복해서 흐른다, 글자 색 = 난이도)
    const tsz = t.titleSize;
    const box = { x: t.titleBox.x, y: t.titleBox.y, w: t.titleBox.width, h: Math.max(30, tsz + 18) };
    const text = `곡명 : ${this.songName}        `;
    ctx.save();
    roundRect(ctx, box.x, box.y, box.w, box.h, 10);
    ctx.fillStyle = 'rgba(10,7,12,.85)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,246,238,.5)';
    ctx.stroke();
    ctx.clip();
    ctx.font = font(tsz);
    ctx.fillStyle = V10C.colors.difficulty[this.difficulty] ?? '#fff';
    ctx.textBaseline = 'middle';
    this.titleWidth = ctx.measureText(text).width;
    const off = titleScrollOffset(this.lastNowMs, this.titleWidth, t.titleSpeed);
    for (let x = box.x + 10 - off; x < box.x + box.w; x += this.titleWidth) ctx.fillText(text, x, box.y + box.h / 2 + 1);
    ctx.restore();
    // 점수
    const ssz = t.scoreSize;
    const sy = box.y + box.h + 14 + ssz * 0.4;
    ctx.save();
    ctx.font = font(Math.max(14, ssz * 0.4));
    ctx.fillStyle = MINT;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('SCORE', 24, sy);
    ctx.font = font(ssz);
    ctx.fillStyle = '#fff6ee';
    ctx.shadowColor = 'rgba(0,0,0,.9)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillText(Math.round(this.status.score).toLocaleString('en-US'), 22, sy + ssz * 1.05);
    ctx.restore();
  }

  private drawCombo(): void {
    const combo = this.status.combo;
    if (combo < 2) return;
    const ctx = this.ctx;
    const mm = monsterRect(this.images.monsterAspect());
    const side = this.lastHit.side;
    const x = V10C.rail.cx + side * (mm.bw / 2 + 14);
    const y = V10C.top.monsterBottom + 22;
    const pop = Math.max(0, 1 - this.lastHit.t * 6);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.95)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    const numSize = 64 * (1 + pop * 0.18);
    ctx.font = font(numSize);
    const ns = String(combo);
    const nw = ctx.measureText(ns).width;
    ctx.font = font(28);
    const label = '콤보×';
    const lw = ctx.measureText(label).width;
    const total = lw + nw + 6;
    const sx = side < 0 ? x - total : x;
    ctx.textAlign = 'left';
    ctx.fillStyle = CREAM;
    ctx.font = font(28);
    ctx.fillText(label, sx, y);
    ctx.font = font(numSize);
    ctx.fillText(ns, sx + lw + 6, y + 2);
    ctx.restore();
  }

  private drawFloats(dt: number): void {
    const ctx = this.ctx;
    const j = V10C.bottom.judgeText;
    const life = j.lifeMs / 1000;
    for (let i = this.floats.length - 1; i >= 0; i -= 1) {
      const f = this.floats[i]!;
      f.t += dt;
      if (f.t > life) {
        this.floats.splice(i, 1);
        continue;
      }
      const k = f.t / life;
      const sc = 1.25 - 0.25 * Math.min(1, k * 4);
      ctx.save();
      ctx.globalAlpha = 1 - Math.pow(k, 3);
      ctx.textAlign = 'center';
      ctx.font = font(j.size * (f.grade === 'perfect' ? 1.15 : 1));
      ctx.fillStyle = V10C.judgeColors[f.grade] ?? '#fff';
      ctx.shadowColor = 'rgba(0,0,0,.85)';
      ctx.shadowBlur = 8;
      ctx.translate(f.x, f.y - k * 14);
      ctx.scale(sc, sc);
      ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
  }
}

/** 연타 막대용 높이: 레인 한 개 기준의 노트 높이식 */
function noteYForBurst(lane: number, p: number, laneCount: number): number {
  const out = { x: 0, y: 0, scale: 1, alpha: 1 };
  notePose(lane, p, laneCount, 0.88, out);
  // 몬스터에서 발사되는 앞 구간의 곡선 대신, 막대는 레일 위 높이만 쓴다
  const R = V10C.rail;
  const base = R.farY + (R.judgeY - R.farY) * Math.pow(Math.max(0, Math.min(p, 1.7)), V10C.note.yPower);
  return p <= 1 ? base : out.y;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
