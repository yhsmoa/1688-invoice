// ============================================================
// 작업 소리 — 화면을 보지 않아도 결과를 알 수 있게 짧은 비프음
//   모바일 작업 화면 공용 (/m/wow · /m/putaway)
//   · playOkSound    : 찾음 · 박스 열림 · 작업완료 · 라벨 읽음 · 배치 저장 (올라가는 두 음)
//   · playShortSound : 몫보다 적게 꺼냄 · 부족 확인 (내려가는 두 음)
//   경고음은 app/storage/utils/storageFormat.ts 의 playErrorSound 를 쓴다
// ============================================================

/** 한 번 울리는 길이 · 음이 바뀌는 시점 (초) */
const BEEP_SECONDS = 0.26;
const BEEP_SWITCH_SECONDS = 0.12;
const BEEP_VOLUME = 0.4;

/** 올라가는 두 음 (미 → 라) */
const OK_TONES: [number, number] = [659.25, 880];
/** 내려가는 두 음 (라 → 미) */
const SHORT_TONES: [number, number] = [440, 330];

function playTwoTone(type: OscillatorType, [first, second]: [number, number]): void {
  try {
    const Ctx = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(first, ctx.currentTime);
    osc.frequency.setValueAtTime(second, ctx.currentTime + BEEP_SWITCH_SECONDS);
    gain.gain.value = BEEP_VOLUME;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => { ctx.close().catch(() => undefined); };
    osc.start();
    osc.stop(ctx.currentTime + BEEP_SECONDS);
  } catch (err) {
    console.error('작업 소리 재생 실패:', err);
  }
}

export const playOkSound = (): void => playTwoTone('sine', OK_TONES);
export const playShortSound = (): void => playTwoTone('triangle', SHORT_TONES);
