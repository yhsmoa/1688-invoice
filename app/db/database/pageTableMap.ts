// ============================================================
// 페이지 ↔ Supabase 테이블 매핑 정의
//
//   코드에서 직접 도출한 정적 매핑이다. (페이지 → 호출 API → .from('테이블'))
//   API route 를 추가/변경하면 이 파일도 함께 갱신한다.
//
//   · 기본 DB      : lib/supabase.ts        → SUPABASE_URL (manage-item)
//   · 보조 DB      : lib/stockSupabase.ts   → STOCK_SUPABASE_URL (stock_management)
//   · Google Sheets / Notion 은 테이블이 아니므로 external 로 표기
// ============================================================

// ── 데이터 소스 종류 ──
export type ExternalSource = 'Google Sheets' | 'Notion API' | 'Supabase Storage' | '엑셀 처리 전용';

// ── API route 1건과 그 route 가 접근하는 테이블 ──
export interface ApiUsage {
  route: string;
  tables: string[];
}

// ── 페이지 1건 ──
export interface PageEntry {
  name: string;
  route: string;
  file: string;
  apis: ApiUsage[];
  external?: ExternalSource[];
  note?: string;
}

// ── 좌측 메뉴 기준 그룹 ──
export interface PageGroup {
  group: string;
  desc: string;
  pages: PageEntry[];
}

// ============================================================
// 특수 표기 대상 테이블
// ============================================================

// 코드는 참조하지만 DB(manage-item)에 실제로 존재하지 않는 테이블
export const MISSING_TABLES = new Set<string>([
  'invoiceManager-label',
  'item_note',
  'items',
]);

// 기본 DB 가 아닌 별도 Supabase 프로젝트(stock_management)의 테이블
export const EXTERNAL_TABLES = new Set<string>([
  'si_users',
]);

// ============================================================
// 페이지 ↔ 테이블 매핑
// ============================================================
export const PAGE_TABLE_MAP: PageGroup[] = [
  // ── V2 (메인 플로우) ──────────────────────────────────────
  {
    group: 'V2 (메인)',
    desc: 'Supabase ft_* 테이블 기반 현행 플로우',
    pages: [
      {
        name: '주문상태',
        route: '/order-status-v2',
        file: 'app/order-status-v2/OrderStatusV2.tsx',
        apis: [
          { route: '/api/ft/users', tables: ['ft_users'] },
          { route: '/api/ft/order-items', tables: ['ft_order_items'] },
          {
            route: '/api/ft/fulfillments',
            tables: ['ft_fulfillment_inbounds', 'ft_fulfillment_outbounds', 'ft_cancel_details', 'ft_order_items'],
          },
          { route: '/api/ft/1688-delivery-status', tables: ['im_1688_orders_delivery_status'] },
          { route: '/api/ft/delivery-codes', tables: ['1688_invoice_deliveryInfo_check'] },
        ],
      },
      {
        name: '상품입고',
        route: '/import-product-v2',
        file: 'app/import-product-v2/ItemCheck.tsx',
        apis: [
          { route: '/api/ft/users', tables: ['ft_users'] },
          { route: '/api/ft/order-items', tables: ['ft_order_items'] },
          { route: '/api/ft/order-items/match-order-id', tables: ['ft_order_items'] },
          { route: '/api/ft/order-items/export-xlsx', tables: ['ft_order_items'] },
          {
            route: '/api/ft/fulfillments',
            tables: ['ft_fulfillment_inbounds', 'ft_fulfillment_outbounds', 'ft_cancel_details', 'ft_order_items'],
          },
          { route: '/api/ft/cancel', tables: ['ft_fulfillment_inbounds', 'ft_cancel_details'] },
          { route: '/api/ft/classify-products', tables: ['ft_order_items'] },
          { route: '/api/ft/delivery-codes', tables: ['1688_invoice_deliveryInfo_check'] },
          { route: '/api/ft/v2-migration/upload-xlsx', tables: ['ft_users'] },
          { route: '/api/ft/personal-invoice-prints', tables: ['ft_personal_invoice_prints'] },
          { route: '/api/ft/personal-invoices/check', tables: ['si_users'] },
          { route: '/api/ft/personal-invoices/signed-urls', tables: ['si_users'] },
          { route: '/api/upload-delivery-excel', tables: ['1688_invoice_deliveryInfo_check'] },
          { route: '/api/upload-delivery-status-csv', tables: ['im_1688_orders_delivery_status'] },
          { route: '/api/save-fashion-label', tables: ['invoiceManager_label'] },
          { route: '/api/hr/workers', tables: ['invoiceManager_employees'] },
          { route: '/api/notion/customer-confirm', tables: [] },
        ],
        external: ['Notion API', 'Supabase Storage'],
        note: '고객확인 모달은 Notion API, 개인통관 PDF 는 stock_management 프로젝트의 Storage 사용',
      },
      {
        name: '상품출고',
        route: '/export-product-v2',
        file: 'app/export-product-v2/ExportProduct.tsx',
        apis: [
          { route: '/api/ft/order-items', tables: ['ft_order_items'] },
          {
            route: '/api/ft/fulfillments',
            tables: ['ft_fulfillment_inbounds', 'ft_fulfillment_outbounds', 'ft_cancel_details', 'ft_order_items'],
          },
          { route: '/api/ft/box-info', tables: ['ft_box_info', 'ft_fulfillment_outbounds'] },
          { route: '/api/hr/workers', tables: ['invoiceManager_employees'] },
          { route: '/api/get-coupang-users', tables: ['users_api'] },
          { route: '/api/load-google-sheet-optimized', tables: ['invoice_import_googlesheet'] },
          { route: '/api/load-scan-data', tables: [] },
          { route: '/api/save-scan-data', tables: [] },
        ],
        external: ['Google Sheets'],
      },
      {
        name: '쉽먼트',
        route: '/shipment-v2',
        file: 'app/shipment-v2/ShipmentV2.tsx',
        apis: [
          { route: '/api/ft/shipment-v2', tables: ['ft_order_items', 'ft_box_info', 'ft_fulfillment_outbounds'] },
          { route: '/api/ft/order-items', tables: ['ft_order_items'] },
          { route: '/api/ft/box-info', tables: ['ft_box_info', 'ft_fulfillment_outbounds'] },
          { route: '/api/ft/shipments', tables: ['ft_shipments', 'ft_box_info', 'ft_fulfillment_outbounds'] },
          { route: '/api/ft/classify-products', tables: ['ft_order_items'] },
        ],
      },
      {
        name: '출고완료',
        route: '/shipment-complete-v2',
        file: 'app/shipment-complete-v2/ShipmentCompleteV2.tsx',
        apis: [
          { route: '/api/ft/shipments', tables: ['ft_shipments', 'ft_box_info', 'ft_fulfillment_outbounds'] },
          { route: '/api/ft/shipment-details', tables: ['ft_shipment_details'] },
          { route: '/api/ft/shipment-v2', tables: ['ft_order_items', 'ft_box_info', 'ft_fulfillment_outbounds'] },
        ],
      },
      {
        name: '반품접수',
        route: '/return-product-v2',
        file: 'app/return-product-v2/ReturnProductV2.tsx',
        apis: [
          { route: '/api/ft/users', tables: ['ft_users'] },
          { route: '/api/ft/cancel-details', tables: ['ft_cancel_details'] },
          {
            route: '/api/ft/fulfillments',
            tables: ['ft_fulfillment_inbounds', 'ft_fulfillment_outbounds', 'ft_cancel_details', 'ft_order_items'],
          },
          { route: '/api/hr/workers', tables: ['invoiceManager_employees'] },
        ],
      },
    ],
  },

  // ── 계좌관리 ──────────────────────────────────────────────
  {
    group: '계좌관리',
    desc: '고객·무역 계좌 잔액 및 입출금 내역',
    pages: [
      {
        name: '고객계좌',
        route: '/invoice/payment-history',
        file: 'app/invoice/payment-history/PaymentHistory.tsx',
        apis: [
          { route: '/api/get-coupang-users', tables: ['users_api'] },
          { route: '/api/get-customer-balance', tables: ['invoiceManager_transactions', 'ft_users', 'ft_cancel_details'] },
          { route: '/api/get-payment-transactions', tables: ['invoiceManager_transactions'] },
          { route: '/api/save-payment-transaction', tables: ['invoiceManager_balance', 'invoiceManager_transactions'] },
          { route: '/api/update-payment-date', tables: ['invoiceManager_transactions'] },
        ],
      },
      {
        name: '무역계좌',
        route: '/invoice/trade-account',
        file: 'app/invoice/trade-account/page.tsx',
        apis: [
          { route: '/api/get-coupang-users', tables: ['users_api'] },
          { route: '/api/get-customer-balance', tables: ['invoiceManager_transactions', 'ft_users', 'ft_cancel_details'] },
          { route: '/api/get-payment-transactions', tables: ['invoiceManager_transactions'] },
          { route: '/api/save-payment-transaction', tables: ['invoiceManager_balance', 'invoiceManager_transactions'] },
          { route: '/api/update-payment-date', tables: ['invoiceManager_transactions'] },
        ],
        note: '고객계좌(PaymentHistory)를 그대로 재사용 — 데이터 소스 동일',
      },
    ],
  },

  // ── 수출 송장 ─────────────────────────────────────────────
  {
    group: '수출 송장',
    desc: '통관 정보·서류 및 라벨 출력',
    pages: [
      {
        name: '통관정보',
        route: '/export-invoice/customs-info',
        file: 'app/export-invoice/customs-info/page.tsx',
        apis: [
          { route: '/api/get-customs-data', tables: ['invoiceManager-Customs'] },
          { route: '/api/upload-customs-excel', tables: ['invoiceManager-Customs'] },
        ],
      },
      {
        name: '통관서류',
        route: '/export-invoice/customs-document',
        file: 'app/export-invoice/customs-document/page.tsx',
        apis: [
          { route: '/api/search-order-info', tables: ['1688_invoice_deliveryInfo_check'] },
          { route: '/api/export-customs-excel', tables: ['invoiceManager-Customs'] },
          { route: '/api/process-delivery-excel', tables: [] },
        ],
        external: ['엑셀 처리 전용'],
      },
      {
        name: '박스 라벨',
        route: '/export-invoice/box-label',
        file: 'app/export-invoice/box-label/page.tsx',
        apis: [],
        note: 'API 호출 없음 — 클라이언트 전용 출력 화면',
      },
      {
        name: 'PDF 분할',
        route: '/export-invoice/pdf-split',
        file: 'app/export-invoice/pdf-split/page.tsx',
        apis: [],
        note: 'API 호출 없음 — 클라이언트 전용 PDF 처리',
      },
    ],
  },

  // ── 인사 관리 ─────────────────────────────────────────────
  {
    group: '인사 관리',
    desc: '직원·출퇴근·급여',
    pages: [
      {
        name: '출퇴근 스캔',
        route: '/hr/attendance-scan',
        file: 'app/hr/attendance-scan/AttendanceScan.tsx',
        apis: [
          { route: '/api/hr/attendance/daily', tables: ['invoiceManager_emplyee_records', 'invoiceManager_employees'] },
          { route: '/api/hr/attendance/lookup', tables: ['invoiceManager_employees', 'invoiceManager_emplyee_records'] },
          { route: '/api/hr/attendance/clock-in', tables: ['invoiceManager_emplyee_records'] },
          { route: '/api/hr/attendance/clock-out', tables: ['invoiceManager_emplyee_records'] },
        ],
      },
      {
        name: '직원관리',
        route: '/hr/employees',
        file: 'app/hr/employees/EmployeeManagement.tsx',
        apis: [
          { route: '/api/hr/verify-access', tables: ['invoiceManager_employees'] },
          { route: '/api/hr/employees', tables: ['invoiceManager_employees'] },
          { route: '/api/hr/employees/[id]', tables: ['invoiceManager_employees'] },
        ],
      },
      {
        name: '급여장부',
        route: '/hr/payroll',
        file: 'app/hr/payroll/Payroll.tsx',
        apis: [
          { route: '/api/hr/payroll', tables: ['invoiceManager_emplyee_records', 'invoiceManager_employees'] },
          { route: '/api/hr/payroll/export-excel', tables: ['invoiceManager_emplyee_records', 'invoiceManager_employees'] },
          { route: '/api/hr/verify-access', tables: ['invoiceManager_employees'] },
          { route: '/api/hr/attendance/create', tables: ['invoiceManager_emplyee_records'] },
          { route: '/api/hr/attendance/update-time', tables: ['invoiceManager_emplyee_records'] },
          { route: '/api/hr/attendance/[id]', tables: ['invoiceManager_emplyee_records'] },
        ],
      },
    ],
  },

  // ── DB 관리 ───────────────────────────────────────────────
  {
    group: 'DB 관리',
    desc: "데이터베이스 구조 관리 — 접근 권한: access_authorization + role='기업' (현재 YUHWA)",
    pages: [
      {
        name: '주문 데이터 관리',
        route: '/db/orders',
        file: 'app/db/orders/OrderDataManage.tsx',
        apis: [
          { route: '/api/db/order-weekly', tables: ['ft_orders', 'ft_order_items'] },
          { route: '/api/db/verify-access', tables: ['invoiceManager_employees'] },
        ],
        note: '주간/월간 주문량 — 수량은 ft_orders.total_qty 대신 품목(order_qty) 기준으로 집계',
      },
      {
        name: '물량관리',
        route: '/db/volume',
        file: 'app/db/volume/VolumeManage.tsx',
        apis: [
          {
            route: '/api/db/volume-weekly',
            tables: [
              'ft_shipment_details',
              'ft_shipments',
              'ft_fulfillment_inbounds',
              'invoiceManager_emplyee_records',
              'invoiceManager_employees',
            ],
          },
          { route: '/api/db/verify-access', tables: ['invoiceManager_employees'] },
        ],
        note: '주간/월간 출고·입고량 및 근무시간 대비 처리량',
      },
      {
        name: '데이터베이스 관리',
        route: '/db/database',
        file: 'app/db/database/DatabaseManage.tsx',
        apis: [{ route: '/api/db/verify-access', tables: ['invoiceManager_employees'] }],
        note: '이 페이지 — 정적 매핑 문서. 집계 DB 조회는 없고 접근 검증만 수행',
      },
    ],
  },

  // ── V1 (레거시) ───────────────────────────────────────────
  {
    group: 'V1 (레거시)',
    desc: 'Google Sheets 기반 구버전 — 현재도 병행 사용 중',
    pages: [
      {
        name: '주문 통계',
        route: '/order-stats',
        file: 'app/order-stats/page.tsx',
        apis: [
          { route: '/api/get-coupang-users', tables: ['users_api'] },
          { route: '/api/load-progress-stats', tables: [] },
        ],
        external: ['Google Sheets'],
      },
      {
        name: '중국주문',
        route: '/chinaorder',
        file: 'app/chinaorder/chinaorder-new.tsx',
        apis: [{ route: '/api/get-coupang-users', tables: ['users_api'] }],
      },
      {
        name: '주문검색',
        route: '/order-search',
        file: 'app/order-search/page.tsx',
        apis: [{ route: '/api/search-order-info', tables: ['1688_invoice_deliveryInfo_check'] }],
      },
      {
        name: '주문확인',
        route: '/order-check',
        file: 'app/order-check/OrderCheck.tsx',
        apis: [
          { route: '/api/get-coupang-users', tables: ['users_api'] },
          { route: '/api/get-all-delivery-info-check', tables: ['1688_invoice_deliveryInfo_check'] },
          { route: '/api/upload-order-check-excel', tables: ['1688_invoice_deliveryInfo_check'] },
          { route: '/api/load-google-sheet-order-check', tables: [] },
        ],
        external: ['Google Sheets'],
      },
      {
        name: '상품입고 (V1)',
        route: '/import-product',
        file: 'app/import-product/ItemCheck.tsx',
        apis: [
          { route: '/api/get-all-delivery-info', tables: ['1688_invoice_deliveryInfo_check'] },
          { route: '/api/get-1688-orders', tables: ['invoiceManager_1688_orders'] },
          { route: '/api/upload-delivery-excel', tables: ['1688_invoice_deliveryInfo_check'] },
          { route: '/api/upload-delivery-status-csv', tables: ['im_1688_orders_delivery_status'] },
          { route: '/api/save-fashion-label', tables: ['invoiceManager_label'] },
          { route: '/api/save-barcode-to-db', tables: ['invoiceManager-label'] },
          { route: '/api/save-item-note', tables: ['item_note'] },
          { route: '/api/hr/workers', tables: ['invoiceManager_employees'] },
          { route: '/api/get-coupang-users', tables: ['users_api'] },
          { route: '/api/save-label-data', tables: [] },
          { route: '/api/save-cells-batch', tables: [] },
          { route: '/api/verify-saved-cells', tables: [] },
        ],
        external: ['Google Sheets'],
      },
      {
        name: '상품출고 (V1)',
        route: '/export-product',
        file: 'app/export-product/ExportProduct.tsx',
        apis: [
          { route: '/api/get-coupang-users', tables: ['users_api'] },
          { route: '/api/load-google-sheet-optimized', tables: ['invoice_import_googlesheet'] },
          { route: '/api/load-scan-data', tables: [] },
          { route: '/api/save-scan-data', tables: [] },
        ],
        external: ['Google Sheets'],
      },
      {
        name: '쉽먼트 (V1)',
        route: '/shipment',
        file: 'app/shipment/page.tsx',
        apis: [{ route: '/api/get-all-shipment-data', tables: ['1688_shipment'] }],
      },
      {
        name: '주문취소',
        route: '/invoice/order-refund',
        file: 'app/invoice/order-refund/OrderHistory.tsx',
        apis: [
          { route: '/api/get-coupang-users', tables: ['users_api'] },
          { route: '/api/get-invoice-balance', tables: ['invoiceManager_balance'] },
          { route: '/api/get-live-balance', tables: ['invoiceManager_transactions', 'invoiceManager_refundOrder'] },
          { route: '/api/get-refund-orders', tables: ['invoiceManager_refundOrder'] },
          { route: '/api/update-refund-status', tables: ['invoiceManager_refundOrder'] },
          { route: '/api/update-refund-amount', tables: ['invoiceManager_refundOrder'] },
          { route: '/api/delete-refund-orders', tables: ['invoiceManager_refundOrder'] },
          { route: '/api/sync-refund-orders-from-sheet', tables: ['invoiceManager_refundOrder'] },
          { route: '/api/search-1688-order', tables: ['invoiceManager_1688_orders', 'invoiceManager_refundOrder'] },
        ],
        external: ['Google Sheets'],
      },
    ],
  },

  // ── 기타 (좌측 메뉴 미노출) ───────────────────────────────
  {
    group: '기타 (메뉴 외)',
    desc: '상단 메뉴·직접 URL 로만 접근하는 화면',
    pages: [
      {
        name: '홈',
        route: '/',
        file: 'app/page.tsx',
        apis: [{ route: '/api/get-coupang-users', tables: ['users_api'] }],
      },
      {
        name: 'SHIPMENT 스캔',
        route: '/barcode-scan',
        file: 'app/barcode-scan/BarcodeScan.tsx',
        apis: [
          { route: '/api/get-coupang-users', tables: ['users_api'] },
          { route: '/api/load-scan-data', tables: [] },
          { route: '/api/save-scan-data', tables: [] },
        ],
        external: ['Google Sheets'],
      },
      {
        name: '바코드 라벨',
        route: '/barcode-labels',
        file: 'app/barcode-labels/page.tsx',
        apis: [{ route: '/api/get-selected-products', tables: ['invoice_import_googlesheet'] }],
      },
      {
        name: '영수증 저장',
        route: '/invoice',
        file: 'app/invoice/InvoiceSave.tsx',
        apis: [
          { route: '/api/get-coupang-users', tables: ['users_api'] },
          { route: '/api/get-all-delivery-info-check', tables: ['1688_invoice_deliveryInfo_check'] },
          { route: '/api/get-invoice-balance', tables: ['invoiceManager_balance'] },
          { route: '/api/upload-chinaorder-excel', tables: ['chinaorder_original'] },
        ],
      },
      {
        name: '주문 이력',
        route: '/invoice/order-history',
        file: 'app/invoice/order-history/OrderHistory.tsx',
        apis: [
          { route: '/api/get-coupang-users', tables: ['users_api'] },
          { route: '/api/get-invoice-balance', tables: ['invoiceManager_balance'] },
          { route: '/api/upload-chinaorder-excel', tables: ['chinaorder_original'] },
        ],
      },
    ],
  },
];

// ============================================================
// 파생 데이터 helper
// ============================================================

/** 페이지 1건이 사용하는 테이블 목록 (중복 제거, 정렬) */
export function tablesOfPage(page: PageEntry): string[] {
  const set = new Set<string>();
  page.apis.forEach((api) => api.tables.forEach((t) => set.add(t)));
  return Array.from(set).sort();
}

/** 테이블 → 사용 페이지 역인덱스 */
export interface TableUsage {
  table: string;
  pages: { name: string; route: string; group: string }[];
}

export function buildTableIndex(): TableUsage[] {
  const map = new Map<string, TableUsage>();

  PAGE_TABLE_MAP.forEach((group) => {
    group.pages.forEach((page) => {
      tablesOfPage(page).forEach((table) => {
        if (!map.has(table)) map.set(table, { table, pages: [] });
        map.get(table)!.pages.push({ name: page.name, route: page.route, group: group.group });
      });
    });
  });

  return Array.from(map.values()).sort((a, b) => a.table.localeCompare(b.table));
}
