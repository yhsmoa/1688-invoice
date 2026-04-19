import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// POST /api/ft/v2-migration/upload-xlsx
//
// [V2 이전] 엑셀 업로드 → ft_orders + ft_order_items 마이그레이션
//
// 흐름:
//   1.  입력 검증 (multipart file + user_id + worker_id/worker_name 옵션)
//   2.  엑셀 파싱 (header 행 제거)
//   3.  선택된 ft_users 1건 조회 (full_name, phone, address)
//   4.  Excel에서 unique order_no / item_no 추출
//   5.  ft_orders 사전 중복 조회 (user_id + order_no IN (...))
//       → 1건이라도 있으면 409 응답 + 중복 리스트 반환
//   6.  invoiceManager_transactions .in(order_code, ...) 조회 (청크)
//   7.  invoiceManager_1688_orders .in(order_number, ...) 조회 (청크 + 페이지네이션)
//   8.  ft_orders rows 구성 (dedup) → 100건씩 chunked INSERT
//   9.  ft_orders 재조회 검증 → order_no → id map
//   10. ft_order_items rows 구성 (id 미리 생성, product_id memoize, item_seq)
//   11. ft_order_items 100건씩 chunked INSERT
//   12. ft_fulfillment_inbounds rows 구성 (N열 > 0 만) → chunked INSERT
//   13. 응답
// ============================================================

// ── 상수 ──────────────────────────────────────────────────
const IN_CHUNK_SIZE = 500;    // .in() 필터 1회 최대 값 개수
const SUPABASE_PAGE_SIZE = 1000; // Supabase 기본 row limit (페이지네이션용)
const INSERT_CHUNK_SIZE = 100;   // INSERT 1회 최대 row 수
const TARGET_YEAR = 2026;        // requested_date YYYY 고정값 (운영 연도)

// ── 엑셀 열 인덱스 (0-based) ─────────────────────────────
const COL = {
  A: 0,  B: 1,  C: 2,  D: 3,  E: 4,
  F: 5,  G: 6,  H: 7,  I: 8,  J: 9,
  K: 10, L: 11, N: 13, Q: 16, R: 17,
  S: 18, U: 20, V: 21, W: 22, X: 23, Y: 24, Z: 25,
} as const;

// ============================================================
// 타입
// ============================================================
interface FtUserRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  address: string | null;
}

interface TransactionRow {
  order_code: string;
  amount: number | null;
  item_qty: number | null;
  delivery_fee: number | null;
  service_fee: number | null;
  extra_fee: number | null;
  price: number | null;
}

interface Order1688Row {
  order_number: string;
  '1688_offer_id': string | null;
  '1688_order_id': string | null;
}

// ============================================================
// 헬퍼: 값 정규화
// ============================================================

// 빈 값 → null (빈 문자열, undefined 방지)
const toTextOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// 숫자 변환 (실패 시 null)
const toNumOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// 정수 변환 (실패 시 null)
const toIntOrNull = (v: unknown): number | null => {
  const n = toNumOrNull(v);
  if (n === null) return null;
  return Math.trunc(n);
};

// item_no → product_no (앞 3파트만 유지)
// "BO-260406-0015-A01" → "BO-260406-0015"
const normalizeProductNo = (itemNo: string | null): string | null => {
  if (!itemNo) return null;
  const parts = itemNo.split('-');
  return parts.length > 3 ? parts.slice(0, 3).join('-') : itemNo;
};

// Small/Medium/Large (case-insensitive) 만 통과, 나머지는 null
const normalizeShipmentSize = (v: unknown): string | null => {
  const s = toTextOrNull(v);
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === 'small' || lower === 'medium' || lower === 'large') return s;
  return null;
};

// MMDD → YYYY-MM-DD (TARGET_YEAR 기준)
// "0401" → "2026-04-01", "401" → "2026-04-01"
const mmddToDate = (v: unknown): string | null => {
  const s = toTextOrNull(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 4) return null;
  const padded = digits.padStart(4, '0');
  const mm = padded.slice(0, 2);
  const dd = padded.slice(2, 4);
  const mmNum = Number(mm);
  const ddNum = Number(dd);
  if (mmNum < 1 || mmNum > 12 || ddNum < 1 || ddNum > 31) return null;
  return `${TARGET_YEAR}-${mm}-${dd}`;
};

// ============================================================
// 헬퍼: Supabase 청크 조회/삽입
// ============================================================

// values를 CHUNK_SIZE 단위로 나눠서 .in() 필터로 조회
// 각 청크 결과는 .range() 페이지네이션으로 1000건 제한 우회
async function fetchInChunks<T>(
  table: string,
  column: string,
  values: string[],
  selectCols: string
): Promise<T[]> {
  if (values.length === 0) return [];
  const all: T[] = [];

  for (let i = 0; i < values.length; i += IN_CHUNK_SIZE) {
    const chunk = values.slice(i, i + IN_CHUNK_SIZE);

    // ── 페이지네이션 루프 (해당 청크의 결과가 1000건 초과 가능) ──
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select(selectCols)
        .in(column, chunk)
        .range(from, from + SUPABASE_PAGE_SIZE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...(data as unknown as T[]));
      if (data.length < SUPABASE_PAGE_SIZE) break;
      from += SUPABASE_PAGE_SIZE;
    }
  }
  return all;
}

// rows를 CHUNK_SIZE 단위로 나눠서 INSERT
async function insertInChunks<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
  returning = false
): Promise<{ inserted: number; data: unknown[] }> {
  if (rows.length === 0) return { inserted: 0, data: [] };
  let inserted = 0;
  const collected: unknown[] = [];

  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
    const query = supabase.from(table).insert(chunk);
    const { data, error } = returning ? await query.select() : await query;
    if (error) throw error;
    inserted += chunk.length;
    if (data) collected.push(...(data as unknown[]));
  }

  return { inserted, data: collected };
}

// ============================================================
// 메인 핸들러
// ============================================================
export async function POST(request: NextRequest) {
  try {
    // ── 1. 입력 검증 ────────────────────────────────────
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const userId = formData.get('user_id') as string | null;
    const workerId = formData.get('worker_id') as string | null;
    const workerName = formData.get('worker_name') as string | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: '엑셀 파일이 없습니다.' },
        { status: 400 }
      );
    }
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'user_id가 없습니다.' },
        { status: 400 }
      );
    }
    // worker_id / worker_name은 N열(입고 수량) 저장 시에만 필요.
    // 둘 중 하나라도 있는데 짝이 없으면 오류 처리.
    if ((workerId && !workerName) || (!workerId && workerName)) {
      return NextResponse.json(
        { success: false, error: 'worker_id와 worker_name은 함께 전달되어야 합니다.' },
        { status: 400 }
      );
    }

    // ── 2. 엑셀 파싱 ────────────────────────────────────
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!worksheet) {
      return NextResponse.json(
        { success: false, error: '엑셀 시트가 비어 있습니다.' },
        { status: 400 }
      );
    }

    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: null,
      raw: true,
    });

    // header 행 제거 + S열(order_no) 비어있는 행 제거
    const dataRows = rawRows.slice(1).filter(
      (row) => toTextOrNull(row?.[COL.S]) !== null
    );

    if (dataRows.length === 0) {
      return NextResponse.json(
        { success: false, error: '업로드할 데이터가 없습니다.' },
        { status: 400 }
      );
    }

    // ── 3. ft_users 조회 ────────────────────────────────
    const { data: userData, error: userErr } = await supabase
      .from('ft_users')
      .select('id, full_name, phone, address')
      .eq('id', userId)
      .single<FtUserRow>();

    if (userErr || !userData) {
      return NextResponse.json(
        { success: false, error: '선택한 사용자를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // ── 4. Excel에서 unique 값 추출 ─────────────────────
    const uniqueOrderNos = new Set<string>();
    const uniqueItemNos = new Set<string>();
    for (const row of dataRows) {
      const orderNo = toTextOrNull(row[COL.S]);
      if (orderNo) uniqueOrderNos.add(orderNo);
      const itemNo = toTextOrNull(row[COL.B]);
      if (itemNo) uniqueItemNos.add(itemNo);
    }
    const orderNoList = Array.from(uniqueOrderNos);
    const itemNoList = Array.from(uniqueItemNos);

    // ── 5. ft_orders 사전 중복 조회 (user_id + order_no) ─
    const existingOrders = await fetchInChunks<{ order_no: string }>(
      'ft_orders',
      'order_no',
      orderNoList,
      'order_no, user_id'
    );
    const duplicates = (existingOrders as { order_no: string; user_id: string }[])
      .filter((r) => r.user_id === userId)
      .map((r) => r.order_no);

    if (duplicates.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: '이미 존재하는 order_no가 있습니다.',
          duplicates: Array.from(new Set(duplicates)),
        },
        { status: 409 }
      );
    }

    // ── 6. invoiceManager_transactions 조회 (order_code = order_no) ─
    const txRows = await fetchInChunks<TransactionRow>(
      'invoiceManager_transactions',
      'order_code',
      orderNoList,
      'order_code, amount, item_qty, delivery_fee, service_fee, extra_fee, price'
    );
    const txMap = new Map<string, TransactionRow>();
    for (const r of txRows) {
      if (r.order_code) txMap.set(r.order_code, r);
    }

    // ── 7. invoiceManager_1688_orders 조회 (order_number = item_no) ──
    //      10000+ 건 규모 대응 — IN 청크 + 페이지네이션
    const orders1688 = await fetchInChunks<Order1688Row>(
      'invoiceManager_1688_orders',
      'order_number',
      itemNoList,
      'order_number, "1688_offer_id", "1688_order_id"'
    );
    const order1688Map = new Map<string, Order1688Row>();
    for (const r of orders1688) {
      if (r.order_number && !order1688Map.has(r.order_number)) {
        order1688Map.set(r.order_number, r);
      }
    }

    // ── 8. ft_orders rows 구성 + INSERT ─────────────────
    const orderRows = orderNoList.map((orderNo) => {
      const tx = txMap.get(orderNo);
      return {
        order_no: orderNo,
        user_id: userId,
        recipient_name: userData.full_name,
        recipient_phone: userData.phone,
        recipient_address: userData.address,
        total_amount: tx?.amount ?? null,
        status: 'PROCESSING',
        total_qty: tx?.item_qty ?? null,
        delivery_fee: tx?.delivery_fee ?? null,
        service_fee: tx?.service_fee ?? null,
        extra_fee: tx?.extra_fee ?? null,
        total_item_price: tx?.price ?? null,
      };
    });

    await insertInChunks('ft_orders', orderRows);

    // ── 9. ft_orders 재조회 검증 → order_no → id map ────
    const insertedOrders = await fetchInChunks<{ id: string; order_no: string }>(
      'ft_orders',
      'order_no',
      orderNoList,
      'id, order_no, user_id'
    );
    const orderIdMap = new Map<string, string>();
    for (const r of insertedOrders as { id: string; order_no: string; user_id: string }[]) {
      if (r.user_id === userId && !orderIdMap.has(r.order_no)) {
        orderIdMap.set(r.order_no, r.id);
      }
    }

    // 모든 order_no가 매핑됐는지 검증
    const missingOrderIds = orderNoList.filter((no) => !orderIdMap.has(no));
    if (missingOrderIds.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'ft_orders INSERT 후 재조회 검증 실패',
          details: `누락된 order_no ${missingOrderIds.length}건`,
        },
        { status: 500 }
      );
    }

    // ── 10. ft_order_items rows 구성 ────────────────────
    //        · id를 미리 생성 (ft_fulfillment_inbounds.order_item_id 매핑용)
    //        · product_id memoize (같은 product_no → 같은 uuid)
    //        · item_seq: order_no별 카운터 (Excel 순서 유지)
    // ─────────────────────────────────────────────────────
    const productIdMap = new Map<string, string>();      // product_no → uuid
    const itemSeqCounter = new Map<string, number>();    // order_no → 1,2,3..

    // Excel row와 동일 순서의 itemRow + arrival 수량을 함께 구성.
    // 이후 arrival만 필터링해서 ft_fulfillment_inbounds로 INSERT.
    const itemPayloads = dataRows.map((row) => {
      const orderNo = toTextOrNull(row[COL.S])!;  // 이미 필터링됨
      const itemNo = toTextOrNull(row[COL.B]);
      const productNo = normalizeProductNo(itemNo);

      // product_id memoize
      let productId: string | null = null;
      if (productNo) {
        if (!productIdMap.has(productNo)) productIdMap.set(productNo, uuidv4());
        productId = productIdMap.get(productNo)!;
      }

      // item_seq: order_no별 카운터
      const nextSeq = (itemSeqCounter.get(orderNo) ?? 0) + 1;
      itemSeqCounter.set(orderNo, nextSeq);

      // 1688 매칭
      const match1688 = itemNo ? order1688Map.get(itemNo) : undefined;

      // X열 truthy → kc=true
      const recommandedAge = toTextOrNull(row[COL.X]);

      // ft_order_items.id를 미리 생성 — 이후 inbound 매핑에 사용
      const itemId = uuidv4();

      // N열 — 입고(ARRIVAL) 수량 (0 초과인 경우에만 inbound 저장)
      const arrivalQty = toIntOrNull(row[COL.N]);

      const itemRow = {
        id: itemId,
        order_id: orderIdMap.get(orderNo)!,
        order_no: orderNo,
        item_no: itemNo,
        item_name: toTextOrNull(row[COL.C]),
        option_name: toTextOrNull(row[COL.D]),
        order_qty: toIntOrNull(row[COL.E]),
        barcode: toTextOrNull(row[COL.F]),
        china_option1: toTextOrNull(row[COL.G]),
        china_option2: toTextOrNull(row[COL.H]),
        price_cny: toNumOrNull(row[COL.I]),
        price_total_cny: toNumOrNull(row[COL.J]),
        img_url: toTextOrNull(row[COL.K]),
        site_url: toTextOrNull(row[COL.L]),
        note_kr: toTextOrNull(row[COL.Q]),
        note_notice: toTextOrNull(row[COL.R]),
        vendor_option_id: toTextOrNull(row[COL.U]),
        coupang_shipment_size: normalizeShipmentSize(row[COL.V]),
        composition: toTextOrNull(row[COL.W]),
        recommanded_age: recommandedAge,
        kc: recommandedAge !== null,
        set_total: toIntOrNull(row[COL.Y]),
        set_seq: toIntOrNull(row[COL.Z]),
        requested_date: mmddToDate(row[COL.A]),
        status: 'PROCESSING',
        user_id: userId,
        product_no: productNo,
        product_id: productId,
        item_seq: nextSeq,
        '1688_offer_id': match1688?.['1688_offer_id'] ?? null,
        '1688_order_id': match1688?.['1688_order_id'] ?? null,
      };

      return { itemRow, arrivalQty, productNo, productId, itemId, orderNo, itemNo };
    });

    const itemRows = itemPayloads.map((p) => p.itemRow);

    // ── 11. ft_order_items INSERT ───────────────────────
    await insertInChunks('ft_order_items', itemRows);

    // ── 12. ft_fulfillment_inbounds rows 구성 + INSERT ──
    //        N열 > 0 인 row만 대상.
    //        worker_id/worker_name이 없으면 inbound 저장을 건너뜀.
    // ─────────────────────────────────────────────────────
    let inboundCount = 0;
    if (workerId && workerName) {
      const inboundRows = itemPayloads
        .filter((p) => p.arrivalQty !== null && p.arrivalQty > 0)
        .map((p) => ({
          order_item_id: p.itemId,
          type: 'ARRIVAL',
          quantity: p.arrivalQty,
          operator_id: workerId,
          operator_name: workerName,
          order_no: p.orderNo,
          item_no: p.itemNo,
          user_id: userId,
          product_no: p.productNo,
          product_id: p.productId,
        }));

      if (inboundRows.length > 0) {
        await insertInChunks('ft_fulfillment_inbounds', inboundRows);
        inboundCount = inboundRows.length;
      }
    }

    // ── 13. 응답 ────────────────────────────────────────
    return NextResponse.json({
      success: true,
      orderCount: orderRows.length,
      itemCount: itemRows.length,
      inboundCount,
    });
  } catch (error: unknown) {
    console.error('[V2 이전] 업로드 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json(
      { success: false, error: 'V2 이전 처리 중 오류가 발생했습니다.', details: message },
      { status: 500 }
    );
  }
}
