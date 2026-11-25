import { supabase } from './supabase';

// ============================================================
// 쉽먼트 작업 (작업시작 → 작업취소 | 출고) — supabase/shipment/004_shipment_work.sql
//
//   사업자마다 열린 작업은 하나. 작업 중에는 그 사업자의 출고 대기 목록이 얼어 있다.
//     · 담는 쪽(상품출고 V2 저장 · 포장 철회 · 재고 [쉽먼트] · 와우출고 출고준비)은 DB 가 막는다 → SHIPMENT_WORK_LOCKED
//     · 쉽먼트 쪽(이동 · 생성 · 출고)은 작업 중일 때만 — 여기 requireShipmentWork 로 API 가 본다
//       (DB 함수에서 막지 않는 까닭은 004 스크립트 머리말 참고)
// ============================================================

/** 지금 열려 있는 쉽먼트 작업 */
export interface ShipmentWork {
  id: string;
  user_id: string;
  started_at: string;
  started_by: string;
}

/** DB 오류 코드 → 화면 문구 */
export const SHIPMENT_WORK_MESSAGE: Record<string, string> = {
  SHIPMENT_WORK_LOCKED:
    '쉽먼트 작업 중이라 박스에 담거나 뺄 수 없습니다. 쉽먼트 V2 에서 [출고] 또는 [작업취소] 를 한 뒤 다시 시도해 주세요.',
  SHIPMENT_WORK_NOT_STARTED: '쉽먼트 작업 중이 아닙니다. 쉽먼트 V2 에서 [작업시작] 을 먼저 눌러 주세요.',
  SHIPMENT_WORK_ALREADY_STARTED: '이미 쉽먼트 작업 중입니다. 새로고침 후 확인하세요.',
  SHIPMENT_WORK_INVALID_INPUT: '사용자와 처리 담당자를 선택해 주세요.',
};

/** DB 오류 글에 쉽먼트 작업 코드가 들어 있으면 { code, message }, 아니면 null */
export function toShipmentWorkError(raw: unknown): { code: string; message: string } | null {
  const text = typeof raw === 'string' ? raw : String((raw as { message?: unknown } | null)?.message ?? '');
  const code = Object.keys(SHIPMENT_WORK_MESSAGE).find((k) => text.includes(k));
  return code ? { code, message: SHIPMENT_WORK_MESSAGE[code] } : null;
}

// ── 그 사업자의 열린 작업 (없으면 null) ──
export async function getOpenShipmentWork(userId: string): Promise<ShipmentWork | null> {
  const { data, error } = await supabase
    .from('ft_shipment_works')
    .select('id, user_id, started_at, started_by')
    .eq('user_id', userId)
    .is('ended_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data as ShipmentWork | null) ?? null;
}

// ── 쉽먼트 쪽 API 의 문지기 — 작업 중이 아니면 화면 문구를 돌려준다 (작업 중이면 null) ──
export async function requireShipmentWork(userId: string): Promise<string | null> {
  return (await getOpenShipmentWork(userId)) ? null : SHIPMENT_WORK_MESSAGE.SHIPMENT_WORK_NOT_STARTED;
}
