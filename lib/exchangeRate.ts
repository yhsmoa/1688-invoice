// ============================================================
// exchangeRate — 금일 환율(원/위안) 조회 (클라이언트)
//
//   · 금액 기준은 위안. 원화 환산은 이용자가 대략 판단하기 위한 참고 표시이므로
//     과거 충전 환율이 아닌 **금일 환율**(/api/exchange-rate) 하나로 계산한다.
//     (참조 프로젝트 purchase-agent 와 동일 규칙 — 구 원장 충전 환율·전역 폴백 사용 안 함)
//   · 같은 페이지 로드에서 여러 곳이 호출해도 요청을 공유한다. 실패하면 다음 호출에서 재시도.
// ============================================================

export interface TodayRate {
  /** 1위안당 원화 */
  rate: number;
  /** 출처 기준 갱신 시각 (ISO) */
  updatedAt: string;
}

const ENDPOINT = '/api/exchange-rate';

// ── 요청 공유 (중복 호출 방지) ──
let pending: Promise<TodayRate> | null = null;

// ============================================================
// 금일 환율 조회 — 실패 시 throw (호출 측이 환산금액 미표시 처리)
// ============================================================
export function fetchTodayRate(): Promise<TodayRate> {
  if (pending) return pending;

  pending = (async () => {
    const res = await fetch(ENDPOINT);
    if (!res.ok) throw new Error(`환율 조회 실패 (HTTP ${res.status})`);
    const data = await res.json();
    const rate = Number(data?.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('환율 응답이 올바르지 않습니다');
    return { rate, updatedAt: String(data.updatedAt ?? '') };
  })();

  pending.catch(() => { pending = null; });
  return pending;
}
