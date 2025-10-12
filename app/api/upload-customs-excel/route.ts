import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';
import * as XLSX from 'xlsx';

export const POST = async (request: NextRequest) => {
  console.log('통관정보 엑셀 업로드 API 호출');

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({
        success: false,
        error: '파일이 업로드되지 않았습니다.'
      }, { status: 400 });
    }

    console.log('업로드된 파일:', file.name);

    // 파일을 버퍼로 읽기
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 엑셀 파일 파싱
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    console.log('파싱된 데이터 행 수:', jsonData.length);

    if (jsonData.length < 2) {
      return NextResponse.json({
        success: false,
        error: '엑셀 파일에 데이터가 없습니다.'
      }, { status: 400 });
    }

    // 2행부터 데이터 추출 (1행은 헤더)
    const dataRows = jsonData.slice(1) as any[][];
    const customsData = dataRows
      .filter(row => row[2]) // C열(HS_code)이 있는 행만
      .map(row => ({
        item_name_ko: row[0] || '',
        item_name_en: row[1] || '',
        HS_code: String(row[2] || ''),
        CO: row[3] || ''
      }));

    console.log('추출된 통관 데이터 개수:', customsData.length);

    if (customsData.length === 0) {
      return NextResponse.json({
        success: false,
        error: '유효한 데이터가 없습니다. HS CODE가 있는 행이 필요합니다.'
      }, { status: 400 });
    }

    // Supabase에 데이터 저장 (upsert 사용하여 중복 방지)
    const { data, error } = await supabase
      .from('invoiceManager-Customs')
      .upsert(customsData, {
        onConflict: 'HS_code',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('Supabase 저장 오류:', error);
      return NextResponse.json({
        success: false,
        error: '데이터 저장 중 오류가 발생했습니다.',
        details: error.message
      }, { status: 500 });
    }

    console.log('통관정보 저장 완료:', customsData.length, '건');

    return NextResponse.json({
      success: true,
      message: `${customsData.length}건의 통관정보가 저장되었습니다.`,
      count: customsData.length
    });

  } catch (error) {
    console.error('통관정보 엑셀 업로드 오류:', error);
    return NextResponse.json({
      success: false,
      error: '엑셀 업로드 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
};
