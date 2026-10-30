import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import {
  parsePeriodUnit,
  periodEndOf,
  periodStartOf,
  toKstDate,
  type PeriodUnit,
} from '../../../../lib/periodBucket';
import { guardDbRoute } from '../../../../lib/dbAccess';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/db/volume-weekly?basis=packed|shipment|confirmed&period=day|week|month
//
// 일간 / 주간(월~일) / 월간 단위 물량 집계
//   1. 출고 단계 수량 (shipmentQty / shipmentRows) — basis 로 세는 사건이 바뀐다
//        packed    (기본) : ft_fulfillment_outbounds PACKED 스캔 — 포장한 날 (매일 발생)
//        shipment         : ft_shipment_details.quantity — ft_shipments.date 실제 출고일
//        confirmed        : ft_shipment_details.quantity — confirmed_at(KST) 확정 시각
//      출고(쉽먼트)는 주 2회 출고일에 한꺼번에 잡혀 주·일 단위 편차가 크다.
//      실제 노동은 매일 하는 포장 스캔이므로 포장일을 기본으로 둔다.
//   2. ft_fulfillment_inbounds → 입고량(ARRIVAL) / 취소·반품(CANCEL, RETURN)
//   3. invoiceManager_emplyee_records.total_minutes 합 → 근무시간
//      + invoiceManager_employees.role 로 포장/검수 시간 분리
//
// 파생 지표(출고/h, 총처리/h, 라인/h)는 분모(직책) 선택이 프론트에 있으므로
// 프론트에서 계산한다. 본 API 는 원시 합계만 반환.
//
// 입고는 basis 와 무관하게 항상 created_at KST 기준.
//
// ⚠️ ft_fulfillment_outbounds 2.9만 행, ft_shipment_details 2.8만 행,
//    ft_fulfillment_inbounds 4.3만 행 (2026-10-30) → range() 페이지네이션 필수
// ============================================================

const PAGE = 1000;

type Basis = 'packed' | 'shipment' | 'confirmed';

function parseBasis(value: string | null): Basis {
  return value === 'shipment' || value === 'confirmed' ? value : 'packed';
}

// ── 전체 조회 helper (1000행 limit 우회) ──
async function fetchAll<T>(
  table: string,
  select: string,
  orderColumn: string
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(orderColumn, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// ── 포장 스캔 전체 조회 (type = PACKED 만, 1000행 limit 우회) ──
async function fetchAllPacked(): Promise<{ id: string; quantity: number | null; created_at: string | null }[]> {
  const rows: { id: string; quantity: number | null; created_at: string | null }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('ft_fulfillment_outbounds')
      .select('id, quantity, created_at')
      .eq('type', 'PACKED')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// ── 구간(일/주/월) 누적 버킷 ──
interface PeriodBucket {
  periodStart: string;
  shipmentQty: number;
  shipmentRows: number;
  arrivalQty: number;
  arrivalRows: number;
  cancelReturnQty: number;
  workMinutes: number;
  packMinutes: number;
  inspectMinutes: number;
  workDates: Set<string>;
  workerIds: Set<string>;
}

function bucketOf(map: Map<string, PeriodBucket>, periodStart: string): PeriodBucket {
  let b = map.get(periodStart);
  if (!b) {
    b = {
      periodStart,
      shipmentQty: 0,
      shipmentRows: 0,
      arrivalQty: 0,
      arrivalRows: 0,
      cancelReturnQty: 0,
      workMinutes: 0,
      packMinutes: 0,
      inspectMinutes: 0,
      workDates: new Set(),
      workerIds: new Set(),
    };
    map.set(periodStart, b);
  }
  return b;
}

export async function GET(request: NextRequest) {
  try {
    // ── 접근 권한 검증 (DB 관리 메뉴 전용) ──
    const denied = await guardDbRoute(request, 'volume');
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const basis: Basis = parseBasis(searchParams.get('basis'));
    const period: PeriodUnit = parsePeriodUnit(searchParams.get('period'));

    // ── 1. 원본 데이터 병렬 조회 ──
    type ShipmentRow = { id: string; date: string | null };
    type DetailRow = {
      id: string;
      shipment_id: string | null;
      quantity: number | null;
      confirmed_at: string | null;
    };
    type WorkRow = {
      id: string;
      employee_id: string;
      work_date: string;
      total_minutes: number | null;
    };
    type InboundRow = {
      id: string;
      type: string | null;
      quantity: number | null;
      created_at: string | null;
    };
    type PackedRow = { id: string; quantity: number | null; created_at: string | null };
    type EmployeeRow = { id: string; role: string | null };

    // 출고 단계 원본 — basis 에 따라 포장 스캔 또는 쉽먼트 상세만 읽는다
    const usePacked = basis === 'packed';
    const [shipments, details, packed, works, inbounds, employees] = await Promise.all([
      usePacked ? Promise.resolve([] as ShipmentRow[]) : fetchAll<ShipmentRow>('ft_shipments', 'id, date', 'id'),
      usePacked
        ? Promise.resolve([] as DetailRow[])
        : fetchAll<DetailRow>('ft_shipment_details', 'id, shipment_id, quantity, confirmed_at', 'id'),
      usePacked ? fetchAllPacked() : Promise.resolve([] as PackedRow[]),
      fetchAll<WorkRow>(
        'invoiceManager_emplyee_records',
        'id, employee_id, work_date, total_minutes',
        'id'
      ),
      fetchAll<InboundRow>('ft_fulfillment_inbounds', 'id, type, quantity, created_at', 'id'),
      fetchAll<EmployeeRow>('invoiceManager_employees', 'id, role', 'id'),
    ]);

    const shipmentDateById = new Map<string, string | null>();
    shipments.forEach((s) => shipmentDateById.set(s.id, s.date));

    const roleById = new Map<string, string | null>();
    employees.forEach((e) => roleById.set(e.id, e.role));

    // ── 2. 구간(주/월) 집계 ──
    const buckets = new Map<string, PeriodBucket>();
    let skippedDetails = 0;

    // 출고 단계 — 포장 스캔 (기준일: 스캔 시각 KST)
    packed.forEach((p) => {
      if (!p.created_at) return;
      const b = bucketOf(buckets, periodStartOf(toKstDate(p.created_at), period));
      b.shipmentQty += p.quantity ?? 0;
      b.shipmentRows += 1;
    });

    // 출고 단계 — 쉽먼트 상세 (기준일: basis 선택)
    details.forEach((d) => {
      let baseDate: string | null = null;
      if (basis === 'shipment') {
        baseDate = d.shipment_id ? shipmentDateById.get(d.shipment_id) ?? null : null;
        // 출고 헤더에 날짜가 없으면 확정일로 폴백
        if (!baseDate && d.confirmed_at) baseDate = toKstDate(d.confirmed_at);
      } else {
        baseDate = d.confirmed_at ? toKstDate(d.confirmed_at) : null;
      }

      if (!baseDate) {
        skippedDetails += 1;
        return;
      }

      const b = bucketOf(buckets, periodStartOf(baseDate, period));
      b.shipmentQty += d.quantity ?? 0;
      b.shipmentRows += 1;
    });

    // 입고 · 취소반품 (기준일: created_at KST)
    inbounds.forEach((r) => {
      if (!r.created_at) return;
      const b = bucketOf(buckets, periodStartOf(toKstDate(r.created_at), period));
      if (r.type === 'ARRIVAL') {
        b.arrivalQty += r.quantity ?? 0;
        b.arrivalRows += 1;
      } else if (r.type === 'CANCEL' || r.type === 'RETURN') {
        b.cancelReturnQty += r.quantity ?? 0;
      }
    });

    // 근무시간 (직책별 분리)
    works.forEach((w) => {
      if (!w.work_date) return;
      const b = bucketOf(buckets, periodStartOf(w.work_date, period));
      const mins = w.total_minutes ?? 0;
      b.workMinutes += mins;
      const role = roleById.get(w.employee_id);
      if (role === '포장') b.packMinutes += mins;
      else if (role === '검수') b.inspectMinutes += mins;
      b.workDates.add(w.work_date);
      b.workerIds.add(w.employee_id);
    });

    // ── 3. 응답 형태로 변환 (최신 구간 먼저) ──
    const weeks = Array.from(buckets.values())
      .sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1))
      .map((b) => ({
        weekStart: b.periodStart,
        weekEnd: periodEndOf(b.periodStart, period),
        shipmentQty: b.shipmentQty,
        shipmentRows: b.shipmentRows,
        arrivalQty: b.arrivalQty,
        arrivalRows: b.arrivalRows,
        cancelReturnQty: b.cancelReturnQty,
        workMinutes: b.workMinutes,
        packMinutes: b.packMinutes,
        inspectMinutes: b.inspectMinutes,
        workDays: b.workDates.size,
        workerCount: b.workerIds.size,
      }));

    return NextResponse.json({
      success: true,
      basis,
      period,
      weeks,
      meta: {
        weekCount: weeks.length,
        detailRows: usePacked ? packed.length : details.length,
        inboundRows: inbounds.length,
        skippedDetails,
      },
    });
  } catch (error) {
    console.error('주간 물량 집계 오류:', error);
    return NextResponse.json(
      { success: false, error: '주간 물량 집계 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
