// 음원 카드(가로 타임라인) 편집의 순수 계산 (09단계): 세로 배치, 노트 줄 판정, 노트 맞히기(앞뒤 끝 포함), 영역 선택 범위.
// 화면·상태에 의존하지 않아 Node 로 테스트한다. 데이터 변경은 note_ops.js 가 한다.
import { LANE_BOTH, MIN_LONG_TICKS, isLong, noteEnd } from './edit_rules.js';

export const LEFT = 36; // 왼쪽 이름 영역 폭(px)
export const BASE_H = 230;
const BASE = { RULER: 18, WAVE_TOP: 22, WAVE_H: 84, CAND_Y: 112, LANE_Y: [134, 178], LANE_H: 38 };
/** 4키: 같은 노트 줄 영역(134~216)을 4등분한다 */
const BASE_4KEY = { LANE_Y: [134, 155, 176, 197], LANE_H: 19 };

/** 길이 조절 손잡이 판정 폭(px): 롱노트·연타의 앞뒤 끝에서 이만큼 안쪽/바깥쪽 */
export const EDGE_PX = 5;
/** 이 폭(px)보다 좁은 롱노트는 손잡이 없이 몸통만 잡는다 */
export const MIN_EDGE_NOTE_PX = EDGE_PX * 2 + 4;

/** 세로 배치는 캔버스 높이에 비례한다(기준 230px 에서 정한 값을 높이 비율로 줄이거나 늘림). lanes: 노트 줄 수 (2키 2 / 4키 4) */
export function layoutFor(h, lanes = 2) {
  const k = Math.max(0.55, Math.min(1.2, h / BASE_H));
  const lane = lanes === 4 ? BASE_4KEY : BASE;
  return {
    RULER: Math.round(BASE.RULER * k), WAVE_TOP: Math.round(BASE.WAVE_TOP * k), WAVE_H: Math.round(BASE.WAVE_H * k),
    CAND_Y: Math.round(BASE.CAND_Y * k), LANE_Y: lane.LANE_Y.map((y) => Math.round(y * k)), LANE_H: Math.round(lane.LANE_H * k),
  };
}

/** 노트 줄 수 (layoutFor 결과에서) */
export function laneCountOf(L) {
  return L.LANE_Y.length;
}

/** 노트 줄 영역(첫 줄 위 ~ 마지막 줄 아래) 안인가 */
export function inLaneArea(y, L) {
  return y >= L.LANE_Y[0] && y <= L.LANE_Y[L.LANE_Y.length - 1] + L.LANE_H;
}

/** y 아래의 레인(2키 0 왼쪽 / 1 오른쪽, 4키 0~3). 노트 줄 밖이면 -1. 줄 사이 빈틈은 가까운 쪽 */
export function laneAtY(y, L) {
  if (!inLaneArea(y, L)) return -1;
  for (let l = 0; l < L.LANE_Y.length - 1; l++) {
    const mid = (L.LANE_Y[l] + L.LANE_H + L.LANE_Y[l + 1]) / 2;
    if (y < mid) return l;
  }
  return L.LANE_Y.length - 1;
}

/** 단타 반지름(px) / 롱노트 반높이(px) — timeline.js 의 그리기와 같은 식 */
export function tapRadius(L) {
  return Math.max(4, Math.round(L.LANE_H * 0.17));
}
export function holdHalfHeight(L) {
  return Math.max(5, Math.round(L.LANE_H * 0.26));
}

/**
 * 마우스 아래 노트와 부위. part: 'body' | 'start'(앞 끝) | 'end'(뒤 끝). 단타는 항상 body.
 * @param list 노트 목록 @param xOfTick tick → x(px) @param L layoutFor 결과
 */
export function hitNote(list, x, y, xOfTick, L) {
  if (!inLaneArea(y, L)) return null;
  const lane = laneAtY(y, L);
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    const x0 = xOfTick(n.tick);
    if (n.type === 'tap') {
      if (n.lane === lane && Math.abs(x - x0) <= tapRadius(L) + 2) return { note: n, part: 'body' };
      continue;
    }
    if (n.type !== 'burst' && n.lane !== lane) continue;
    const x1 = xOfTick(noteEnd(n));
    const w = Math.max(3, x1 - x0);
    if (x < x0 - EDGE_PX || x > x0 + w + EDGE_PX) continue;
    if (w >= MIN_EDGE_NOTE_PX) {
      if (Math.abs(x - x0) <= EDGE_PX) return { note: n, part: 'start' };
      if (Math.abs(x - (x0 + w)) <= EDGE_PX) return { note: n, part: 'end' };
    }
    if (x >= x0 && x <= x0 + w) return { note: n, part: 'body' };
  }
  return null;
}

/**
 * 영역 선택(마키) 범위 → idsInArea 가 받는 {t0, t1, lanes, pad}
 * @param d {x0,x1,y0,y1} 끌기 시작·현재 좌표 @param xToTick x(px) → tick @param padTicks 단타 반지름만큼의 tick
 */
export function marqueeArea(d, L, xToTick, padTicks) {
  const xa = Math.min(d.x0, d.x1);
  const xb = Math.max(d.x0, d.x1);
  const ya = Math.min(d.y0, d.y1);
  const yb = Math.max(d.y0, d.y1);
  const lanes = [];
  for (let l = 0; l < L.LANE_Y.length; l++) {
    const top = L.LANE_Y[l];
    if (yb >= top && ya <= top + L.LANE_H) lanes.push(l);
  }
  return { t0: xToTick(xa), t1: xToTick(xb), lanes, pad: padTicks };
}

/** 이 폭(px)에서만 음원 카드 편집을 켠다(폰·태블릿 탭 배치는 보기 전용) */
export const TIMELINE_EDIT_MIN_WIDTH = 1024;
export function timelineEditEnabled(viewportWidth) {
  return viewportWidth >= TIMELINE_EDIT_MIN_WIDTH;
}

export { LANE_BOTH, MIN_LONG_TICKS, isLong };
