/** 04g: 탭 소리 파일 읽기(base64 → 바이트), 실패 시 합성음 대체, tapFile 이름, checkDist 예외 */
import { describe, expect, it } from 'vitest';
// @ts-ignore 도구 JS
import { isAllowedAudio } from '../tools/audioException.mjs';
import { SFX_SOURCES } from '../src/play/effectConfig.ts';
import { SfxPlayer } from '../src/play/sfx.ts';
import { base64ToArrayBuffer, dataUrlToArrayBuffer } from '../src/play/tapSoundLoad.ts';
import { TAP_SOUND_URL } from '../src/play/tapSoundData.ts';

function fakeContext(decode: () => Promise<AudioBuffer>): AudioContext {
  const param = { value: 0, setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} };
  const node = () => ({ connect: (n: unknown) => n, disconnect() {}, gain: { ...param }, threshold: { ...param }, ratio: { ...param } });
  return {
    sampleRate: 44100, currentTime: 0, state: 'running', destination: {},
    createDynamicsCompressor: node, createGain: node,
    createBuffer: (_c: number, len: number) => ({ duration: len / 44100, copyToChannel() {} }),
    createBufferSource: () => ({ ...node(), playbackRate: { ...param }, start() {}, stop() {}, addEventListener() {} }),
    decodeAudioData: decode,
  } as unknown as AudioContext;
}

describe('탭 소리 파일(04g)', () => {
  it('base64 → 바이트 왕복이 정확하다', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 7, 128]);
    const b64 = btoa(String.fromCharCode(...bytes));
    expect([...new Uint8Array(base64ToArrayBuffer(b64))]).toEqual([...bytes]);
    expect([...new Uint8Array(dataUrlToArrayBuffer(`data:audio/wav;base64,${b64}`))]).toEqual([...bytes]);
    expect(() => dataUrlToArrayBuffer('http://x/y.wav')).toThrow();
  });
  it('빌드에 포함된 주소가 원본 WAV(RIFF) 그대로다', () => {
    const buf = new Uint8Array(dataUrlToArrayBuffer(TAP_SOUND_URL));
    expect(String.fromCharCode(...buf.slice(0, 4))).toBe('RIFF');
    expect(buf.length).toBe(164604);
  });
  it('읽기에 성공하면 loaded, 실패하면 failed 이고 합성음으로 대신 재생된다', async () => {
    const ok = new SfxPlayer(fakeContext(async () => ({ duration: 0.9 }) as AudioBuffer), 100, 80, 'data:audio/wav;base64,AAAA');
    await new Promise((r) => setTimeout(r, 0));
    expect(ok.fileStatus).toBe('loaded');
    ok.play('hitPerfect');
    expect(ok.filePlays).toBe(1);
    ok.play('miss'); // 합성음 그대로
    expect(ok.synthPlays).toBe(1);

    const bad = new SfxPlayer(fakeContext(async () => { throw new Error('x'); }), 100, 80, 'data:audio/wav;base64,AAAA');
    await new Promise((r) => setTimeout(r, 0));
    expect(bad.fileStatus).toBe('failed');
    bad.play('hitGreat');
    expect(bad.synthPlays).toBe(1);
    expect(bad.filePlays).toBe(0);
    // 읽기 전에 난 소리도 합성음
    const early = new SfxPlayer(fakeContext(() => new Promise(() => {})), 100, 80, 'data:audio/wav;base64,AAAA');
    early.play('hitGood');
    expect(early.synthPlays).toBe(1);
  });
  it('tapFile 인 소리는 단타 판정 4개뿐', () => {
    const names = Object.entries(SFX_SOURCES).filter(([, v]) => v === 'tapFile').map(([k]) => k).sort();
    expect(names).toEqual(['hitBad', 'hitGood', 'hitGreat', 'hitPerfect']);
  });
  it('checkDist 예외는 이 파일 하나(이름·200KB 이하)에만', () => {
    expect(isAllowedAudio('sfx/TapSound.wav', 164604)).toBe(true);
    expect(isAllowedAudio('sfx/TapSound.wav', 300 * 1024)).toBe(false);
    expect(isAllowedAudio('sfx/Other.wav', 1000)).toBe(false);
    expect(isAllowedAudio('song.mp3', 1000)).toBe(false);
  });
});
