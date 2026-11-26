// 레일 바깥 양옆의 키 안내 (순수 함수, 화면 요소 없음). 어떤 글자를 보여 줄지, 어디에 놓을지만 계산한다.
import { PLAY_CONFIG } from './playConfig';
import { judgeCircleCenter, type RailShape } from './railGeometry';

/** 키 안내를 정할 때 필요한 입력 설정 */
export interface KeyGuideInput {
  keyboardEnabled: boolean;
  mouseEnabled: boolean;
  keyLeft: string;
  keyRight: string;
}

/** 안내 한 개의 위치. x 는 판정원 바깥 가장자리에서 gap 만큼 떨어진 곳, anchor 는 글자를 어느 쪽으로 붙일지 */
export interface KeyGuidePosition {
  x: number;
  y: number;
  /** 'end' = 글자의 오른쪽 끝이 x (왼쪽 레인용), 'start' = 글자의 왼쪽 끝이 x (오른쪽 레인용), 'center' = 판정원 한가운데 (4키) */
  anchor: 'start' | 'end' | 'center';
}

/**
 * 레인별 안내 글자를 정한다. 04-A 방식 그대로:
 * 키보드를 쓰면 환경설정의 키 이름, 키보드를 끄고 마우스만 쓰면 L / R, 둘 다 끄면 표시 없음(null).
 * 키보드와 마우스를 같이 켜 두면 키 이름만 보여 준다(마우스는 레인을 누르는 것이라 안내가 필요 없다).
 */
export function keyGuideLabels(input: KeyGuideInput, labelOf: (code: string) => string): readonly [string | null, string | null] {
  if (input.keyboardEnabled) return [labelOf(input.keyLeft), labelOf(input.keyRight)];
  if (input.mouseEnabled) return ['L', 'R'];
  return [null, null];
}

/**
 * 터치 기기에서 탭 영역 안내를 쓸지: 터치 기기이고 마우스(터치 포함) 입력이 켜져 있을 때.
 * 이 경우 레인 바깥의 "S / F" 같은 키 안내는 폰에 의미가 없으므로 보여 주지 않는다.
 */
export function useTapZoneGuide(isTouch: boolean, input: KeyGuideInput): boolean {
  return isTouch && input.mouseEnabled;
}

/** 안내 위치: 각 판정원의 바로 옆 바깥쪽 (왼쪽 판정원은 그 왼쪽, 오른쪽 판정원은 그 오른쪽), 판정원 중심과 같은 높이 */
export function keyGuidePosition(shape: RailShape, lane: number, gap: number = PLAY_CONFIG.keyGuide.gap, circleRadius: number = PLAY_CONFIG.judgeCircle.radius, laneCount: number = 2): KeyGuidePosition {
  if (laneCount === 4) {
    // 4키: 글자를 각 판정원 안(가운데)에 놓는다
    const inside = judgeCircleCenter(shape, lane, 4);
    return { x: inside.x, y: inside.y, anchor: 'center' };
  }
  const side = lane === 0 ? -1 : 1;
  const center = judgeCircleCenter(shape, lane);
  return { x: center.x + side * (circleRadius + gap), y: center.y, anchor: lane === 0 ? 'end' : 'start' };
}
