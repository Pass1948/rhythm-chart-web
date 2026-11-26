// 사용자가 준 효과음 public\sfx\TapSound.wav 를 빌드에 base64 주소로 포함한다(파일 자체는 수정하지 않음). vite.config.ts 는 publicDir 를 꺼서 dist 에 파일이 따로 복사되지 않게 한다.
import url from '../../public/sfx/TapSound.wav?inline';

export const TAP_SOUND_URL: string = url;
