// 플레이 진행 단계와 카운트다운·일시정지 시간 처리 (순수 로직, 브라우저 코드 없음).
// 시간은 모두 호출하는 쪽이 넘겨준다 (실제로는 performance.now, 곡 시간은 오디오 시계).

/** 플레이 단계 */
export type PlayPhase =
  | 'loading' // 곡·채보 불러오는 중
  | 'ready' // 시작 준비 화면 (속도·시작 위치 고르기)
  | 'countdown' // 시작 전 3·2·1
  | 'playing'
  | 'paused'
  | 'resuming' // 이어하기 뒤 3·2·1
  | 'cleared' // 끝까지 감 (결과 화면)
  | 'failed' // 부정수치 100% (결과 화면, 연습 모드가 아닐 때만)
  | 'error'; // 불러오기 실패

/** 카운트다운에서 지금 보여 줄 숫자. 끝났으면 0 */
export function countdownNumber(elapsedMs: number, totalSec: number): number {
  const remainingMs = totalSec * 1000 - elapsedMs;
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / 1000);
}

/** 카운트다운이 끝났는지 */
export function countdownFinished(elapsedMs: number, totalSec: number): boolean {
  return elapsedMs >= totalSec * 1000;
}

/** 곡 시간이 끝에 닿았는지 */
export function reachedSegmentEnd(songMs: number, segmentEndMs: number): boolean {
  return songMs >= segmentEndMs;
}

/** 곡 진행 막대 비율 (0~1). 시작이 0, 끝이 1 */
export function segmentProgress(songMs: number, segmentStartMs: number, segmentEndMs: number): number {
  const length = segmentEndMs - segmentStartMs;
  if (!(length > 0)) return 0;
  return Math.min(1, Math.max(0, (songMs - segmentStartMs) / length));
}

/**
 * 플레이 단계 관리: 단계 이동과, 일시정지 때 멈춘 곡 시간을 기억한다.
 * 규칙에 어긋나는 이동(예: 불러오는 중에 일시정지)은 무시하고 false 를 돌려준다.
 */
export class PlayFlow {
  private current: PlayPhase = 'loading';
  private phaseStartMs = 0;
  private frozenSongMs = 0;
  private resumeTarget: PlayPhase = 'playing';

  /** 지금 단계 */
  get phase(): PlayPhase {
    return this.current;
  }

  /** 일시정지·카운트다운 동안 멈춰 있는 곡 시간 (ms) */
  get frozenMs(): number {
    return this.frozenSongMs;
  }

  /** 지금 단계가 시작된 뒤 흐른 시간 (ms) */
  elapsedMs(nowMs: number): number {
    return nowMs - this.phaseStartMs;
  }

  /** 시작 준비 화면으로 들어간다 (불러오기가 끝났다) */
  enterReady(nowMs: number): boolean {
    if (this.current !== 'loading') return false;
    this.enter('ready', nowMs);
    return true;
  }

  /** 곡과 채보를 다 불러왔다 → 시작 카운트다운. 멈춰 있을 곡 시간(구간 시작)을 함께 받는다. */
  startCountdown(nowMs: number, startSongMs: number): boolean {
    if (this.current !== 'loading' && this.current !== 'ready' && this.current !== 'cleared' && this.current !== 'failed' && this.current !== 'paused') return false;
    this.enter('countdown', nowMs);
    this.frozenSongMs = startSongMs;
    return true;
  }

  /** 카운트다운이 끝났다 → 재생 */
  beginPlaying(nowMs: number): boolean {
    if (this.current !== 'countdown' && this.current !== 'resuming') return false;
    this.enter('playing', nowMs);
    return true;
  }

  /** 일시정지. 멈춘 곡 시간을 기억한다. 재생 중이거나 카운트다운 중일 때만 된다. */
  pause(nowMs: number, songMs: number): boolean {
    if (this.current === 'playing') {
      this.frozenSongMs = songMs;
    } else if (this.current !== 'countdown' && this.current !== 'resuming') {
      return false;
    }
    this.resumeTarget = this.current === 'countdown' ? 'countdown' : 'playing';
    this.enter('paused', nowMs);
    return true;
  }

  /** 이어하기 → 3·2·1 카운트. 처음 카운트다운 중에 멈췄다면 처음 카운트다운을 다시 한다. */
  resume(nowMs: number): boolean {
    if (this.current !== 'paused') return false;
    this.enter(this.resumeTarget === 'countdown' ? 'countdown' : 'resuming', nowMs);
    return true;
  }

  /** 끝났다 (클리어 또는 실패) */
  finish(nowMs: number, cleared: boolean): boolean {
    if (this.current !== 'playing') return false;
    this.enter(cleared ? 'cleared' : 'failed', nowMs);
    return true;
  }

  /** 불러오기 실패 */
  fail(nowMs: number): void {
    this.enter('error', nowMs);
  }

  /** 다시하기: 처음 상태(불러오기 끝난 뒤)로 돌아간다. */
  restart(nowMs: number, startSongMs: number): void {
    this.enter('countdown', nowMs);
    this.frozenSongMs = startSongMs;
  }

  private enter(phase: PlayPhase, nowMs: number): void {
    this.current = phase;
    this.phaseStartMs = nowMs;
  }
}

/** 부정수치 게이지 색 (낮을수록 핫핑크, 높을수록 붉게). 0~100(%) → "rgb(r, g, b)" 글자 */
export function negativeGaugeColor(percent: number, low: readonly number[], high: readonly number[]): string {
  const t = Math.min(1, Math.max(0, percent / 100));
  const channel = (i: number): number => Math.round(low[i]! + (high[i]! - low[i]!) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/** 점수를 1,000,000 처럼 쉼표로 읽기 쉽게 만든다 (소수는 반올림) */
export function formatScore(score: number): string {
  return Math.round(score).toLocaleString('en-US');
}
