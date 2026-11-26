// 편집 화면 노트 모양(동그라미 / 바)의 크기·누르는 영역 계산. 화면 그리기와 클릭 판정이 같은 값을 쓰도록 한 곳에 모았다.
// 채보 데이터·내보내기·테스트/플레이 화면은 이 모양과 상관없다(편집 화면 그림만 바뀐다).

export const SHAPES = ['circle', 'bar'];
export const DEFAULT_SHAPE = 'circle';

export function normalizeShape(v) {
  return v === 'bar' ? 'bar' : 'circle';
}

// 바 모양 막대의 높이(px): 기본 보기(6초)에서 약 11px, 확대하면 12px까지, 축소해도 최소 8px
export function barHeight(spanMs) {
  const h = 11 * Math.pow(6000 / Math.max(1500, spanMs), 0.35);
  return Math.max(8, Math.min(12, h));
}

// 단타·롱노트 막대 폭 (바 모양: 레인 폭의 약 90%). 연타는 두 레인 전체 폭 그대로.
export function noteDrawWidth(note, laneW, shape, lanes = 2) {
  if (note.type === 'burst') return laneW * lanes - 16; // 연타는 전체 레인 폭 (2키 2칸, 4키 4칸)
  return shape === 'bar' ? laneW * 0.9 : laneW * 0.5;
}

// 동그라미 모양 반지름
export function circleRadius(laneW) {
  return Math.min(14, laneW * 0.2);
}

// 단타를 누르는 영역의 반쪽 크기 {hw, hh} (px). 동그라미는 반지름 14 원, 바는 막대 폭 x (높이 + 여유).
export function tapHitHalf(shape, laneW, spanMs) {
  if (shape === 'bar') return { hw: noteDrawWidth({ type: 'tap' }, laneW, 'bar') / 2 + 2, hh: Math.max(9, barHeight(spanMs) / 2 + 3) };
  return { hw: 14, hh: 14 };
}

// 단타를 눌렀는가 (dx, dy = 노트 가운데에서 포인터까지의 거리)
export function tapHit(shape, dx, dy, laneW, spanMs) {
  if (shape === 'bar') {
    const h = tapHitHalf('bar', laneW, spanMs);
    return Math.abs(dx) <= h.hw && Math.abs(dy) <= h.hh;
  }
  return Math.hypot(dx, dy) <= 14;
}

// 롱노트·연타 몸통을 누르는 가로 반쪽 폭
export function longHitHalfW(note, laneW, shape, lanes = 2) {
  return noteDrawWidth(note, laneW, shape, lanes) / 2 + (shape === 'bar' && note.type !== 'burst' ? 3 : 6);
}

// 영역 선택에서 단타가 위아래로 닿는 여유(px)
export function tapPadPx(shape, spanMs) {
  return shape === 'bar' ? Math.max(5, barHeight(spanMs) / 2 + 1) : 14;
}

// 붙여넣기 미리보기·점선 상자의 단타 반쪽 크기
export function tapOutlineHalf(shape, laneW, spanMs) {
  if (shape === 'bar') return { hw: noteDrawWidth({ type: 'tap' }, laneW, 'bar') / 2 + 3, hh: barHeight(spanMs) / 2 + 3 };
  return { hw: 16, hh: 16 };
}
