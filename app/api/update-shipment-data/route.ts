import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { action, itemData } = await request.json();

    if (!action || !itemData) {
      return NextResponse.json(
        { success: false, error: '필수 데이터가 누락되었습니다.' },
        { status: 400 }
      );
    }

    console.log('쉽먼트 업데이트 요청:', { action, itemData });

    if (action === 'update') {
      // 개수 수정 - ID를 사용한 업데이트
      const uniqueId = `${itemData.box_number}-${itemData.barcode}`;
      const { error } = await supabase
        .from('1688_shipment')
        .update({ qty: itemData.quantity })
        .eq('id', uniqueId);

      if (error) {
        console.error('쉽먼트 업데이트 오류:', error);
        throw error;
      }

      console.log('쉽먼트 개수 업데이트 완료:', itemData);
      return NextResponse.json({ success: true, message: '개수가 수정되었습니다.' });

    } else if (action === 'delete') {
      // 항목 삭제 - ID를 사용한 삭제
      const uniqueId = `${itemData.box_number}-${itemData.barcode}`;
      const { error } = await supabase
        .from('1688_shipment')
        .delete()
        .eq('id', uniqueId);

      if (error) {
        console.error('쉽먼트 삭제 오류:', error);
        throw error;
      }

      console.log('쉽먼트 항목 삭제 완료:', itemData);
      return NextResponse.json({ success: true, message: '항목이 삭제되었습니다.' });

    } else {
      return NextResponse.json(
        { success: false, error: '유효하지 않은 액션입니다.' },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('쉽먼트 업데이트 오류:', error);
    return NextResponse.json(
      { success: false, error: '쉽먼트 데이터 업데이트에 실패했습니다.' },
      { status: 500 }
    );
  }
}