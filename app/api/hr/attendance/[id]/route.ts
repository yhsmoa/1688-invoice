import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { payrollDbMessage } from '../../../../../lib/payrollPayments';

// ============================================================
// DELETE /api/hr/attendance/[id]
//
// 출퇴근 기록 단건 삭제
// Params: id (출퇴근 기록 UUID)
// ============================================================
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('invoiceManager_emplyee_records')
      .delete()
      .eq('id', id);

    if (error) {
      // 급여 지급완료된 기록은 DB 트리거가 삭제를 막는다 → 사유를 그대로 안내
      const locked = payrollDbMessage(error.message);
      if (locked) return NextResponse.json({ success: false, error: locked }, { status: 409 });
      throw error;
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('출퇴근 기록 삭제 오류:', error);
    return NextResponse.json(
      { success: false, error: '삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
