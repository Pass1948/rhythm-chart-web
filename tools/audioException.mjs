// 04g: dist 의 "음원 없음" 검사에서 사용자가 준 효과음 한 개만 예외로 허용한다(이름·크기 고정).
export const AUDIO_EXCEPTION = { path: 'sfx/TapSound.wav', maxBytes: 200 * 1024 };
export function isAllowedAudio(path, size) {
  return path === AUDIO_EXCEPTION.path && size <= AUDIO_EXCEPTION.maxBytes;
}
