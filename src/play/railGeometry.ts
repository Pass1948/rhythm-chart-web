// 레일의 원근 계산 (순수 함수, 렌더링 없음).
// 진행도 p: 0 = 레일 맨 위(노트가 나타나는 곳), 1 = 판정선. 1보다 크면 판정선을 지나 아래로 내려간 것이다.
// 깊이가 시간에 따라 일정하게 줄어든다고 보고, 화면 크기는 깊이에 반비례, 화면 y 는 그 크기에 비례하는 진짜 원근으로 계산한다.
import { PLAY_CONFIG } from './playConfig';

export type RailConfig = typeof PLAY_CONFIG.rail;

/** 한 번 계산해 두고 재사용하는 레일 모양 */
export interface RailShape {
  config: RailConfig;
  /** 레일 맨 위에서의 크기 비율 (판정선 = 1) */
  farScale: number;
  /** 진행도 0 일 때의 깊이 (판정선 깊이 = 1) */
  farDepth: number;
  /** 화면에 보이는 레일 끝(bottomY)의 진행도. 이보다 아래의 노트는 그리지 않는다 */
  bottomProgress: number;
}

/** 레일 설정으로 모양을 만든다. */
export function createRailShape(config: RailConfig = PLAY_CONFIG.rail): RailShape {
  const farScale = config.topWidth / config.judgeWidth;
  const farDepth = 1 / farScale;
  const bottomScale = farScale + ((config.bottomY - config.topY) / (config.judgeY - config.topY)) * (1 - farScale);
  const bottomProgress = (1 / bottomScale - farDepth) / (1 - farDepth);
  return { config, farScale, farDepth, bottomProgress };
}

/** 진행도 p 에서의 크기 비율 (판정선 = 1, 멀수록 작다) */
export function scaleAt(shape: RailShape, progress: number): number {
  const depth = shape.farDepth + (1 - shape.farDepth) * progress;
  return 1 / depth;
}

/** 진행도 p 에서의 화면 y */
export function yAt(shape: RailShape, progress: number): number {
  const { config, farScale } = shape;
  const ratio = (scaleAt(shape, progress) - farScale) / (1 - farScale);
  return config.topY + (config.judgeY - config.topY) * ratio;
}

/** 진행도 p 에서의 레일 전체 폭의 절반 */
export function halfWidthAt(shape: RailShape, progress: number): number {
  return (shape.config.judgeWidth / 2) * scaleAt(shape, progress);
}

/**
 * 레일 전체 폭을 laneCount 등분했을 때 레인 가운데의 위치. 레일 가운데 = 0, 왼쪽 끝 = -1, 오른쪽 끝 = +1.
 * 2레인: -0.5, +0.5 / 4레인: -0.75, -0.25, +0.25, +0.75 (원근 레일 폭 안에서 같은 간격)
 */
export function laneOffsetRatio(lane: number, laneCount: number = 2): number {
  return (2 * (lane + 0.5)) / laneCount - 1;
}

/** 진행도 p 에서 레인(0=왼쪽 …) 가운데의 x. laneCount 는 2(기본) 또는 4 */
export function laneCenterX(shape: RailShape, lane: number, progress: number, laneCount: number = 2): number {
  const half = halfWidthAt(shape, progress);
  return shape.config.centerX + half * laneOffsetRatio(lane, laneCount);
}

/** 레일 바깥 가장자리의 x (side: -1 왼쪽, +1 오른쪽) */
export function edgeX(shape: RailShape, side: -1 | 1, progress: number): number {
  return shape.config.centerX + side * halfWidthAt(shape, progress);
}

/**
 * 노트 시각의 진행도. 노트 위치 = (노트 시각 − (곡 시간 − visualOffsetMs)) / fallTimeMs 만큼 판정선 위에 있다.
 * 곡 시간 = 노트 시각이면 1(판정선), 낙하 시간만큼 앞이면 0(레일 맨 위).
 */
export function noteProgress(noteTimeMs: number, songMs: number, visualOffsetMs: number, fallTimeMs: number): number {
  const distance = (noteTimeMs - (songMs - visualOffsetMs)) / fallTimeMs;
  return 1 - distance;
}

/** 판정원(S/F) 중심과 반지름 (판정선 위, 레인 가운데) */
export function judgeCircleCenter(shape: RailShape, lane: number, laneCount: number = 2): { x: number; y: number } {
  return { x: laneCenterX(shape, lane, 1, laneCount), y: shape.config.judgeY };
}
