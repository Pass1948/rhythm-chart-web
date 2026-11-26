// 설정(settingsStore 의 AppSettings)을 게임 수치(GameConfig)로 바꾼다. 편집기 [테스트]와 플레이 화면이 같은 값을 쓰는 한 곳.
import type { AppSettings } from '../storage/settingsStore.ts';
import { GAME_CONFIG, type GameConfig } from './core/config/gameConfig';
import { applyPlayJudgeToConfig } from './playOptions';

/** 설정에서 게임 수치 복사본을 만든다. 입력 지연·낙하 시간·키·음악/효과음 볼륨·판정 설정이 설정 값과 같아진다. */
export function gameConfigFromSettings(settings: AppSettings): GameConfig {
  const config = structuredClone(GAME_CONFIG);
  config.timing.inputDelayMs = settings.inputDelayMs;
  config.timing.fallTimeMs = settings.fallTimeMs;
  config.input.keyLeft = settings.keys.left;
  config.input.keyRight = settings.keys.right;
  config.audio.masterVolume = 100;
  config.audio.musicVolume = settings.musicVolume;
  config.audio.sfxVolume = settings.sfxVolume;
  // 04b: 게임 화면 테스트 판정 설정(폭·점수 비율). 기본값이면 원본 값과 같다
  applyPlayJudgeToConfig(config, settings.playJudge);
  return config;
}
