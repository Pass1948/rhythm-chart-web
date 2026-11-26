/**
 * 분석 모드 모음(01b). 이 파일은 analyze.ts 가 불러오면서 모드를 등록소(modeRegistry)에 등록한다(워커 안에서도 실행된다).
 *  - hybrid(종합)·bass(베이스·킥): 01a 의 검출기를 그대로 쓰므로 등록하지 않는다.
 *  - drums(드럼 중심)·melody(멜로디 중심)·vocal(보컬 근사): 여기서 등록한다. 모두 '근사'이며 악기를 실제로 분리하지 않는다.
 * 화면 쪽에서 쓰는 도우미(스테레오 디코딩, mode 필드 붙이기)는 `modes/api.ts` 에 따로 있다(워커 묶음에 화면 코드가 섞이지 않게).
 */
import { registerMode } from '../modeRegistry.ts';
import { detectDrums } from './drums.ts';
import { detectMelody } from './melody.ts';
import { detectVocal } from './vocal.ts';

registerMode('drums', detectDrums);
registerMode('melody', detectMelody);
registerMode('vocal', detectVocal);
