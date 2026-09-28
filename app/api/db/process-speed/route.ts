import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { parsePeriod, periodEndOf, type Period } from '../../../../lib/periodBucket';
import { guardDbRoute } from '../../../../lib/dbAccess';
import { resolveScanSizeCode } from '../../../../lib/sizeCode';
import {
  STAGES,
  addStat,
  emptyCells,
  type SetKind,
  type SizeKey,
  type SpeedPeriod,
  type Stage,
  type StageStat,
} from '../../../../lib/processSpeed';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/db/process-speed?period=week|month&basis=shipment|confirmed
//
// 처리속도 — 배송·입고·포장·출고 단계별 평균 소요일 (주간/월간)
//   집계: rpc db_process_speed (supabase/db/001_process_speed.sql)
//     · 모든 테이블 1000행 초과 → 행을 내려받지 않고 DB 에서 한 번에 집계
//     · 반환은 jsonb 1개 (PostgREST 1000행 응답 제한 회피)
//   사이즈 A/B/C/P/X: raw (shipment_type, coupang_shipment_size) 를
//     lib/sizeCode.resolveScanSizeCode 로 접는다 (상품출고 스캔 검증과 같은 기준)
//   세트/단품 × 사이즈의 '전체' 는 여기서 합계·표본수를 더해 미리 만든다 (가중 평균)
//
// basis (출고 단계 종료 시각)
//   · shipment  (기본) : ft_shipments.created_at — 출고 처리 시각
//   · confirmed        : ft_shipment_details.confirmed_at — 확정 시각
// ============================================================

type Basis = 'shipment' | 'confirmed';

interface SpeedRpcRow {
  period_start: string;
  shipment_type: string | null;
  coupang_shipment_size: string | null;
  is_set: boolean;
  stage: Stage;
  sum_days: number | string;
  n: number;
  n_upper_only: number;
  n_skipped: number;
}

const STAGE_SET = new Set<string>(STAGES);

export async function GET(request: NextRequest) {
  try {
    // ── 접근 권한 검증 (DB 관리 메뉴 전용) ──
    const denied = await guardDbRoute(request);
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const period: Period = parsePeriod(searchParams.get('period'));
    const basis: Basis = searchParams.get('basis') === 'confirmed' ? 'confirmed' : 'shipment';

    // ── 1) 집계 + 마지막 배송상황 업로드 시각 (병렬) ──
    const [speedRes, lastUploadRes] = await Promise.all([
      supabase.rpc('db_process_speed', { p_period: period, p_basis: basis }),
      supabase
        .from('im_1688_delivery_history')
        .select('last_seen_at')
        .order('last_seen_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (speedRes.error) throw speedRes.error;
    if (lastUploadRes.error) throw lastUploadRes.error;

    const rows = (speedRes.data as SpeedRpcRow[] | null) ?? [];

    // ── 2) 기간별 셀 구성 — (세트구분 × 사이즈) 각 축의 'ALL' 까지 합산 ──
    const byPeriod = new Map<string, SpeedPeriod>();

    for (const r of rows) {
      if (!STAGE_SET.has(r.stage)) continue;

      let p = byPeriod.get(r.period_start);
      if (!p) {
        p = { periodStart: r.period_start, periodEnd: periodEndOf(r.period_start, period), cells: emptyCells() };
        byPeriod.set(r.period_start, p);
      }

      const stat: StageStat = {
        sumDays: Number(r.sum_days) || 0,
        n: r.n ?? 0,
        nUpperOnly: r.n_upper_only ?? 0,
        nSkipped: r.n_skipped ?? 0,
      };

      const size = resolveScanSizeCode(r.shipment_type, r.coupang_shipment_size) as SizeKey;
      const kind: SetKind = r.is_set ? 'SET' : 'SINGLE';

      for (const k of [kind, 'ALL'] as SetKind[]) {
        for (const s of [size, 'ALL'] as SizeKey[]) {
          addStat(p.cells[k][s][r.stage], stat);
        }
      }
    }

    // 최신 구간 먼저 (물량처리 탭과 동일)
    const periods = Array.from(byPeriod.values()).sort((a, b) =>
      a.periodStart < b.periodStart ? 1 : -1
    );

    return NextResponse.json({
      success: true,
      period,
      basis,
      periods,
      meta: {
        lastDeliveryUploadAt: lastUploadRes.data?.last_seen_at ?? null,
      },
    });
  } catch (error) {
    console.error('처리속도 집계 오류:', error);
    return NextResponse.json(
      { success: false, error: '처리속도 집계 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
