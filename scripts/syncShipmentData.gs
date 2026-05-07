// ============================================================
// syncShipmentData.gs
//
// shipment-v2 출고준비 데이터를 '작업' 시트에 동기화
//
// 사전 조건:
//   seller_account.gs 에 아래 상수가 정의되어 있어야 함
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - USER_ID
//
// 메뉴: 스프레드시트 상단 → [출고준비] → [작업 시트 동기화]
// ============================================================

// ============================================================
// 메인 함수 — 출고준비 데이터 동기화
// (메뉴 버튼은 기존 스크립트에서 등록 — 여기서 생성하지 않음)
// ============================================================
function syncShipmentData() {
  var ui = SpreadsheetApp.getUi();
  Logger.log('=== syncShipmentData 시작 ===');
  Logger.log('SUPABASE_URL: ' + (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL.substring(0, 30) + '...' : 'undefined'));
  Logger.log('USER_ID: ' + (typeof USER_ID !== 'undefined' ? USER_ID : 'undefined'));

  // ── 1) ft_fulfillment_outbounds: PACKED & shipment_id IS NULL ──
  var fulfillments = supabaseGet(
    'ft_fulfillment_outbounds',
    'id,box_code,order_item_id,quantity,product_no',
    [
      { column: 'user_id', op: 'eq', value: USER_ID },
      { column: 'type', op: 'eq', value: 'PACKED' },
      { column: 'shipment_id', op: 'is', value: 'null' }
    ]
  );

  Logger.log('fulfillments 조회 결과: ' + fulfillments.length + '건');
  if (fulfillments.length > 0) {
    Logger.log('첫 번째 행 샘플: ' + JSON.stringify(fulfillments[0]));
  }

  if (fulfillments.length === 0) {
    ui.alert('출고준비 데이터가 없습니다.\n\n디버그 로그는 [보기] → [로그] 에서 확인하세요.');
    return;
  }

  // order_item_id 유니크 추출
  var orderItemIdSet = {};
  fulfillments.forEach(function(f) {
    if (f.order_item_id) orderItemIdSet[f.order_item_id] = true;
  });
  var orderItemIds = Object.keys(orderItemIdSet);
  Logger.log('유니크 order_item_id: ' + orderItemIds.length + '개');

  // ── 2) ft_order_items: 상품 정보 + 추가 필드 ──
  var oiRows = supabaseBatchIn(
    'ft_order_items',
    'id,barcode,item_name,option_name,price_cny,price_delivery_cny,order_qty,' +
    'img_url,composition,shipment_type,coupang_shipment_size,personal_order_no,' +
    'vendor_option_id,set_total,product_id,product_no',
    'id',
    orderItemIds
  );
  Logger.log('ft_order_items 조회 결과: ' + oiRows.length + '건');

  // order_item_id → row 매핑
  var orderItems = {};
  oiRows.forEach(function(row) { orderItems[row.id] = row; });

  // ── 2b) 세트상품 단가 합산 ──
  var setProductIdSet = {};
  oiRows.forEach(function(r) {
    if ((r.set_total || 0) > 1 && r.product_id) {
      setProductIdSet[r.product_id] = true;
    }
  });
  var setProductIds = Object.keys(setProductIdSet);
  var setPriceMap = {}; // product_id → 합산 단가

  if (setProductIds.length > 0) {
    var setRows = supabaseBatchIn(
      'ft_order_items',
      'product_id,price_cny,price_delivery_cny,order_qty',
      'product_id',
      setProductIds
    );

    var setCnySumMap = {};
    var setDeliveryMap = {};

    setRows.forEach(function(s) {
      setCnySumMap[s.product_id] = (setCnySumMap[s.product_id] || 0) + (s.price_cny || 0);
      if (!(s.product_id in setDeliveryMap)) {
        setDeliveryMap[s.product_id] = (s.price_delivery_cny || 0) / (s.order_qty || 1);
      }
    });

    for (var pid in setCnySumMap) {
      var deliveryPerUnit = setDeliveryMap[pid] || 0;
      setPriceMap[pid] = Math.round((setCnySumMap[pid] + deliveryPerUnit) * 100) / 100;
    }
  }

  // ── 3) available_qty 계산 ──
  var inboundFf = supabaseBatchIn(
    'ft_fulfillment_inbounds',
    'order_item_id,quantity,type',
    'order_item_id',
    orderItemIds
  );
  Logger.log('ft_fulfillment_inbounds 조회 결과: ' + inboundFf.length + '건');

  var outboundFf = supabaseBatchIn(
    'ft_fulfillment_outbounds',
    'order_item_id,quantity,type,shipment_id',
    'order_item_id',
    orderItemIds
  );
  Logger.log('ft_fulfillment_outbounds (available용) 조회 결과: ' + outboundFf.length + '건');

  var availableMap = {};

  inboundFf.forEach(function(f) {
    if (f.type === 'ARRIVAL') {
      availableMap[f.order_item_id] = (availableMap[f.order_item_id] || 0) + f.quantity;
    } else if (f.type === 'RETURN') {
      availableMap[f.order_item_id] = (availableMap[f.order_item_id] || 0) - f.quantity;
    }
  });

  outboundFf.forEach(function(f) {
    if (f.type === 'PACKED' && f.shipment_id != null) {
      availableMap[f.order_item_id] = (availableMap[f.order_item_id] || 0) - f.quantity;
    }
  });

  // ── 4) 결과 조립 + box_code 정렬 ──
  var rows = fulfillments.map(function(ff) {
    var oi = orderItems[ff.order_item_id] || {};

    // 단가 계산
    var price = null;
    if (oi.id) {
      if ((oi.set_total || 0) > 1 && oi.product_id && setPriceMap[oi.product_id] != null) {
        price = setPriceMap[oi.product_id];
      } else {
        price = Math.round(((oi.price_cny || 0) + (oi.price_delivery_cny || 0) / (oi.order_qty || 1)) * 100) / 100;
      }
    }

    return {
      box_code: ff.box_code || '',
      product_no: ff.product_no || oi.product_no || '',
      barcode: oi.barcode || '',
      item_name: oi.item_name || '',
      option_name: oi.option_name || '',
      quantity: ff.quantity || 0,
      available_qty: availableMap[ff.order_item_id] || 0,
      price_cny: price,
      img_url: oi.img_url || '',
      composition: oi.composition || '',
      shipment_type: oi.shipment_type || '',
      vendor_option_id: oi.vendor_option_id || '',
      coupang_shipment_size: oi.coupang_shipment_size || '',
      personal_order_no: oi.personal_order_no || ''
    };
  });

  // box_code 기준 정렬
  rows.sort(function(a, b) { return a.box_code.localeCompare(b.box_code); });
  Logger.log('최종 rows: ' + rows.length + '건');

  // ── 5) '작업' 시트에 기록 ──
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('작업');
  if (!sheet) {
    sheet = ss.insertSheet('작업');
  }

  // 기존 데이터 클리어
  sheet.clear();

  // 헤더 (1행)
  var headers = [
    '박스번호',   // A
    '주문번호',   // B
    '바코드',     // C
    '상품명',     // D
    '옵션명',     // E
    '스캔',       // F
    '입고 개수',  // G
    '',           // H (빈 열)
    '단가',       // I
    '이미지',     // J
    '혼용률',     // K
    'shipment_type',        // L
    'option_id',            // M
    'coupang_shipment_size', // N
    'personal_order_no'     // O
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (rows.length === 0) {
    ui.alert('작업 시트 동기화 완료 (0건)');
    return;
  }

  // 데이터 (2행부터)
  var data = rows.map(function(r) {
    return [
      r.box_code,           // A
      r.product_no,         // B
      r.barcode,            // C
      r.item_name,          // D
      r.option_name,        // E
      r.quantity,           // F
      r.available_qty,      // G
      '',                   // H (빈 열)
      r.price_cny,          // I
      r.img_url,            // J
      r.composition,        // K
      r.shipment_type,      // L
      r.vendor_option_id,   // M
      r.coupang_shipment_size, // N
      r.personal_order_no   // O
    ];
  });

  sheet.getRange(2, 1, data.length, headers.length).setValues(data);
  Logger.log('=== 시트 기록 완료: ' + data.length + '행 ===');

  ui.alert('작업 시트 동기화 완료 (' + rows.length + '건)');
}


// ============================================================
// Supabase REST API 헬퍼
// ============================================================

/**
 * Supabase GET — 필터 조건으로 조회 (1000건 페이지네이션)
 * limit/offset 쿼리 파라미터 방식 사용 (Range 헤더보다 안정적)
 */
function supabaseGet(table, select, filters) {
  var all = [];
  var pageSize = 1000;
  var offset = 0;

  while (true) {
    // select는 인코딩하지 않음 — PostgREST가 콤마를 구분자로 사용
    var url = SUPABASE_URL + '/rest/v1/' + table
      + '?select=' + select
      + '&limit=' + pageSize
      + '&offset=' + offset;

    // 필터 추가
    filters.forEach(function(f) {
      if (f.op === 'eq') {
        url += '&' + f.column + '=eq.' + encodeURIComponent(f.value);
      } else if (f.op === 'is') {
        url += '&' + f.column + '=is.' + f.value;
      } else if (f.op === 'in') {
        url += '&' + f.column + '=in.(' + f.value + ')';
      }
    });

    var options = {
      method: 'get',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY
      },
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    var text = response.getContentText();

    // 에러 체크
    if (code >= 400) {
      Logger.log('[supabaseGet ERROR] ' + table + ' | HTTP ' + code + ' | ' + text.substring(0, 500));
      break;
    }

    var data = JSON.parse(text);
    if (!Array.isArray(data)) {
      Logger.log('[supabaseGet ERROR] ' + table + ' | 배열이 아닌 응답: ' + text.substring(0, 300));
      break;
    }

    if (data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

/**
 * Supabase IN 조건 배치 조회 — values 배열을 200개씩 분할하여 조회
 * (URL 길이 제한 대응: UUID 36자 × 200 + 따옴표 ≈ 8KB)
 */
function supabaseBatchIn(table, select, column, values) {
  var all = [];
  var batchSize = 200;

  for (var i = 0; i < values.length; i += batchSize) {
    var batch = values.slice(i, i + batchSize);
    // UUID/일반 문자열 모두 따옴표 없이 전달 (UrlFetchApp이 쌍따옴표를 URL에 허용하지 않음)
    var inValue = batch.join(',');

    var result = supabaseGet(table, select, [
      { column: column, op: 'in', value: inValue }
    ]);
    all = all.concat(result);
  }

  return all;
}


// ============================================================
// 디버깅 전용 — 연결 테스트 (문제 시 이 함수를 먼저 실행)
// ============================================================
function testSupabaseConnection() {
  Logger.log('=== Supabase 연결 테스트 ===');
  Logger.log('SUPABASE_URL: ' + (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : 'NOT DEFINED'));
  Logger.log('SUPABASE_SERVICE_ROLE_KEY: ' + (typeof SUPABASE_SERVICE_ROLE_KEY !== 'undefined' ? 'SET (' + SUPABASE_SERVICE_ROLE_KEY.length + '자)' : 'NOT DEFINED'));
  Logger.log('USER_ID: ' + (typeof USER_ID !== 'undefined' ? USER_ID : 'NOT DEFINED'));

  // 간단한 1건 조회 테스트
  var url = SUPABASE_URL + '/rest/v1/ft_fulfillment_outbounds'
    + '?select=id,type,shipment_id'
    + '&user_id=eq.' + encodeURIComponent(USER_ID)
    + '&type=eq.PACKED'
    + '&shipment_id=is.null'
    + '&limit=3';

  Logger.log('테스트 URL: ' + url);

  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY
    },
    muteHttpExceptions: true
  });

  Logger.log('HTTP 상태: ' + response.getResponseCode());
  Logger.log('응답 본문: ' + response.getContentText().substring(0, 1000));
  Logger.log('=== 테스트 완료 — [보기] → [로그] 에서 결과 확인 ===');
}
