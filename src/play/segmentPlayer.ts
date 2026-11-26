// 구간 재생기: 곡의 원하는 지점(곡 시간)부터 재생하고, 멈췄다가 같은 지점에서 다시 이어 재생한다.
// 시간 기준은 AudioContext 시계이며, 재생 속도(rate)를 지원한다. 계산은 playClock.ts(순수 함수)를 쓴다.
// 08: 화면 그리기(nowSongMs)와 판정(inputEventToSongMs)이 모두 "들리는 곡 시간" 하나(heardSongMsAt)를 쓴다.
//     소리를 내보내는 시점이 아니라 귀에 들리는 시점(getOutputTimestamp 기준, 부드럽게 다듬음)이라 블루투스처럼 출력 지연이 커도 화면과 판정이 같이 움직인다.
import { songMsFromContext, planStart, applyInputDelayRate } from './playClock';
import { AudioHeardClock } from './audioHeardClock';
import { NeverBackwards } from './heardClock';
import type { GameConfig } from './core/config/gameConfig';
import { VOLUME_CONFIG } from './playOptions';

/** 시작을 이만큼(초) 뒤로 예약해서 시작 순간의 끊김을 피한다 */
const START_LEAD_SEC = 0.1;

export class SegmentPlayer {
  private source: AudioBufferSourceNode | null = null;
  private readonly gain: GainNode;
  /** 음원 위치 0 이 재생되었을 AudioContext 시간(초). 곡 시간 변환의 기준 */
  private zeroContextSec = 0;
  private frozenSongMs = 0;
  private running = false;
  /** 들리는 시계(출력 지연 반영) */
  private readonly heard: AudioHeardClock;
  /** 화면용 곡 시간이 뒤로 가지 않게 */
  private readonly monotonic = new NeverBackwards();
  /** 마지막으로 정한 음악 크기 (점검용) */
  private targetVolume = 0;

  private readonly context: AudioContext;
  private readonly buffer: AudioBuffer;
  private readonly timing: GameConfig['timing'];
  /** 재생 속도 (0.5~1.25) */
  private readonly rate: number;

  constructor(context: AudioContext, buffer: AudioBuffer, timing: GameConfig['timing'], volume: number, rate: number = 1) {
    this.context = context;
    this.buffer = buffer;
    this.timing = timing;
    this.rate = rate;
    this.heard = new AudioHeardClock(context);
    this.heard.sample();
    this.gain = context.createGain();
    this.gain.gain.value = volume;
    this.targetVolume = volume;
    this.gain.connect(context.destination);
  }

  /** 곡 전체 길이 (ms) */
  get durationMs(): number {
    return this.buffer.duration * 1000;
  }

  /**
   * 음악 크기 (0~1, 슬라이더 곡선·음소거가 이미 반영된 값). 재생 도중에도 바로 적용된다.
   * HTMLMediaElement.volume 이 아니라 Web Audio GainNode 로 조절하므로 iPhone(사파리)에서도 동작한다.
   * 튀는 소리가 나지 않게 0.02초 정도의 시간 상수로 부드럽게 따라간다. 재생 속도·싱크(AudioContext 시계)에는 영향이 없다.
   */
  setVolume(volume: number): void {
    const v = Math.max(0, Math.min(1, volume));
    this.targetVolume = v;
    const param = this.gain.gain;
    const now = this.context.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(v, now, VOLUME_CONFIG.smoothSec);
  }

  /** 마지막으로 정한 음악 크기 (점검용) */
  get volume(): number {
    return this.targetVolume;
  }

  /** 지금 재생 중인지 */
  get playing(): boolean {
    return this.running;
  }

  /** 입력 지연 보정값(ms)을 바꾼다 (플레이 중 설정 변경용) */
  setInputDelay(ms: number): void {
    this.timing.inputDelayMs = ms;
  }

  /** 곡 시간(ms)부터 재생을 시작한다. 이미 재생 중이면 멈추고 그 지점에서 다시 시작한다. */
  async startAt(songMs: number): Promise<void> {
    this.stopSource();
    if (this.context.state === 'suspended') await this.context.resume();
    const plan = planStart(songMs, this.rate, this.timing.audioStartOffsetMs, this.context.currentTime, START_LEAD_SEC);
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = this.rate;
    source.connect(this.gain);
    source.start(plan.startContextSec, plan.bufferOffsetSec);
    this.zeroContextSec = plan.zeroContextSec;
    this.source = source;
    this.frozenSongMs = songMs;
    this.running = true;
    this.heard.reset(); // 출력 장치가 소리를 내기 시작하면 지연 값이 달라질 수 있어 새로 구한다
    this.monotonic.reset();
  }

  /** 멈춘다 (일시정지). 멈춘 순간의 곡 시간(ms)을 돌려준다. */
  pause(): number {
    if (this.running) this.frozenSongMs = this.nowSongMs();
    this.stopSource();
    this.running = false;
    this.monotonic.reset();
    return this.frozenSongMs;
  }

  /** 완전히 멈춘다 (끝·나가기). */
  stop(): void {
    this.stopSource();
    this.running = false;
    this.monotonic.reset();
  }

  /** 정리한다. */
  dispose(): void {
    this.stop();
    this.gain.disconnect();
  }

  /**
   * "들리는 곡 시간" 하나: performance.now 기준 시각(ms)에 귀에 들리는 곡 시간(입력 지연 보정 전).
   * 화면(nowSongMs)과 판정(inputEventToSongMs)이 모두 이 함수를 거친다.
   */
  private heardSongMsAt(perfMs: number): number {
    return songMsFromContext(this.heard.heardContextSec(perfMs), this.zeroContextSec, this.rate, this.timing.audioStartOffsetMs);
  }

  /**
   * 지금 곡 시간 (ms) — 귀에 들리는 시점 기준. 멈춰 있으면 멈춘 값. 재생 중에는 뒤로 가지 않는다.
   * 시작 예약 구간(0.1초)에서는 시작 지점보다 조금 작은 값이 나온다.
   */
  nowSongMs(): number {
    if (!this.running) return this.frozenSongMs;
    this.heard.sample();
    return this.monotonic.next(this.heardSongMsAt(performance.now()));
  }

  /** 기기 소리 지연 추정(ms): 소리를 내보낸 시점과 들리는 시점의 차이 (판정 상세 표시용) */
  outputDelayMs(): number {
    return this.heard.latencyMs();
  }

  /**
   * 입력 이벤트의 timeStamp(performance.now 기준, ms)를 입력 지연 보정까지 적용한 곡 시간(ms)으로 바꾼다.
   * 화면과 같은 "들리는 곡 시간"을 쓴다. getOutputTimestamp 가 없거나 0 이면 currentTime − 출력 지연으로 대신한다(audioHeardClock).
   */
  inputEventToSongMs(eventTimeStampMs: number): number {
    this.heard.sample();
    return applyInputDelayRate(this.heardSongMsAt(eventTimeStampMs), this.timing.inputDelayMs, this.rate);
  }

  private stopSource(): void {
    if (this.source === null) return;
    try {
      this.source.stop();
    } catch {
      // 이미 멈춘 소리면 무시
    }
    this.source.disconnect();
    this.source = null;
  }
}
