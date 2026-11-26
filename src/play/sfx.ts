// 효과음 재생기: 합성음과 탭 소리 파일을 미리 준비해 두고, 필요할 때 바로 재생한다. 곡 시계와 무관하게 이벤트 즉시 재생이라 곡 싱크를 밀지 않는다.
// 소리가 한꺼번에 겹치면 압축기를 거치고, 동시 재생 수 상한을 넘으면 새 소리는 건너뛴다.
import { SFX_CONFIG, SFX_SOURCES } from './effectConfig';
import { tapSoundPlan } from './effectLogic';
import { SFX_DESIGNS, SFX_NAMES, renderSfx, sfxGain, type SfxName } from './sfxSynth';
import { VOLUME_CONFIG } from './playOptions';
import { loadTapBuffer } from './tapSoundLoad';
import { TAP_SOUND_URL } from './tapSoundData';

/** 탭 소리 파일을 쓰는 효과음 이름 → 등급 */
const TAP_GRADE: Partial<Record<SfxName, 'perfect' | 'great' | 'good' | 'bad'>> = {
  hitPerfect: 'perfect',
  hitGreat: 'great',
  hitGood: 'good',
  hitBad: 'bad',
};

export type SfxFileStatus = 'none' | 'loaded' | 'failed';

export class SfxPlayer {
  private readonly buffers = new Map<SfxName, AudioBuffer>();
  private tapBuffer: AudioBuffer | null = null;
  /** 탭 소리 파일을 읽은 결과 (점검용) */
  fileStatus: SfxFileStatus = 'none';
  /** 소리 이름별로 재생한 횟수 (점검용) */
  readonly playedByName: Partial<Record<SfxName, number>> = {};
  /** 탭 소리 파일로 재생한 횟수 / 합성음으로 대신 재생한 횟수 (점검용) */
  filePlays = 0;
  synthPlays = 0;
  private readonly master: GainNode;
  private readonly compressor: DynamicsCompressorNode;
  private voices = 0;
  private targetGain = 0;
  /** 점검용 기록 */
  played = 0;
  dropped = 0;
  private lastName: SfxName | null = null;
  /** 마지막 롱노트 틱 소리를 낸 시각 (오디오 시계, 초) */
  private lastTickSec = -Infinity;

  private readonly context: AudioContext;

  constructor(
    context: AudioContext,
    masterVolume: number,
    sfxVolume: number,
    tapSource: string | null = TAP_SOUND_URL,
  ) {
    this.context = context;
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -12;
    this.compressor.ratio.value = 6;
    this.master = context.createGain();
    this.targetGain = sfxGain(masterVolume, sfxVolume, SFX_CONFIG.baseGain);
    this.master.gain.value = this.targetGain;
    this.master.connect(this.compressor);
    this.compressor.connect(context.destination);
    for (const name of SFX_NAMES) {
      const data = renderSfx(SFX_DESIGNS[name], context.sampleRate, SFX_CONFIG.voicePeak);
      const buffer = context.createBuffer(1, data.length, context.sampleRate);
      buffer.copyToChannel(data, 0);
      this.buffers.set(name, buffer);
    }
    // 탭 소리 파일은 한 번 비동기로 읽는다. 끝나기 전·실패하면 합성음으로 재생한다.
    if (tapSource !== null) {
      loadTapBuffer(context, tapSource).then(
        (buf) => {
          this.tapBuffer = buf;
          this.fileStatus = 'loaded';
        },
        () => {
          this.fileStatus = 'failed';
        },
      );
    }
  }

  /** 마지막으로 정한 효과음 크기 배율 (부드럽게 따라가는 중이어도 목표값을 돌려준다) */
  get gain(): number {
    return this.targetGain;
  }

  /** 효과음 크기를 바꾼다. 재생 도중에도 바로 적용되며, 소리가 갑자기 커지지 않게 0.02초 정도의 시간 상수로 부드럽게 따라간다. */
  setVolume(masterVolume: number, sfxVolume: number): void {
    const target = sfxGain(masterVolume, sfxVolume, SFX_CONFIG.baseGain);
    this.targetGain = target;
    const param = this.master.gain;
    const now = this.context.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(target, now, VOLUME_CONFIG.smoothSec);
  }

  /** 소리 하나를 바로 재생한다. 동시 재생 상한이면 건너뛴다. */
  play(name: SfxName): void {
    if (this.context.state === 'suspended') void this.context.resume();
    if (name === 'holdTick') {
      // 틱 소리는 최소 간격(60ms)보다 가깝게 연달아 내지 않는다
      const nowSec = this.context.currentTime;
      if ((nowSec - this.lastTickSec) * 1000 < SFX_CONFIG.tickMinIntervalMs) return;
      this.lastTickSec = nowSec;
    }
    if (this.voices >= SFX_CONFIG.maxVoices) {
      this.dropped += 1;
      return;
    }
    const tapGrade = TAP_GRADE[name];
    if (SFX_SOURCES[name] === 'tapFile' && tapGrade !== undefined && this.tapBuffer !== null) {
      this.playTap(tapGrade, this.tapBuffer);
    } else {
      const buffer = this.buffers.get(name);
      if (buffer === undefined) return;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.master);
      this.track(source, null);
      source.start();
      this.synthPlays += 1;
    }
    this.played += 1;
    this.playedByName[name] = (this.playedByName[name] ?? 0) + 1;
    this.lastName = name;
  }

  /**
   * 합성음 하나를 정해진 AudioContext 시각(초)에 재생하도록 예약한다([싱크 맞추기]의 박자 소리용). 만든 소리 노드를 돌려주어 취소할 수 있다.
   * 곡 싱크와 무관한 즉시 재생 규칙(play)과 달리 시각이 정확해야 하므로 탭 소리 파일은 쓰지 않고 합성음만 쓴다.
   */
  playAt(name: SfxName, whenSec: number): AudioBufferSourceNode | null {
    if (this.context.state === 'suspended') void this.context.resume();
    const buffer = this.buffers.get(name);
    if (buffer === undefined) return null;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master);
    this.track(source, null);
    source.start(Math.max(whenSec, this.context.currentTime));
    return source;
  }

  /** 탭 소리 파일의 앞부분을 등급별 속도·볼륨으로 재생하고 끝에 짧게 줄인다. */
  private playTap(grade: 'perfect' | 'great' | 'good' | 'bad', buffer: AudioBuffer): void {
    const plan = tapSoundPlan(grade, buffer.duration);
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = plan.rate;
    const voiceGain = this.context.createGain();
    voiceGain.gain.setValueAtTime(plan.gain, now);
    voiceGain.gain.setValueAtTime(plan.gain, now + plan.fadeStartSec);
    voiceGain.gain.linearRampToValueAtTime(0, now + plan.playSec);
    source.connect(voiceGain).connect(this.master);
    this.track(source, voiceGain);
    source.start(now);
    source.stop(now + plan.playSec);
    this.filePlays += 1;
  }

  /** 동시 재생 수를 세고, 끝나면 연결을 풀어 준다. */
  private track(source: AudioBufferSourceNode, extra: GainNode | null): void {
    this.voices += 1;
    source.addEventListener('ended', () => {
      this.voices -= 1;
      source.disconnect();
      extra?.disconnect();
    });
  }

  /** 마지막으로 재생한 소리 이름 (점검용) */
  get last(): SfxName | null {
    return this.lastName;
  }

  /** 정리한다. */
  dispose(): void {
    this.master.disconnect();
    this.compressor.disconnect();
  }
}
