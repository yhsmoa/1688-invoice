import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// GET /api/debug/label-check?operator_no=1
//
// invoiceManager_label 테이블 조회 + 세트상품 중복 분석
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const operatorNo = searchParams.get('operator_no');

    if (!operatorNo) {
      return NextResponse.json(
        { success: false, error: 'operator_no 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    // ============================================================
    // 1. 해당 operator_no의 전체 라벨 행 조회
    // ============================================================
    const { data: rows, error } = await supabase
      .from('invoiceManager_label')
      .select('*')
      .eq('operator_no', Number(operatorNo))
      .order('seq', { ascending: true });

    if (error) throw error;

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        success: true,
        operator_no: Number(operatorNo),
        total_count: 0,
        rows: [],
        summary: {
          unique_product_nos: 0,
          product_no_groups: {},
          potential_set_duplicates: [],
        },
      });
    }

    // ============================================================
    // 2. product_no별 그룹핑
    // ============================================================
    const productNoGroups: Record<string, typeof rows> = {};
    for (const row of rows) {
      const key = row.product_no || '(null)';
      if (!productNoGroups[key]) productNoGroups[key] = [];
      productNoGroups[key].push(row);
    }

    // ============================================================
    // 3. 세트상품 중복 후보 식별
    //    같은 product_no에 서로 다른 barcode → 세트 구성품이 병합되지 않은 경우
    // ============================================================
    const potentialSetDuplicates = Object.entries(productNoGroups)
      .filter(([, group]) => {
        if (group.length <= 1) return false;
        const uniqueBarcodes = new Set(group.map((r) => r.barcode));
        return uniqueBarcodes.size > 1;
      })
      .map(([productNo, group]) => ({
        product_no: productNo,
        count: group.length,
        barcodes: [...new Set(group.map((r) => r.barcode))],
        items: group.map((r) => ({
          seq: r.seq,
          item_name: r.item_name,
          barcode: r.barcode,
          qty: r.qty,
        })),
      }));

    // ============================================================
    // 4. 응답
    // ============================================================
    return NextResponse.json({
      success: true,
      operator_no: Number(operatorNo),
      total_count: rows.length,
      rows,
      summary: {
        unique_product_nos: Object.keys(productNoGroups).length,
        product_no_groups: Object.fromEntries(
          Object.entries(productNoGroups).map(([k, v]) => [k, v.length])
        ),
        potential_set_duplicates: potentialSetDuplicates,
      },
    });
  } catch (error: any) {
    console.error('label-check 오류:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
