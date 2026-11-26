// [싱크 맞추기] 실행기(브라우저): 60BPM 박자 소리를 16번 정확한 시각에 예약해 들려주고, 사용자의 누름(터치·키)을
// "들리는 시계"(audioHeardClock, 게임 화면·판정과 같은 기준)로 박자 시각과 비교한다. 계산은 syncCalibration.ts(순수 함수).
import { AudioHeardClock } from './audioHeardClock';
import type { SfxPlayer } from './sfx';
import { BEAT_INTERVAL_SEC, SYNC_CONFIG, beatTimes, computeCalibration, matchPress, type CalibrationResult } from './syncCalibration';

export interface SyncRunnerHooks {
  /** 누름이 박에 붙을 때마다(진행 표시용): 지금까지 붙은 박 수 */
  onProgress: (counted: number, total: number) => void;
  /** 끝났다(취소가 아닌 경우) */
  onDone: (result: CalibrationResult) => void;
}

export class SyncRunner {
  private readonly context: AudioContext;
  private readonly sfx: SfxPlayer;
  private readonly hooks: SyncRunnerHooks;
  private readonly heard: AudioHeardClock;
  private offsets: Array<number | null> = Array.from({ length: SYNC_CONFIG.beats }, () => null);
  private sources: AudioBufferSourceNode[] = [];
  private firstBeatSec = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private counted = 0;

  constructor(context: AudioContext, sfx: SfxPlayer, hooks: SyncRunnerHooks) {
    this.context = context;
    this.sfx = sfx;
    this.hooks = hooks;
    this.heard = new AudioHeardClock(context);
  }

  /** 시작한다: 박자 소리를 예약하고 누름 받기를 켠다 */
  async start(): Promise<void> {
    if (this.running) return;
    if (this.context.state === 'suspended') await this.context.resume();
    this.heard.reset();
    this.offsets = Array.from({ length: SYNC_CONFIG.beats }, () => null);
    this.counted = 0;
    this.firstBeatSec = this.context.currentTime + SYNC_CONFIG.leadSec;
    this.sources = [];
    for (const t of beatTimes(this.firstBeatSec)) {
      const source = this.sfx.playAt('countTick', t);
      if (source !== null) this.sources.push(source);
    }
    this.running = true;
    window.addEventListener('pointerdown', this.onPointer, true);
    window.addEventListener('keydown', this.onKey, true);
    // 시계 표본을 자주 모아 부드럽게 만든다. 마지막 박 뒤 조금 더 기다렸다가 끝낸다
    const endSec = this.firstBeatSec + (SYNC_CONFIG.beats - 1) * BEAT_INTERVAL_SEC + 0.8;
    this.timer = setInterval(() => {
      this.heard.sample();
      if (this.context.currentTime >= endSec) this.finish();
    }, 40);
  }

  /** 취소한다(결과 없음) */
  cancel(): void {
    this.teardown();
  }

  private finish(): void {
    if (!this.running) return;
    this.teardown();
    this.hooks.onDone(computeCalibration(this.offsets));
  }

  private teardown(): void {
    this.running = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener('pointerdown', this.onPointer, true);
    window.removeEventListener('keydown', this.onKey, true);
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // 이미 끝난 소리면 무시
      }
    }
    this.sources = [];
  }

  /** 누름 하나를 기록한다. timeStamp 는 이벤트의 시각(performance.now 기준 ms) */
  private record(timeStamp: number): void {
    this.heard.sample();
    const heardSec = this.heard.heardContextSec(timeStamp);
    const hit = matchPress(heardSec, this.firstBeatSec);
    if (hit === null || this.offsets[hit.index] !== null) return; // 박 범위 밖이거나 같은 박에 이미 눌렀다
    this.offsets[hit.index] = hit.offsetMs;
    this.counted += 1;
    this.hooks.onProgress(this.counted, SYNC_CONFIG.beats);
  }

  private readonly onPointer = (event: PointerEvent): void => {
    const target = event.target as Element | null;
    if (target?.closest('button')) return; // [취소] 같은 버튼 누름은 박자 누름으로 세지 않는다
    this.record(event.timeStamp);
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') return;
    if (event.code === 'Space' || event.code === 'Enter') event.preventDefault(); // 포커스된 버튼이 눌리지 않게
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    this.record(event.timeStamp);
  };
}
