import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { supabase } from '../../../lib/supabase';

// 엑셀 날짜를 JavaScript Date로 변환하는 함수
const excelDateToJSDate = (excelDate: any) => {
  if (!excelDate) return null;
  
  // 이미 문자열 형태의 날짜인 경우
  if (typeof excelDate === 'string') {
    const date = new Date(excelDate);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }
  
  // 엑셀 시리얼 날짜인 경우 (숫자)
  if (typeof excelDate === 'number') {
    // 엑셀은 1900년 1월 1일을 기준으로 한 시리얼 날짜를 사용
    const date = new Date((excelDate - 25569) * 86400 * 1000);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }
  
  return null;
};

// 콤마가 포함된 숫자를 파싱하는 함수
const parseNumber = (value: any) => {
  if (value === undefined || value === null || value === '') return null;
  
  // 이미 숫자인 경우
  if (typeof value === 'number') return value;
  
  // 문자열인 경우 콤마 제거 후 숫자 변환
  if (typeof value === 'string') {
    const cleanValue = value.replace(/,/g, '');
    const parsed = parseFloat(cleanValue);
    return isNaN(parsed) ? null : parsed;
  }
  
  return null;
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // 파일을 버퍼로 변환
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 엑셀 파일 읽기 (cellDates 옵션 추가)
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });

    // 첫 번째 행은 헤더이므로 제외, 모든 데이터 처리
    const dataRows = jsonData.slice(1) as any[][];

    const invoiceDataArray: any[] = [];
    
    // 병합된 셀을 처리하기 위한 이전 값 저장
    let lastOrderNumber = '';
    let lastSeller = '';
    let lastProductName = '';
    let lastOfferId = '';
    let lastOrderDate = null;
    let lastPaymentDate = null;
    let lastPrice = null;
    let lastDeliveryFee = null;
    let lastTotalPrice = null;
    
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      
      // 각 셀의 값이 있으면 사용하고, 없으면 이전 값 사용 (병합된 셀 처리)
      const orderNumber = row[0] || lastOrderNumber;
      const seller = row[3] || lastSeller;
      const price = parseNumber(row[5]) ?? lastPrice;
      const deliveryFee = parseNumber(row[6]) ?? lastDeliveryFee;
      const totalPrice = parseNumber(row[8]) ?? lastTotalPrice; // I열
      const orderDate = excelDateToJSDate(row[10]) || lastOrderDate;
      const paymentDate = excelDateToJSDate(row[11]) || lastPaymentDate;
      const productName = row[18] || lastProductName;
      const offerId = row[24] || lastOfferId;
      const deliveryNumber = row[31] || null; // 병합 처리하지 않고 각 행의 실제 값만 사용
      
      // 현재 행에 실제 데이터가 있는 경우만 처리 (완전히 빈 행 제외)
      if (orderNumber || row[19] || row[20]) { // 주문번호나 단가, 수량이 있으면 유효한 행으로 간주
        const invoiceItem = {
          order_number: orderNumber, // A열
          delivery_fee: deliveryFee, // G열
          delivery_number: deliveryNumber, // AF열
          invoice: null, // 비워두기
          order_date: orderDate, // K열
          payment_date: paymentDate, // L열
          price: price, // F열
          product_name: productName, // S열
          seller: seller, // D열
          total_price: totalPrice, // I열
          order_qty: parseNumber(row[20]), // U열
          unit_price: parseNumber(row[19]), // T열
          offer_id: offerId, // Y열
          img_upload: false, // 기본값 false
          file_extension: null, // 비워두기
          received_qty: null, // 비워두기
          memo: null, // 비워두기
          category: null, // 비워두기
          composition: null, // 비워두기
          order_status: row[9] || null // J열
        };
        
        invoiceDataArray.push(invoiceItem);
        
        // 이전 값 업데이트 (다음 행에서 사용할 수 있도록)
        if (row[0]) lastOrderNumber = row[0];
        if (row[3]) lastSeller = row[3];
        if (row[5] !== undefined && row[5] !== null) lastPrice = parseNumber(row[5]);
        if (row[6] !== undefined && row[6] !== null) lastDeliveryFee = parseNumber(row[6]);
        if (row[8] !== undefined && row[8] !== null) lastTotalPrice = parseNumber(row[8]); // I열
        if (row[10]) lastOrderDate = excelDateToJSDate(row[10]);
        if (row[11]) lastPaymentDate = excelDateToJSDate(row[11]);
        if (row[18]) lastProductName = row[18];
        if (row[24]) lastOfferId = row[24];
      }
    }

    // Supabase에 데이터 저장 (일반 insert 사용)
    if (invoiceDataArray.length > 0) {
      const { data, error } = await supabase
        .from('1688_invoice')
        .insert(invoiceDataArray);

      if (error) {
        console.error('Supabase 저장 오류:', error);
        return NextResponse.json({ 
          error: 'Supabase 저장 중 오류가 발생했습니다.',
          details: error.message
        }, { status: 500 });
      }
    }

    return NextResponse.json({ 
      message: '엑셀 파일이 성공적으로 업로드되었습니다.',
      count: invoiceDataArray.length 
    });

  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: '업로드 중 오류가 발생했습니다.' }, { status: 500 });
  }
} 