import type { TFunction } from 'i18next';
import { isWowWorkError } from './wowWorkApi';

// ============================================================
// 실패 → 화면에 보여 줄 문구
//   서버가 준 문구가 있으면 그대로, 없으면 연결 문제인지에 따라 기본 문구
// ============================================================
export function workErrorText(e: unknown, t: TFunction): string {
  if (isWowWorkError(e)) {
    if (e.message) return e.message;
    if (e.network) return t('mobile.wow.error.network');
  }
  return t('mobile.wow.error.unknown');
}
