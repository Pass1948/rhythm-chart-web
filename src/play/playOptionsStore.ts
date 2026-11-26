// 게임 플레이 옵션의 "지금 값" 보관소: 볼륨(음악·효과음·음소거)과 판정 설정.
// 시작 전 창·일시정지 시트·PC 옆 패널이 같은 값을 보고, 한 곳에서 바꾸면 나머지 화면도 따라 바뀐다.
// 저장은 settingsStore(rcw.settings.v1)가 한다: musicVolume(편집기 음원 카드 볼륨과 같은 값), sfxVolume, playJudge.
// 음소거는 저장하지 않고 이번 화면을 여는 동안만 유지한다(풀면 이전 볼륨으로 돌아간다).
import { loadSettings, saveSettings } from '../storage/settingsStore.ts';
import { clampVolume, clonePlayJudge, defaultPlayJudge, sanitizePlayJudge, type PlayJudgeOptions, type PlayVolumes } from './playOptions';

/** 값을 읽고 쓰는 곳(시험에서는 메모리로 바꿔 끼운다) */
export interface OptionsIo {
  load(): { musicVolume: number; sfxVolume: number; playJudge: PlayJudgeOptions };
  save(patch: { musicVolume?: number; sfxVolume?: number; playJudge?: PlayJudgeOptions }): void;
}

/** 기본 입출력: settingsStore */
const settingsIo: OptionsIo = {
  load() {
    const s = loadSettings();
    return { musicVolume: s.musicVolume, sfxVolume: s.sfxVolume, playJudge: s.playJudge };
  },
  save(patch) {
    saveSettings(patch);
  },
};

type Unsubscribe = () => void;

/** 볼륨 보관소 */
export class VolumeStore {
  private vol: PlayVolumes;
  private readonly listeners = new Set<(v: PlayVolumes) => void>();
  private readonly io: OptionsIo;

  constructor(io: OptionsIo = settingsIo) {
    this.io = io;
    const s = io.load();
    this.vol = { music: clampVolume(s.musicVolume), sfx: clampVolume(s.sfxVolume), muted: false };
  }

  /** 지금 값(복사본) */
  get(): PlayVolumes {
    return { ...this.vol };
  }

  /** 저장된 값을 다시 읽는다(음소거는 그대로 둔다). 플레이 화면을 새로 열 때 부른다 */
  reload(): void {
    const s = this.io.load();
    this.vol = { music: clampVolume(s.musicVolume), sfx: clampVolume(s.sfxVolume), muted: this.vol.muted };
    this.notify();
  }

  /** 값을 바꾼다. 음악·효과음 값은 저장하고, 음소거는 저장하지 않는다 */
  set(patch: Partial<PlayVolumes>): void {
    const next: PlayVolumes = { ...this.vol };
    const save: { musicVolume?: number; sfxVolume?: number } = {};
    if (patch.music !== undefined) {
      next.music = clampVolume(patch.music, this.vol.music);
      save.musicVolume = next.music;
    }
    if (patch.sfx !== undefined) {
      next.sfx = clampVolume(patch.sfx, this.vol.sfx);
      save.sfxVolume = next.sfx;
    }
    if (patch.muted !== undefined) next.muted = patch.muted;
    this.vol = next;
    if (save.musicVolume !== undefined || save.sfxVolume !== undefined) this.io.save(save);
    this.notify();
  }

  /** 음소거를 켜고 끈다 */
  toggleMute(): boolean {
    this.set({ muted: !this.vol.muted });
    return this.vol.muted;
  }

  /** 값이 바뀔 때마다 부를 함수를 등록한다. 돌려주는 함수를 부르면 등록이 풀린다 */
  subscribe(fn: (v: PlayVolumes) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const v = this.get();
    for (const fn of [...this.listeners]) fn(v);
  }
}

/** 판정 설정 보관소 */
export class JudgeStore {
  private readonly listeners = new Set<(j: PlayJudgeOptions) => void>();
  private readonly io: OptionsIo;
  /** 저장소를 읽을 때 고친 내용(안내 문구). 한 번 알린 뒤 비운다 */
  private pendingNotes: string[] = [];

  constructor(io: OptionsIo = settingsIo) {
    this.io = io;
  }

  /** 저장된 값을 읽는다(없거나 깨졌으면 원본 기본값/가까운 값) */
  get(): PlayJudgeOptions {
    const fixed = sanitizePlayJudge(this.io.load().playJudge);
    return clonePlayJudge(fixed.value);
  }

  /** 바꾼 값을 저장하고 화면들에 알린다 (적용은 다음 시작부터: 플레이 도중에는 판정에 쓰이지 않는다) */
  set(next: PlayJudgeOptions): void {
    const fixed = sanitizePlayJudge(next).value;
    this.io.save({ playJudge: fixed });
    this.notify(fixed);
  }

  /** 원본 기본값으로 되돌린다 */
  reset(): PlayJudgeOptions {
    const d = defaultPlayJudge();
    this.set(d);
    return d;
  }

  /** 복구하며 생긴 안내를 가져가고 비운다 */
  takeNotes(): string[] {
    const n = this.pendingNotes;
    this.pendingNotes = [];
    return n;
  }

  /** 안내를 쌓는다(플레이 화면을 열 때 설정 파일에서 읽은 안내) */
  addNotes(notes: string[]): void {
    this.pendingNotes.push(...notes);
  }

  subscribe(fn: (j: PlayJudgeOptions) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(j: PlayJudgeOptions): void {
    for (const fn of [...this.listeners]) fn(clonePlayJudge(j));
  }
}

/** 화면 전체가 같이 쓰는 보관소 */
export const playVolume = new VolumeStore();
export const playJudge = new JudgeStore();
