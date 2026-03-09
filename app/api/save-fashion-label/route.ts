import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { items, operator_no } = body;

    // ============================================================
    // 1. 입력 데이터 검증
    // ============================================================
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: '저장할 데이터가 없습니다.' },
        { status: 400 }
      );
    }

    if (!operator_no) {
      return NextResponse.json(
        { success: false, error: '담당자(operator_no)가 선택되지 않았습니다.' },
        { status: 400 }
      );
    }

    console.log(`invoiceManager_label 저장 시작: ${items.length}개 아이템, operator_no: ${operator_no}`);

    // ============================================================
    // 헬퍼: product_no 정규화 (BZ-260224-0202-A01 → BZ-260224-0202)
    //        앞 3개 파트(dash 기준)만 유지
    // ============================================================
    const normalizeProductNo = (value: string | null): string | null => {
      if (!value) return null;
      const parts = value.split('-');
      return parts.length > 3 ? parts.slice(0, 3).join('-') : value;
    };

    // ============================================================
    // 2. 다건 상품 수량 확장 (LABEL 시트 룰과 동일)
    //    - 1개 상품: qty 그대로 유지
    //    - 2개 이상 상품: 각 상품을 qty만큼 개별 행으로 확장 (qty=1)
    // ============================================================
    const expandedItems = items.length >= 2
      ? items.flatMap((item: any) =>
          Array.from({ length: item.qty || 1 }, () => ({ ...item, qty: 1 }))
        )
      : items;

    // ============================================================
    // 3. 기존 operator_no 데이터 삭제
    // ============================================================
    const { error: deleteError } = await supabase
      .from('invoiceManager_label')
      .delete()
      .eq('operator_no', operator_no);

    if (deleteError) {
      console.error('기존 데이터 삭제 오류:', deleteError);
      throw deleteError;
    }

    // ============================================================
    // 4. INSERT 데이터 구성
    // ============================================================
    const insertRows = expandedItems.map((item: any, idx: number) => ({
      seq: idx + 1,
      brand: item.brand || null,
      item_name: item.item_name || null,
      barcode: item.barcode || null,
      qty: item.qty || 0,
      product_no: normalizeProductNo(item.product_no || null),
      composition: item.composition || null,
      recommanded_age: item.recommanded_age || null,
      shipment_size: item.shipment_size || null,
      operator_no: operator_no,
    }));

    const { data, error: insertError } = await supabase
      .from('invoiceManager_label')
      .insert(insertRows)
      .select('id');

    if (insertError) {
      console.error('invoiceManager_label 저장 오류:', insertError);
      throw insertError;
    }

    const count = data?.length || 0;
    console.log(`invoiceManager_label 저장 완료: ${count}개`);

    return NextResponse.json({
      success: true,
      count,
      message: `${count}개 데이터가 저장되었습니다.`
    });

  } catch (error: any) {
    console.error('invoiceManager_label 저장 오류:', JSON.stringify(error, null, 2));
    return NextResponse.json(
      {
        success: false,
        error: 'invoiceManager_label 저장 중 오류가 발생했습니다.',
        details: error?.message || error?.details || JSON.stringify(error)
      },
      { status: 500 }
    );
  }
}
