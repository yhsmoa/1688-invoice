import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { supabase } from '../../../lib/supabase';

// ============================================================
// POST /api/upload-delivery-status-csv
// 배송상황 CSV 업로드 → im_1688_orders_delivery_status 테이블 저장
// 업로드 시 기존 데이터 전체 삭제 후 새 데이터 삽입
// ============================================================
export async function POST(request: NextRequest) {
  try {
    // ── 1) FormData에서 CSV 파일 수신 ──
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: '파일이 업로드되지 않았습니다.' },
        { status: 400 }
      );
    }

    // ── 2) 파일 확장자 검증 ──
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.csv')) {
      return NextResponse.json(
        { error: 'CSV 파일(.csv)만 업로드 가능합니다.' },
        { status: 400 }
      );
    }

    // ── 3) 파일을 버퍼로 변환 후 XLSX로 파싱 (CSV 지원) ──
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false }) as any[][];

    // ── 4) 헤더 스킵 후 데이터 행 추출 ──
    const dataRows = jsonData.slice(1);

    // 컬럼 인덱스: A=주문상태, B=주문번호, C=시간, D=진행상태, E=물류상태, F=상세설명
    const COL = { ORDER_STATUS: 0, ORDER_NO: 1, TIMESTAMP: 2, STATUS_DETAILS: 3, DELIVERY_STATUS: 4, DESCRIPTION: 5 };

    const rows: {
      order_status: string | null;
      '1688_order_no': string;
      timestamp: string | null;
      status_details: string | null;
      delivery_status: string | null;
      description: string | null;
    }[] = [];

    for (const row of dataRows) {
      if (!row || row.length === 0) continue;

      // 주문번호(B열) 없으면 스킵
      const orderNo = row[COL.ORDER_NO];
      if (!orderNo || orderNo.toString().trim() === '') continue;

      // ── 5) 타임스탬프 파싱: 문자열 처리 (raw: false이므로 항상 문자열) ──
      let parsedTs: string | null = null;
      const rawTs = row[COL.TIMESTAMP];
      if (rawTs) {
        const parsed = new Date(rawTs.toString().trim());
        parsedTs = isNaN(parsed.getTime()) ? null : parsed.toISOString();
      }

      rows.push({
        order_status: row[COL.ORDER_STATUS]?.toString().trim() || null,
        '1688_order_no': orderNo.toString().trim(),
        timestamp: parsedTs,
        status_details: row[COL.STATUS_DETAILS]?.toString().trim() || null,
        delivery_status: row[COL.DELIVERY_STATUS]?.toString().trim() || null,
        description: row[COL.DESCRIPTION]?.toString().trim() || null,
      });
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: '유효한 데이터가 없습니다. CSV 파일 내용을 확인해주세요.' },
        { status: 400 }
      );
    }

    // ── 6) 기존 데이터 전체 삭제 ──
    const { error: deleteError } = await supabase
      .from('im_1688_orders_delivery_status')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) {
      return NextResponse.json(
        { error: '기존 데이터 삭제 중 오류가 발생했습니다.', details: deleteError.message },
        { status: 500 }
      );
    }

    // ── 7) 새 데이터 배치 삽입 (50개씩) ──
    let savedCount = 0;
    let errorCount = 0;
    const BATCH = 50;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { data, error } = await supabase
        .from('im_1688_orders_delivery_status')
        .insert(batch)
        .select();

      if (error) {
        console.error(`배송상황 CSV 배치 ${Math.floor(i / BATCH) + 1} 저장 오류:`, error);
        errorCount += batch.length;
      } else {
        savedCount += data?.length || 0;
      }
    }

    // ── 8) 결과 반환 ──
    return NextResponse.json({
      success: true,
      message: `배송상황 CSV 업로드 완료 (${savedCount}개 저장)`,
      count: rows.length,
      savedCount,
      errorCount,
    });
  } catch (error) {
    console.error('배송상황 CSV 업로드 오류:', error);
    return NextResponse.json(
      {
        error: 'CSV 파일 처리 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
