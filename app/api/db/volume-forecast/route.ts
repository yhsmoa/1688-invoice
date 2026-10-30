import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { guardDbRoute } from '../../../../lib/dbAccess';
import type { PipelineData } from '../../../../lib/volumeForecast';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/db/volume-forecast
//
// 물량예측 — 파이프라인 스냅샷 · 미입고 항목 · 소요일 분포 · 최근 28일 처리 능력 · 확인 필요 목록
//   집계: rpc db_volume_pipeline (supabase/db/002_volume_pipeline.sql)
//     · 관련 테이블이 모두 1000행을 훌쩍 넘어 행을 내려받지 않고 DB 에서 한 번에 집계
//     · 반환은 jsonb 1개 (PostgREST 1000행 응답 제한 회피)
//   유입 예측·소진 시뮬레이션은 화면이 lib/volumeForecast 로 계산한다
//   (인원·근무시간·처리속도 입력값을 바꿀 때 재조회하지 않기 위해).
// ============================================================

export async function GET(request: NextRequest) {
  try {
    // ── 접근 권한 검증 (물량관리 — 기업·매니저) ──
    const denied = await guardDbRoute(request, 'volume');
    if (denied) return denied;

    const { data, error } = await supabase.rpc('db_volume_pipeline');
    if (error) throw error;

    return NextResponse.json({ success: true, data: data as PipelineData });
  } catch (error) {
    console.error('물량예측 집계 오류:', error);
    return NextResponse.json(
      { success: false, error: '물량예측 집계 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
