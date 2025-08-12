import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const term = searchParams.get('term');

    if (!term || !term.trim()) {
      return NextResponse.json(
        { success: false, error: '검색어를 입력해주세요.' },
        { status: 400 }
      );
    }

    console.log('일반검색 요청:', term);

    // product_name, offer_id, barcode 필드에서 검색
    const { data, error } = await supabase
      .from('invoice_import_googlesheet')
      .select('*')
      .or(`product_name.ilike.%${term}%,offer_id.ilike.%${term}%,barcode.ilike.%${term}%`)
      .order('row_id', { ascending: false });

    if (error) {
      console.error('일반검색 Supabase 오류:', error);
      throw error;
    }

    // ID가 없는 데이터에 ID 추가 (다른 API들과 일관성 유지)
    const dataWithIds = (data || []).map(item => ({
      ...item,
      id: item.row_id || uuidv4() // row_id 값을 id로 사용, 없으면 UUID 생성
    }));

    console.log(`일반검색 결과: ${dataWithIds.length}개 항목 발견`);

    return NextResponse.json({
      success: true,
      data: dataWithIds,
      message: `${dataWithIds.length}개의 검색 결과를 찾았습니다.`
    });

  } catch (error) {
    console.error('일반검색 오류:', error);
    return NextResponse.json(
      { success: false, error: '일반검색 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}