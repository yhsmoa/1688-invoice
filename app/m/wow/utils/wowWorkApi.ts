import type { WowWorkBox, WowWorkDeck } from '../../../storage/types';

// ============================================================
// 와우출고 모바일 작업 — 서버 호출 (/api/ft/storage/wow/work)
//
//   fetchWorkBoxes : 작업할 박스 목록
//   fetchWorkDeck  : 박스 하나의 카드
//   postWork       : open(들어옴) · find(찾음/부족/취소) · memo · size(박스 크기 변경) · complete(작업완료)
//
//   실패는 모두 WowWorkError 로 던진다.
//     · network = true  : 연결이 끊겼거나 서버가 죽음 (보낸 내용이 저장됐는지 모른다)
//     · network = false : 서버가 내용을 거절함 — message 는 화면에 그대로 보여 줄 문구
// ============================================================

const WORK_API = '/api/ft/storage/wow/work';

/** 서버 오류로 보는 응답 번호의 시작 */
const SERVER_ERROR_STATUS = 500;
/** 없는 박스 */
const NOT_FOUND_STATUS = 404;
/** 이미 작업완료한 박스 (서버 오류 코드) */
const BOX_ALREADY_PICKED_CODE = 'WOW_BOX_ALREADY_PICKED';

/** 연결이 끊겼을 때 다시 보내기 전에 기다리는 시간 — n번째 재시도는 이 값 × n */
const RETRY_WAIT_MS = 400;
/** find · memo · size 는 같은 내용을 다시 보내도 결과가 같아서, 끊기면 이만큼 더 보낸다 */
export const SAVE_RETRIES = 2;

// ============================================================
// 오류
// ============================================================
export class WowWorkError extends Error {
  readonly code: string | null;
  readonly status: number | null;
  readonly network: boolean;

  constructor(message: string, info: { code?: string | null; status?: number | null; network: boolean }) {
    super(message);
    this.name = 'WowWorkError';
    this.code = info.code ?? null;
    this.status = info.status ?? null;
    this.network = info.network;
    Object.setPrototypeOf(this, WowWorkError.prototype);
  }

  /** 이 박스로는 더 작업할 수 없다 (없는 박스 · 이미 작업완료) */
  get boxGone(): boolean {
    return this.status === NOT_FOUND_STATUS || this.code === BOX_ALREADY_PICKED_CODE;
  }

  /** 이미 작업완료한 박스 */
  get alreadyPicked(): boolean {
    return this.code === BOX_ALREADY_PICKED_CODE;
  }
}

export const isWowWorkError = (e: unknown): e is WowWorkError => e instanceof WowWorkError;

// ============================================================
// 공통 요청
// ============================================================
interface ApiBody {
  success?: boolean;
  code?: string;
  error?: string;
  data?: unknown;
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

async function request(url: string, init?: RequestInit): Promise<ApiBody> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch {
    throw new WowWorkError('', { network: true });
  }

  let body: ApiBody | null = null;
  try {
    body = (await res.json()) as ApiBody;
  } catch {
    body = null;
  }

  if (res.status >= SERVER_ERROR_STATUS || !body) {
    throw new WowWorkError(body?.error ?? '', { status: res.status, network: true });
  }
  if (!res.ok || !body.success) {
    throw new WowWorkError(body.error ?? '', { code: body.code ?? null, status: res.status, network: false });
  }
  return body;
}

// ============================================================
// 조회
// ============================================================
export async function fetchWorkBoxes(): Promise<WowWorkBox[]> {
  const body = await request(WORK_API);
  return (body.data ?? []) as WowWorkBox[];
}

export async function fetchWorkDeck(boxId: string): Promise<WowWorkDeck> {
  const body = await request(`${WORK_API}?box_id=${encodeURIComponent(boxId)}`);
  return body.data as WowWorkDeck;
}

// ============================================================
// 저장
// ============================================================

/** 카드를 가리키는 값 (박스 안에서 상품 + 위치 + 몫) */
export interface WorkCardRef {
  product_id: string;
  location_id: string | null;
  plan_qty: number;
}

export type WorkAction =
  | { action: 'open' }
  | ({ action: 'find'; found_qty: number | null } & WorkCardRef)
  | ({ action: 'memo'; memo: string } & WorkCardRef)
  | { action: 'size'; box_size: string }
  | { action: 'complete' };

/**
 * 저장 요청. retries 를 주면 연결 문제일 때만 그만큼 더 보낸다.
 * (complete 는 두 번 보내면 결과가 달라지므로 재시도하지 않는다)
 */
export async function postWork(
  boxId: string,
  operatorName: string,
  action: WorkAction,
  retries = 0,
): Promise<ApiBody & Record<string, unknown>> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...action, box_id: boxId, operator_name: operatorName }),
  };

  let last: WowWorkError | null = null;
  for (let n = 0; n <= retries; n += 1) {
    try {
      return (await request(WORK_API, init)) as ApiBody & Record<string, unknown>;
    } catch (e) {
      if (!isWowWorkError(e) || !e.network) throw e;
      last = e;
      if (n < retries) await wait(RETRY_WAIT_MS * (n + 1));
    }
  }
  throw last ?? new WowWorkError('', { network: true });
}
