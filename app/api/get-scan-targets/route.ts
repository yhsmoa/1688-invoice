import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function GET(request: NextRequest) {
  try {
    console.log('스캔 대상 데이터 가져오기 API 호출');
    
    // 1. invoice_import_googlesheet 데이터 조회
    const { data: importData, error: importError } = await supabase
      .from('invoice_import_googlesheet')
      .select(`
        barcode,
        img_url,
        product_name,
        option_name,
        china_option1,
        china_option2,
        import_qty,
        export_qty
      `)
      .not('barcode', 'is', null);
    
    if (importError) {
      console.error('import 데이터 조회 오류:', importError);
      return NextResponse.json({ 
        error: 'import 데이터를 가져오는데 실패했습니다.', 
        details: importError.message 
      }, { status: 500 });
    }

    // 2. 1688_shipment 데이터 조회 (바코드별 qty 합계)
    const { data: shipmentData, error: shipmentError } = await supabase
      .from('1688_shipment')
      .select('barcode, qty')
      .not('barcode', 'is', null);
    
    if (shipmentError) {
      console.error('shipment 데이터 조회 오류:', shipmentError);
      return NextResponse.json({ 
        error: 'shipment 데이터를 가져오는데 실패했습니다.', 
        details: shipmentError.message 
      }, { status: 500 });
    }

    // 3. shipment 데이터를 바코드별로 집계
    const shipmentMap = new Map();
    shipmentData.forEach(item => {
      const barcode = item.barcode;
      const qty = item.qty || 0;
      
      if (shipmentMap.has(barcode)) {
        shipmentMap.set(barcode, shipmentMap.get(barcode) + qty);
      } else {
        shipmentMap.set(barcode, qty);
      }
    });
    
    // 4. import 데이터를 바코드별로 집계하고 shipment qty 차감
    const barcodeMap = new Map();
    
    importData.forEach(item => {
      const barcode = item.barcode;
      const importQty = item.import_qty || 0;
      const exportQty = item.export_qty || 0;
      const shipmentQty = shipmentMap.get(barcode) || 0; // shipment에서 이미 찍은 수량
      
      if (barcodeMap.has(barcode)) {
        // 기존 바코드가 있으면 수량만 누적
        const existing = barcodeMap.get(barcode);
        existing.total_import_qty += importQty;
        existing.total_export_qty += exportQty;
        // available_qty = import_qty - export_qty - shipment_qty
        existing.available_qty = existing.total_import_qty - existing.total_export_qty - existing.total_shipment_qty;
      } else {
        // 새로운 바코드면 추가
        barcodeMap.set(barcode, {
          barcode: barcode,
          img_url: item.img_url,
          product_name: item.product_name,
          option_name: item.option_name,
          china_option1: item.china_option1,
          china_option2: item.china_option2,
          total_import_qty: importQty,
          total_export_qty: exportQty,
          total_shipment_qty: shipmentQty,
          available_qty: importQty - exportQty - shipmentQty
        });
      }
    });
    
    // 5. available_qty > 0인 항목만 필터링
    const scanTargets = Array.from(barcodeMap.values())
      .filter(item => item.available_qty > 0)
      .map(item => ({
        barcode: item.barcode,
        img_url: item.img_url,
        product_name: item.product_name,
        option_name: item.option_name,
        china_option1: item.china_option1,
        china_option2: item.china_option2,
        available_qty: item.available_qty
      }))
      .sort((a, b) => a.barcode.localeCompare(b.barcode)); // 바코드 순으로 정렬
    
    console.log(`${scanTargets.length}개의 스캔 대상 데이터 조회 완료`);
    
    return NextResponse.json({ 
      success: true, 
      data: scanTargets,
      count: scanTargets.length
    });
  } catch (error) {
    console.error('스캔 대상 데이터 처리 중 오류:', error);
    return NextResponse.json({ 
      error: '스캔 대상 데이터 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}