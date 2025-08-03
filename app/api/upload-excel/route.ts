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

// Next.js 14 API 라우트 형식으로 수정
export const POST = async (request: NextRequest) => {
  console.log('엑셀 파일 업로드 API가 호출되었습니다.');
  
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    console.log('파일 수신:', file?.name, file?.size);

    if (!file) {
      console.log('파일이 업로드되지 않았습니다.');
      return NextResponse.json({ error: '파일이 업로드되지 않았습니다.' }, { status: 400 });
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
    let lastValues: { [key: number]: any } = {};
    
    // 주요 컬럼 인덱스 정의
    const COLUMNS = {
      ORDER_NUMBER: 0,    // A열 - 주문번호
      SELLER: 3,          // D열 - 판매자
      PRICE: 5,           // F열 - 가격
      DELIVERY_FEE: 6,    // G열 - 배송비
      TOTAL_PRICE: 8,     // I열 - 총 가격
      ORDER_STATUS: 9,    // J열 - 주문 상태
      ORDER_DATE: 10,     // K열 - 주문 날짜
      PAYMENT_DATE: 11,   // L열 - 결제 날짜
      PRODUCT_NAME: 18,   // S열 - 상품명
      UNIT_PRICE: 19,     // T열 - 단가
      ORDER_QTY: 20,      // U열 - 주문 수량
      OFFER_ID: 24,       // Y열 - 상품 ID
      SKU_ID: 25,         // Z열 - SKU ID
      DELIVERY_NUMBER: 31 // AF열 - 송장번호
    };
    
    // 운송장 번호 처리를 위한 맵 생성
    const deliveryNumbersMap = new Map<string, string[]>();
    
    // 첫 번째 패스: 운송장 번호 수집
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row) continue;
      
      const orderNumber = row[COLUMNS.ORDER_NUMBER];
      const deliveryNumber = row[COLUMNS.DELIVERY_NUMBER];
      
      if (orderNumber && deliveryNumber) {
        if (!deliveryNumbersMap.has(orderNumber)) {
          deliveryNumbersMap.set(orderNumber, []);
        }
        
        const numbers = deliveryNumbersMap.get(orderNumber)!;
        // 중복 제거 - 이미 있는 송장번호는 추가하지 않음
        if (!numbers.includes(deliveryNumber)) {
          numbers.push(deliveryNumber);
        }
      }
    }
    
    console.log('운송장 번호 맵 생성 완료:', Object.fromEntries(deliveryNumbersMap));
    
    // 병합 셀 처리를 위한 설정
    const MERGED_COLUMNS = [
      COLUMNS.ORDER_NUMBER,
      COLUMNS.SELLER,
      COLUMNS.ORDER_STATUS,
      COLUMNS.ORDER_DATE,
      COLUMNS.PAYMENT_DATE,
      COLUMNS.OFFER_ID,
      COLUMNS.PRICE,
      COLUMNS.DELIVERY_FEE,
      COLUMNS.TOTAL_PRICE
    ];
    
    // 독립적인 값을 가져야 하는 컬럼 (이전 값을 사용하지 않음)
    const INDEPENDENT_COLUMNS = [
      COLUMNS.PRODUCT_NAME,
      COLUMNS.UNIT_PRICE,
      COLUMNS.ORDER_QTY,
      COLUMNS.SKU_ID
    ];
    
    console.log('Excel 데이터 행 처리 시작:', dataRows.length);
    
    // 새로운 주문 그룹 시작 여부를 확인하는 함수
    const isNewOrderGroup = (row: any[]) => {
      // 주문번호가 있으면 새 그룹 시작
      return row[COLUMNS.ORDER_NUMBER] !== undefined && 
             row[COLUMNS.ORDER_NUMBER] !== null && 
             row[COLUMNS.ORDER_NUMBER] !== '';
    };
    
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row) {
        console.log(`빈 행을 건너뛰었습니다. 인덱스: ${i}`);
        continue;
      }
      
      // 새 주문 그룹이 시작되면 독립적인 값들 초기화
      if (isNewOrderGroup(row)) {
        INDEPENDENT_COLUMNS.forEach(col => {
          delete lastValues[col];
        });
      }
      
      // 각 컬럼에 대해 현재 값이 있으면 사용하고, 없으면 이전 값 사용
      const getValue = (colIndex: number) => {
        // 현재 행에 값이 있으면 해당 값 사용
        if (row[colIndex] !== undefined && row[colIndex] !== null && row[colIndex] !== '') {
          lastValues[colIndex] = row[colIndex];
          return row[colIndex];
        }
        
        // 병합 컬럼이 아니면 이전 값을 사용하지 않음
        if (!MERGED_COLUMNS.includes(colIndex)) {
          return null;
        }
        
        // 병합 컬럼이면 이전에 저장된 값 사용
        return lastValues[colIndex];
      };
      
      // 숫자 값 처리
      const getNumberValue = (colIndex: number) => {
        const value = getValue(colIndex);
        return parseNumber(value);
      };
      
      // 날짜 값 처리
      const getDateValue = (colIndex: number) => {
        const value = getValue(colIndex);
        return excelDateToJSDate(value);
      };
      
      try {
        // 각 컬럼 값 가져오기
        const orderNumber = getValue(COLUMNS.ORDER_NUMBER);
        const seller = getValue(COLUMNS.SELLER);
        const price = getNumberValue(COLUMNS.PRICE);
        const deliveryFee = getNumberValue(COLUMNS.DELIVERY_FEE);
        const totalPrice = getNumberValue(COLUMNS.TOTAL_PRICE);
        const orderStatus = getValue(COLUMNS.ORDER_STATUS);
        const orderDate = getDateValue(COLUMNS.ORDER_DATE);
        const paymentDate = getDateValue(COLUMNS.PAYMENT_DATE);
        const productName = getValue(COLUMNS.PRODUCT_NAME);
        const unitPrice = getNumberValue(COLUMNS.UNIT_PRICE);
        const orderQty = getNumberValue(COLUMNS.ORDER_QTY);
        const offerId = getValue(COLUMNS.OFFER_ID);
        const skuId = getValue(COLUMNS.SKU_ID);
        const deliveryNumber = getValue(COLUMNS.DELIVERY_NUMBER);
        
        // 현재 행에 실제 데이터가 있는 경우만 처리 (완전히 빈 행 제외)
        if (orderNumber || unitPrice || orderQty) {
          // 운송장 번호 처리
          const deliveryNumbers = deliveryNumbersMap.get(orderNumber) || [];
          
          const invoiceItem = {
            order_number: orderNumber,
            delivery_fee: deliveryFee,
            delivery_number1: deliveryNumbers[0] || null,
            delivery_number2: deliveryNumbers[1] || null,
            delivery_number3: deliveryNumbers[2] || null,
            delivery_number4: deliveryNumbers[3] || null,
            delivery_number5: deliveryNumbers[4] || null,
            invoice: null, // 비워두기
            order_date: orderDate,
            payment_date: paymentDate,
            price: price,
            product_name: productName,
            seller: seller,
            total_price: totalPrice,
            order_qty: orderQty,
            unit_price: unitPrice,
            offer_id: offerId,
            img_upload: false, // 기본값 false
            file_extension: null, // 비워두기
            received_qty: null, // 비워두기
            memo: null, // 비워두기
            category: null, // 비워두기
            composition: null, // 비워두기
            order_status: orderStatus,
            sku_id: skuId
          };
          
          invoiceDataArray.push(invoiceItem);
        }
      } catch (rowError) {
        console.error(`행 ${i} 처리 중 오류 발생:`, rowError);
      }
    }

    console.log(`총 ${invoiceDataArray.length}개의 데이터를 업로드합니다.`);
    
    // 데이터가 비어있는지 확인
    if (invoiceDataArray.length === 0) {
      console.log('Excel 파일에 유효한 데이터가 없습니다.');
      return NextResponse.json({ 
        error: '엑셀 파일에 유효한 데이터가 없습니다.' 
      }, { status: 400 });
    }
    
    // 데이터 저장 시도
    try {
      // 일반 insert로 시도
      console.log('Supabase에 데이터를 저장하려고 합니다...');
      const { data, error } = await supabase
        .from('1688_invoice')
        .insert(invoiceDataArray);
        
      if (error) {
        console.error('Supabase 저장 중 오류:', error);
        return NextResponse.json({ 
          error: 'Supabase 저장 중 오류가 발생했습니다.',
          details: error.message
        }, { status: 500 });
      }
      
      console.log('Supabase 일반 Insert 성공');
      
      return NextResponse.json({ 
        message: '엑셀 파일이 성공적으로 업로드되었습니다.',
        count: invoiceDataArray.length 
      });
    } catch (dbError) {
      console.error('데이터베이스 저장 중 예외 발생:', dbError);
      return NextResponse.json({ 
        error: '데이터 저장 중 오류가 발생했습니다.',
        details: dbError instanceof Error ? dbError.message : 'Unknown error'
      }, { status: 500 });
    }
  } catch (error) {
    console.error('업로드 중 오류 발생:', error);
    return NextResponse.json({ 
      error: '업로드 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 