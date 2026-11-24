import type { PendingRow } from '../../../storage/types';

// ============================================================
// /m/putaway 서버 호출 — PC [작업중] 과 같은 API 를 그대로 쓴다
//
//   fetchPendingRows : GET  /api/ft/storage/pending  (미배치가 남은 입고 줄 — 전체 사업자)
//   postPutaway      : POST /api/ft/storage/putaway  (위치에 배치)
//
//   배치는 같은 요청을 두 번 보내면 두 번 배치되므로 여기서 다시 보내지 않는다.
//   대신 결과를 셋으로 나눠 돌려주고, 저장 여부를 모를 때의 확인은 부르는 쪽이 한다.
// ============================================================

const PENDING_API = '/api/ft/storage/pending';
const PUTAWAY_API = '/api/ft/storage/putaway';

/** 서버 오류로 보는 응답 번호의 시작 — 이때는 저장됐는지 알 수 없다 */
const SERVER_ERROR_STATUS = 500;

// ============================================================
// 조회
// ============================================================

// ── 실패하면 던진다 (문구는 부르는 쪽이 정한다) ──
export async function fetchPendingRows(): Promise<PendingRow[]> {
  const res = await fetch(PENDING_API, { cache: 'no-store' });
  const body = (await res.json()) as { success?: boolean; error?: string; data?: PendingRow[] };
  if (!res.ok || !body.success) throw new Error(body.error || PENDING_API);
  return body.data ?? [];
}

// ============================================================
// 배치
// ============================================================
export interface PutawayInput {
  user_id: string;
  product_id: string;
  /** 기록용 — 미배치가 남은 가장 오래된 입고 줄 */
  inbound_id: string;
  location_code: string;
  qty: number;
  operator_name: string;
}

export type PutawayResult =
  /** 저장됨 — remaining 은 그 상품의 남은 미배치 (서버가 주지 않았으면 null) */
  | { kind: 'saved'; locationCode: string; remaining: number | null }
  /** 서버가 거절함 (저장 안 됨) — message 는 화면에 그대로 보여 줄 문구 */
  | { kind: 'rejected'; message: string }
  /** 연결이 끊겼거나 서버 오류 — 저장됐는지 알 수 없다 */
  | { kind: 'unsure'; message: string };

interface PutawayBody {
  success?: boolean;
  error?: string;
  location_code?: string;
  remaining?: number;
}

export async function postPutaway(input: PutawayInput): Promise<PutawayResult> {
  let res: Response;
  try {
    res = await fetch(PUTAWAY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch (err) {
    console.error('위치 배치 요청 오류:', err);
    return { kind: 'unsure', message: '' };
  }

  let body: PutawayBody | null = null;
  try {
    body = (await res.json()) as PutawayBody;
  } catch {
    body = null;
  }

  if (res.status >= SERVER_ERROR_STATUS || !body) return { kind: 'unsure', message: body?.error ?? '' };
  if (!res.ok || !body.success) return { kind: 'rejected', message: body.error ?? '' };
  return {
    kind: 'saved',
    locationCode: body.location_code ?? input.location_code,
    remaining: typeof body.remaining === 'number' ? body.remaining : null,
  };
}
