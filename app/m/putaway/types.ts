import type { PendingRow } from '../../storage/types';

// ============================================================
// /m/putaway 타입 — 서버 응답 타입은 app/storage/types.ts (PendingRow · LocationSuggestion) 를 그대로 쓴다
// ============================================================

/** 목록 한 줄 = 배치를 기다리는 상품 하나 (입고 줄 여러 개를 상품으로 묶은 것) */
export interface PendingProduct {
  product_id: string;
  /** 사업자 (ft_users.id) */
  user_id: string;
  /** 미배치가 남은 가장 오래된 입고 줄 — 상품 표시 정보 + 배치 기록에 남길 inbound_id */
  head: PendingRow;
  /** 미배치 합계 (세트상품은 세트 수) */
  unplaced: number;
}

/** 카메라로 읽어 달라는 요청 — 화면마다 받아들이는 값이 다르다 (주문번호 라벨 / 위치 라벨) */
export interface ScanRequest {
  /** 카메라 위에 보이는 안내 */
  hint: string;
  /** 읽었지만 받아들이지 않은 값의 안내 — {{value}} 를 그대로 둔 문장 */
  notMatched: string;
  /** 읽은 값 — true 면 받아들이고 카메라를 닫는다, false 면 계속 찾는다 */
  onCode: (text: string) => boolean;
}
