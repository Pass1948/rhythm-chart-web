// 연출 계산 (순수 로직, 그리기·소리 없음): 이펙트 풀, 이펙트 양 단계, 콤보 팝, 피버 시작/끝 감지.
import type { Grade } from './core/config/gameConfig';
import { EFFECT_CONFIG, TAP_SOUND, type EffectLevel, type GradeFx } from './effectConfig';

/** 풀에서 꺼내 쓰는 이펙트 하나의 공통 모양 */
export interface PooledEffect {
  active: boolean;
  /** 시작 시각 (ms) */
  startMs: number;
}

/**
 * 고정 크기 풀: 미리 만들어 둔 칸을 재사용한다. 가득 차면 가장 오래된 칸을 다시 쓴다(동시 이펙트 수 상한).
 * 칸 안의 값은 호출하는 쪽이 덮어쓴다.
 */
export class EffectPool<T extends PooledEffect> {
  readonly items: T[] = [];
  /** 가득 차서 오래된 칸을 다시 쓴 횟수 (점검용) */
  stolen = 0;

  constructor(size: number, create: (index: number) => T) {
    for (let i = 0; i < size; i += 1) this.items.push(create(i));
  }

  get size(): number {
    return this.items.length;
  }

  /** 지금 쓰이는 칸 수 */
  get activeCount(): number {
    let count = 0;
    for (const item of this.items) {
      if (item.active) count += 1;
    }
    return count;
  }

  /** 빈 칸을 꺼낸다. 없으면 가장 오래된 칸을 돌려준다. 꺼낸 칸은 active 로 표시한다. */
  acquire(nowMs: number): T {
    let oldest = this.items[0]!;
    for (const item of this.items) {
      if (!item.active) {
        item.active = true;
        item.startMs = nowMs;
        return item;
      }
      if (item.startMs < oldest.startMs) oldest = item;
    }
    this.stolen += 1;
    oldest.active = true;
    oldest.startMs = nowMs;
    return oldest;
  }

  /** 모두 쉬게 한다. */
  releaseAll(): void {
    for (const item of this.items) item.active = false;
  }
}

/** 이펙트 양 단계에 맞춘 개수 = round(기본 개수 × 배율). 기본이 0 이면 항상 0 */
export function scaledCount(base: number, multiplier: number): number {
  if (base <= 0) return 0;
  return Math.round(base * multiplier);
}

/** 등급과 이펙트 양으로 만든 이펙트 분량 */
export interface HitFxPlan {
  beam: boolean;
  rings: number;
  stars: number;
}

/** 링 반지름: 시작 반지름에서 목표 반지름까지 부드럽게 커진다 (p 는 0~1 진행도) */
export function ringRadiusAt(startRadius: number, targetRadius: number, progress: number): number {
  return startRadius + (targetRadius - startRadius) * easeOutExpand(progress);
}

/** 방사형 별 한 개의 출발점과 속도. i 번째 별을 count 개 중 고르게 나눈 각도(+ jitter 0~1 로 약간 흔듦)로 원 둘레에서 바깥으로 보낸다 */
export function radialStarSpawn(
  index: number,
  count: number,
  jitter: number,
  circleRadius: number,
  speed: number,
): { dx: number; dy: number; vx: number; vy: number } {
  const angle = ((index + (jitter - 0.5) * 0.6) / Math.max(1, count)) * Math.PI * 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { dx: cos * circleRadius, dy: sin * circleRadius, vx: cos * speed, vy: sin * speed };
}

/** 판정 하나에 낼 이펙트 분량. 이펙트 양이 적게여도 빛기둥은 항상 낸다. */
export function planHitFx(fx: GradeFx, level: EffectLevel): HitFxPlan {
  const mul = EFFECT_CONFIG.levels[level];
  return { beam: true, rings: scaledCount(fx.rings, mul.rings), stars: scaledCount(fx.stars, mul.stars) };
}

/** 탭 소리 설정의 모양 (TAP_SOUND 와 같은 값 구조) */
export interface TapSoundSettings {
  playMs: number;
  fadeMs: number;
  fileGain: number;
  grades: Record<'perfect' | 'great' | 'good' | 'bad', { rate: number; gain: number }>;
}

/** 탭 소리 한 번의 재생 계획 */
export interface TapSoundPlan {
  /** 재생 속도 (1 = 원래 음높이) */
  rate: number;
  /** 볼륨 배율 (파일 전용 배율까지 곱한 값) */
  gain: number;
  /** 실제로 울리는 시간 (초) = 앞부분 길이 ÷ 재생 속도 */
  playSec: number;
  /** 페이드아웃이 시작되는 시각 (재생 시작 후 초) */
  fadeStartSec: number;
}

/** 등급(PERFECT/GREAT/GOOD/BAD)별 탭 소리 재생 계획. 파일 앞부분만 쓰고 끝에 짧게 줄인다. */
export function tapSoundPlan(grade: 'perfect' | 'great' | 'good' | 'bad', fileDurationSec: number, config: TapSoundSettings = TAP_SOUND): TapSoundPlan {
  const entry = config.grades[grade];
  const sourceSec = Math.min(config.playMs / 1000, fileDurationSec);
  const playSec = sourceSec / entry.rate;
  const fadeSec = Math.min(config.fadeMs / 1000, playSec);
  return { rate: entry.rate, gain: entry.gain * config.fileGain, playSec, fadeStartSec: playSec - fadeSec };
}

/** 콤보 숫자의 불투명도: 평소에는 반투명, 팝 순간(scale 이 커졌을 때)에만 살짝 진해진다. */
export function comboOpacity(scale: number, popPeak: number, baseOpacity: number, popOpacity: number): number {
  if (!(popPeak > 1)) return baseOpacity;
  const factor = Math.min(1, Math.max(0, (scale - 1) / (popPeak - 1)));
  return baseOpacity + (popOpacity - baseOpacity) * factor;
}

/** 이펙트가 나오는 등급인지 (MISS 는 이펙트 없음) */
export function hasHitFx(grade: Grade): grade is Exclude<Grade, 'miss'> {
  return grade !== 'miss';
}

/** 시간 진행도 (0~1). 지속 시간이 0 이면 1 */
export function progressOf(nowMs: number, startMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return 1;
  return Math.min(1, Math.max(0, (nowMs - startMs) / durationMs));
}

/** 부드럽게 줄어드는 곡선 (1 → 0). 이펙트 투명도·크기에 쓴다 */
export function easeOutFade(progress: number): number {
  const rest = 1 - Math.min(1, Math.max(0, progress));
  return rest * rest;
}

/** 부드럽게 퍼지는 곡선 (0 → 1) */
export function easeOutExpand(progress: number): number {
  const rest = 1 - Math.min(1, Math.max(0, progress));
  return 1 - rest * rest * rest;
}

/** 콤보 숫자가 늘었을 때의 팝 배율: 커졌다가 팝 시간 안에 1 로 돌아온다. */
export function comboPopScale(sinceChangeMs: number, popMs: number, peak: number): number {
  if (sinceChangeMs < 0 || sinceChangeMs >= popMs) return 1;
  const rest = 1 - sinceChangeMs / popMs;
  return 1 + (peak - 1) * rest * rest;
}

/** 콤보 표시 상태: 값이 늘면 팝 시작 시각을 기록하고, 줄거나 끊기면 팝을 멈춘다. */
export class ComboTracker {
  private lastCombo = 0;
  private changedAtMs = -Infinity;

  /**
   * 지금 콤보를 알려 주고 (표시 여부, 팝 배율)을 돌려받는다.
   * quiet 가 true 이면(롱노트 틱으로 늘어난 경우) 10 단위마다만 튀고 나머지는 조용히 숫자만 바뀐다 (04-H).
   */
  update(combo: number, nowMs: number, minShow: number, popMs: number, peak: number, quiet = false): { visible: boolean; scale: number } {
    if (combo > this.lastCombo && (!quiet || combo % 10 === 0)) this.changedAtMs = nowMs;
    if (combo < this.lastCombo) this.changedAtMs = -Infinity;
    this.lastCombo = combo;
    return { visible: combo >= minShow, scale: comboPopScale(nowMs - this.changedAtMs, popMs, peak) };
  }

  reset(): void {
    this.lastCombo = 0;
    this.changedAtMs = -Infinity;
  }
}

/** 피버가 켜지고 꺼지는 순간을 알아낸다. */
export class FeverEdge {
  private active = false;

  /** 지금 피버 상태를 알려 주면 바뀐 순간에만 'start' / 'end' 를 돌려준다. */
  update(active: boolean): 'start' | 'end' | null {
    if (active === this.active) return null;
    this.active = active;
    return active ? 'start' : 'end';
  }

  reset(): void {
    this.active = false;
  }
}

/** 피버 발광 단계(0~1)를 dtMs 만큼 진행한다: 켜지면 riseMs 동안 1까지, 꺼지면 fallMs 동안 0까지 부드럽게 변한다. */
export function feverRamp(current: number, active: boolean, dtMs: number, riseMs: number, fallMs: number): number {
  if (active) return Math.min(1, current + dtMs / riseMs);
  return Math.max(0, current - dtMs / fallMs);
}

/** 피버 중 숨 쉬는 배율: 시간에 따라 (1 - depth) ~ 1 사이를 사인 곡선으로 천천히 오간다. */
export function feverBreath(nowMs: number, periodMs: number, depth: number): number {
  const wave = 0.5 + 0.5 * Math.sin((nowMs / periodMs) * Math.PI * 2);
  return 1 - depth + depth * wave;
}

/** 지금 화면 발광 세기(0~1) = 올라가는 단계 × 숨 쉬는 배율. 꺼지는 중에도 같은 곡선으로 이어져 갑작스러운 변화가 없다. */
export function feverGlowLevel(ramp: number, nowMs: number, periodMs: number, depth: number): number {
  return ramp * feverBreath(nowMs, periodMs, depth);
}

/** 발동 플래시 계획: 이펙트 양이 "적게"이고 끄기 설정이면 null, 아니면 최대 불투명도와 지속 시간 */
export function feverFlashPlan(level: EffectLevel, peak: number, ms: number, offAtLow: boolean): { peak: number; ms: number } | null {
  if (offAtLow && level === 'low') return null;
  return { peak, ms };
}
