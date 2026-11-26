// 새 플레이 화면 "10-C"의 수치 설정 (한 곳). 참고 HTML(reference\playscreen_10C.html)의 cfg 기본값에 11단계 지시서의 전달값을 덮어쓴 것이다.
// 옵션 슬라이더 화면은 만들지 않는다. 값을 바꾸려면 이 파일만 고친다.

export const V10C_VIEW = { width: 720, height: 1280 } as const;

export const V10C = {
  // ---- 레일 기하 (참고 HTML widthAt/judgeYLane 와 같은 식) ----
  rail: {
    /** 레일 가운데 x */
    cx: 360,
    /** 레일 맨 위(노트가 나오는 높이)와 폭 식: width(y) = baseWidth + (y − baseY) × slope */
    farY: 140,
    baseY: 330,
    baseWidth: 217,
    slope: 0.445,
    judgeY: 1000,
    bottomY: 1280,
    /** 판정원 호 높이 차이: 4레인에서 바깥 두 레인의 판정원이 arc 만큼 아래(음수면 위로 올라가는 식과 같게 judgeY − arc) */
    arc: -60,
    /** 기준선 시작 투명도(1 − 90%), 경계 부드럽게 */
    fadeA: 0.1,
    soft: 300,
    dividers: true,
  },
  judgeCircle: { radius4: 58, radius2: 70, lineWidth: 5, innerRatio: 0.48, labelOffset: 24 },
  // ---- 노트 ----
  note: {
    /** 노트 이동 시간 기본값(ms). 설정 fallTimeMs10c 의 기본값이 이것 */
    travelMs: 1400,
    /** 몬스터에서 발사되는 연출 */
    emitOn: true,
    emitLenPercent: 60,
    /** 노트 진행도에 곱하는 지수 (참고 HTML noteY: pow(p, 1.55)) */
    yPower: 1.55,
    scaleMin: 0.32,
    scaleGain: 0.68,
    scalePower: 1.2,
    /** 판정원 반지름에 곱하는 노트 반지름 비율 */
    radiusRatio: 0.85,
    /** 놓친 노트가 판정선을 지나 떨어지는 진행도 한계 */
    missFallTo: 1.7,
    simultaneous: { line: true, differentColor: true, color: '#4de8bd', width: 6 },
  },
  // ---- 타격감 ----
  feel: {
    /** 지시서: 음량 60, 꼬리 정리 300ms. 효과음은 기존 TapSound.wav 재생 경로를 그대로 쓰므로 값만 기록한다(결과 md 참고) */
    volume: 60,
    tailMs: 300,
    hitStopOn: true,
    hitStopMs: 45,
    shakePx: 3,
    shakeMs: 90,
    pillarOpacityPercent: 60,
    pillarHeight: 460,
    pillarLifeMs: 240,
  },
  // ---- 상단 ----
  top: {
    titleSize: 18,
    titleSpeed: 50,
    scoreSize: 30,
    monsterScale: 2.0,
    monsterBottom: 342,
    barScalePercent: 100,
    barOffsetY: 0,
    projectileFlightMs: 144,
    damageNumbers: false,
    knockbackPx: 14,
    hpDrain: { on: true, waitMs: 0, speedPercentPerSec: 10 },
    /** 몬스터 체력 1.0 = 곡 전체 노트 수. 한 번 맞을 때 줄어드는 양은 규칙이 아니라 "끝난 노트 수"에서 정해진다 */
    pauseButtonScale: 0.7,
    pauseButton: { x: 24, y: 44, size: 100 },
    titleBox: { x: 24, y: 160, width: 160 },
    progressBar: { y: 18, height: 6 },
  },
  // ---- 게이지 ----
  gauge: { length: 460, segmentPercent: 100, bottomY: 1090, offset: 30, thickness: 14 },
  // ---- 하단 ----
  bottom: {
    judgeText: { size: 26, lifeMs: 350, onePerLane: true },
    ghost: { on: false, ms: 140, opacityPercent: 40 },
    hero: { stay: true, homeHeight: 200, strikeHeight: 200, holdMs: 160, returnMs: 60, baselineBottom: 50, strikeAspect: 0.977778, hammerFx: 0.13, hammerFy: 0.4 },
  },
  colors: { pink: '#ff2e93', mint: '#4de8bd', cream: '#fff1c9', difficulty: { EASY: '#4de8bd', NORMAL: '#ffd23d', HARD: '#ff3b5c' } as Record<string, string> },
  judgeColors: { perfect: '#fff6ee', great: '#4de8bd', good: '#fff1c9', bad: '#9a8aa0', miss: '#9a8aa0' } as Record<string, string>,
  /** 화면 그림 파일 (public\img10c, 상대 경로) */
  images: {
    hero: 'img10c/hero.webp',
    monster: 'img10c/monster.webp',
    strike: 'img10c/strike.webp',
    fx: 'img10c/fx.webp',
    barFrame: 'img10c/bar_frame.webp',
    barGreen: 'img10c/bar_green.webp',
    barBack: 'img10c/bar_back.webp',
    barYellow: 'img10c/bar_yellow.webp',
  },
} as const;

export type V10CConfig = typeof V10C;
