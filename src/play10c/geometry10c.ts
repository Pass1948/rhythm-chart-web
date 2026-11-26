// 새 플레이 화면 10-C의 계산(순수 함수, 그리기 없음). 참고 HTML(reference\playscreen_10C.html)의 widthAt / laneX / judgeYLane / noteY / notePos 를 그대로 옮겼다.
import { V10C, V10C_VIEW } from './config10c';

const R = V10C.rail;

/** 높이 y 에서의 레일 전체 폭 */
export function widthAt(y: number): number {
  return R.baseWidth + (y - R.baseY) * R.slope;
}
export function edgeL(y: number): number {
  return R.cx - widthAt(y) / 2;
}
export function edgeR(y: number): number {
  return R.cx + widthAt(y) / 2;
}

/** 높이 y 에서 레인 i 가운데의 x (laneCount = 2 | 4) */
export function laneX(lane: number, y: number, laneCount: number): number {
  return edgeL(y) + ((lane + 0.5) / laneCount) * widthAt(y);
}

/** 레인 i 의 판정원 가운데 높이: 4레인에서 바깥 두 레인은 judgeY − arc */
export function judgeYLane(lane: number, laneCount: number): number {
  if (laneCount === 4 && (lane === 0 || lane === 3)) return R.judgeY - R.arc;
  return R.judgeY;
}

/** 판정원 반지름 */
export function judgeRadius(laneCount: number): number {
  return laneCount === 4 ? V10C.judgeCircle.radius4 : V10C.judgeCircle.radius2;
}

/** 판정원 가운데 좌표 */
export function judgeCenter(lane: number, laneCount: number): { x: number; y: number } {
  const y = judgeYLane(lane, laneCount);
  return { x: laneX(lane, y, laneCount), y };
}

/**
 * 진행도 p(0 = 나타남, 1 = 판정 시각)에서 레인 lane 노트의 높이.
 * 기준점(몬스터에서 발사 켜짐이면 farY, 아니면 spawnY)에서 판정선까지 p^지수 로 내려오고, 레인마다 판정원 높이 차이를 p 에 비례해 더한다.
 */
export function noteY(lane: number, p: number, laneCount: number, spawnY: number = R.farY): number {
  const base = spawnY + (R.judgeY - spawnY) * Math.pow(p, V10C.note.yPower);
  return base + (judgeYLane(lane, laneCount) - R.judgeY) * p;
}

/** 몬스터 그림 크기: 높이 bh, 폭 bw(그림 비율 aspect), 바닥 y */
export function monsterRect(aspect: number): { bh: number; bw: number; bottom: number } {
  const bh = 248 * (V10C.top.monsterScale / 2);
  return { bh, bw: bh * aspect, bottom: V10C.top.monsterBottom };
}

/** 노트가 나오는 몬스터 쪽 출발점 */
export function emitOrigin(aspect: number): { x: number; y: number } {
  const m = monsterRect(aspect);
  return { x: R.cx, y: m.bottom - m.bh * 0.45 };
}

export interface NotePose {
  x: number;
  y: number;
  /** 크기 배율 */
  scale: number;
  alpha: number;
}

/**
 * 진행도 p 에서 노트 한 개의 위치·크기·투명도.
 * p ≤ 1: 레일 위를 내려옴 (발사 연출이 켜져 있으면 앞 emitLenPercent% 구간은 몬스터 자리에서 곡선으로 레인에 합류)
 * p > 1: 판정선을 지나 화면 아래로 사라짐 (놓친 노트)
 */
export function notePose(lane: number, p: number, laneCount: number, aspect: number, out: NotePose = { x: 0, y: 0, scale: 1, alpha: 1 }): NotePose {
  if (p <= 1) {
    let y = noteY(lane, p, laneCount);
    let x = laneX(lane, y, laneCount);
    let scale = V10C.note.scaleMin + V10C.note.scaleGain * Math.pow(Math.max(0, p), V10C.note.scalePower);
    if (V10C.note.emitOn) {
      const pe = V10C.note.emitLenPercent / 100;
      if (p < pe) {
        const o = emitOrigin(aspect);
        const t = p / pe;
        const k = 1 - Math.pow(1 - t, 2.2);
        x = o.x + (x - o.x) * k;
        y = o.y + (y - o.y) * k;
        scale = 0.12 + (scale - 0.12) * k;
      }
    }
    out.x = x;
    out.y = y;
    out.scale = scale;
    out.alpha = 1;
    return out;
  }
  const q = (p - 1) / 0.7;
  const jl = judgeYLane(lane, laneCount);
  const y = jl + q * (V10C_VIEW.height + 120 - jl);
  out.x = laneX(lane, y, laneCount);
  out.y = y;
  out.scale = 1 + q * 0.25;
  out.alpha = Math.max(0, 1 - q * 1.05);
  return out;
}

// ---------- 몬스터 체력 ----------

/** 체력 비율(0~1) = 남은 노트 수 ÷ 곡 전체 노트 수. 끝난 노트가 total 이면 0. */
export function hpRatio(total: number, resolved: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(1, (total - resolved) / total));
}

/** 천천히 닳는 체력(노랑 부분)을 한 프레임 진행한다: 실제 체력 hp 까지 초당 speed 비율씩 줄어든다. 체력이 회복(리셋)되면 바로 따라간다. */
export function drainStep(shown: number, hp: number, dtSec: number, speedPerSec: number): number {
  if (shown < hp) return hp;
  return Math.max(hp, shown - dtSec * speedPerSec);
}

// ---------- 곡명 칸 ----------

/** 곡명 글자가 반복해서 흘러가는 시작 위치(px): 글자 폭 textWidth 마다 되풀이, speed px/초 */
export function titleScrollOffset(nowMs: number, textWidth: number, speedPxPerSec: number): number {
  if (!(speedPxPerSec > 0) || !(textWidth > 0)) return 0;
  return ((nowMs / 1000) * speedPxPerSec) % textWidth;
}

// ---------- 좌·우 게이지 선 ----------

export interface GaugeLines {
  /** 게이지 바탕 선 (위 y, 아래 y) */
  top: number;
  bottom: number;
  /** 왼쪽 피버: 아래에서 위로 채움 */
  fever: { y0: number; y1: number };
  /** 오른쪽 부정수치: 남은 부분(민트)과 침식된 부분(붉은색) */
  safe: { y0: number; y1: number };
  eroded: { y0: number; y1: number } | null;
}

/**
 * 게이지 선 길이와 색 구간. feverPercent / negativePercent 는 규칙이 계산한 0~100 값.
 * 색 구간 최대 길이 = 전체 길이 × segmentPercent%. 피버는 최소 8% 길이(참고 HTML과 같음).
 */
export function gaugeLines(feverPercent: number, negativePercent: number): GaugeLines {
  const g = V10C.gauge;
  const bottom = g.bottomY;
  const top = bottom - g.length;
  const seg = (g.length * g.segmentPercent) / 100;
  const fever = Math.max(0, Math.min(1, feverPercent / 100));
  const neg = Math.max(0, Math.min(1, negativePercent / 100));
  const fh = seg * Math.max(0.08, fever);
  const er = seg * neg;
  return {
    top,
    bottom,
    fever: { y0: bottom - fh, y1: bottom },
    safe: { y0: top + er, y1: top + seg },
    eroded: neg > 0 ? { y0: top, y1: top + er } : null,
  };
}

// ---------- PC 화면 맞춤 ----------

export interface StageFit {
  scale: number;
  left: number;
  top: number;
  /** 무대 왼쪽·오른쪽 바깥의 덮개 폭(px) */
  coverLeft: number;
  coverRight: number;
}

/** 창 크기(viewW×viewH)에 720×1280 무대를 비율 유지로 가장 크게 넣고, 가운데에 두었을 때 양옆 덮개 폭을 구한다. */
export function stageFit(viewW: number, viewH: number): StageFit {
  const scale = Math.min(viewW / V10C_VIEW.width, viewH / V10C_VIEW.height);
  const w = V10C_VIEW.width * scale;
  const h = V10C_VIEW.height * scale;
  const left = (viewW - w) / 2;
  return { scale, left, top: (viewH - h) / 2, coverLeft: left, coverRight: viewW - left - w };
}

/** 실제 배치 결과(무대 왼쪽 위치 left, 화면에 보이는 무대 폭 stageWidthPx)에서 양옆 덮개 폭을 구한다. */
export function coverWidths(viewW: number, left: number, stageWidthPx: number): { left: number; right: number } {
  return { left: Math.max(0, left), right: Math.max(0, viewW - left - stageWidthPx) };
}

// ---------- 터치 구역 ----------

/**
 * 터치 구역 경계(화면 가로 0~1 비율): 판정원 가운데 사이의 한가운데라서 "가장 가까운 레인"과 같다. 2레인은 [0.5].
 */
export function zoneBounds10c(laneCount: number): number[] {
  const centers: number[] = [];
  for (let i = 0; i < laneCount; i += 1) centers.push(judgeCenter(i, laneCount).x);
  const out: number[] = [];
  for (let i = 0; i < laneCount - 1; i += 1) out.push((centers[i]! + centers[i + 1]!) / 2 / V10C_VIEW.width);
  return out;
}
