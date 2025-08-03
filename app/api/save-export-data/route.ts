import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { exportData } = await request.json();

    if (!exportData || !Array.isArray(exportData)) {
      return NextResponse.json(
        { success: false, error: '출고 데이터가 유효하지 않습니다.' },
        { status: 400 }
      );
    }

    // 각 항목에 대해 출고 수량 업데이트
    const updatePromises = exportData.map(async (item: { id: string; export_qty: number }) => {
      const { error } = await supabase
        .from('invoice_import_googlesheet')
        .update({ export_qty: item.export_qty })
        .eq('row_id', item.id);  // row_id로 매칭

      if (error) {
        console.error(`ID ${item.id} 업데이트 오류:`, error);
        throw error;
      }
    });

    await Promise.all(updatePromises);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('출고 데이터 저장 오류:', error);
    return NextResponse.json(
      { success: false, error: '출고 데이터 저장에 실패했습니다.' },
      { status: 500 }
    );
  }
}