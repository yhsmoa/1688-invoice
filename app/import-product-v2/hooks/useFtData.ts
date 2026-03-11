import { useState, useEffect, useCallback, useMemo } from 'react';

// ============================================================
// 타입 정의
// ============================================================
export interface FtUser {
  id: string;
  full_name: string;
  user_code: string;
  brand: string | null;
}

export interface FtOrderItem {
  id: string;
  order_no: string | null;
  item_no: string | null;
  item_name: string | null;
  option_name: string | null;
  order_qty: number | null;
  barcode: string | null;
  china_option1: string | null;
  china_option2: string | null;
  price_cny: number | null;
  price_total_cny: number | null;
  img_url: string | null;
  coupang_shipment_size: string | null;
  status: string | null;
  composition: string | null;
  recommanded_age: string | null;
  set_total: number | null;
  set_seq: number | null;
  product_no: string | null;
  product_id: string | null;
  site_url: string | null;
  '1688_order_id': string | null;
  shipment_type: string | null;
  customs_category: string | null;
}

// ============================================================
// useFtUsers — ft_users 목록 조회
// ============================================================
export function useFtUsers() {
  const [users, setUsers] = useState<FtUser[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ft/users');
      const json = await res.json();
      if (json.success) {
        setUsers(json.data);
      } else {
        console.error('ft_users 조회 실패:', json.error);
      }
    } catch (err) {
      console.error('ft_users fetch 오류:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 컴포넌트 마운트 시 자동 fetch
  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  return { users, loading, refetch: fetchUsers };
}

// ============================================================
// useFtOrderItems — ft_order_items 조회 (user_id + status)
// ============================================================
export function useFtOrderItems() {
  const [items, setItems] = useState<FtOrderItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchItems = useCallback(async (userId: string, status: string = 'PROCESSING') => {
    if (!userId) {
      setItems([]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/ft/order-items?user_id=${userId}&status=${status}`);
      const json = await res.json();
      if (json.success) {
        setItems(json.data);
      } else {
        console.error('ft_order_items 조회 실패:', json.error);
      }
    } catch (err) {
      console.error('ft_order_items fetch 오류:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearItems = useCallback(() => {
    setItems([]);
  }, []);

  return { items, loading, fetchItems, clearItems };
}

// ============================================================
// useFtSearch — 클라이언트 필터링
//   - 일반검색: item_name, option_name, barcode, order_no, item_no
//   - 주문번호:  1688_order_id 단독 검색
// ============================================================
export function useFtSearch(items: FtOrderItem[], searchType: string = '일반검색') {
  const [searchTerm, setSearchTerm] = useState('');

  // 검색어 기반 필터링 (메모이제이션)
  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return items;

    // 주문번호 모드: 1688_order_id 로만 필터
    if (searchType === '주문번호') {
      return items.filter((item) =>
        (item['1688_order_id'] || '').toLowerCase().includes(term)
      );
    }

    // 일반검색 모드: 상품명, 옵션, 바코드, 주문번호, 글번호
    return items.filter((item) => {
      const name = (item.item_name || '').toLowerCase();
      const option = (item.option_name || '').toLowerCase();
      const barcode = (item.barcode || '').toLowerCase();
      const orderNo = (item.order_no || '').toLowerCase();
      const itemNo = (item.item_no || '').toLowerCase();

      return (
        name.includes(term) ||
        option.includes(term) ||
        barcode.includes(term) ||
        orderNo.includes(term) ||
        itemNo.includes(term)
      );
    });
  }, [items, searchTerm, searchType]);

  const clearSearch = useCallback(() => {
    setSearchTerm('');
  }, []);

  return { searchTerm, setSearchTerm, filteredItems, clearSearch };
}

// ============================================================
// useFtFulfillmentSummary — ARRIVAL / CANCEL / SHIPMENT 합산
//
// items가 변경될 때마다 ft_fulfillments를 일괄 조회 (1회 fetch)
// type별로 order_item_id → quantity 합계 Map을 각각 반환
//
// arrivalMap  : type=ARRIVAL  → 입고 열
// cancelMap   : type=CANCEL   → 취소 열
// shipmentMap : type=SHIPMENT → 출고 열
// ============================================================
export type FulfillmentRow = {
  id: string;
  order_item_id: string;
  quantity: number;
  type: string;
  created_at: string;
  operator_name: string | null;
};

type FulfillmentMaps = {
  arrivalMap: Map<string, number>;
  packedMap: Map<string, number>;
  cancelMap: Map<string, number>;
  shipmentMap: Map<string, number>;
  /** 원본 fulfillment 데이터 (로그 모달 표시용) */
  rawFulfillments: FulfillmentRow[];
};

const EMPTY_MAPS: FulfillmentMaps = {
  arrivalMap: new Map(),
  packedMap: new Map(),
  cancelMap: new Map(),
  shipmentMap: new Map(),
  rawFulfillments: [],
};

export function useFtFulfillmentSummary(items: FtOrderItem[]) {
  const [maps, setMaps] = useState<FulfillmentMaps>(EMPTY_MAPS);
  const [loadingFulfillments, setLoadingFulfillments] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // 외부에서 호출하여 강제 re-fetch
  const refreshFulfillments = useCallback(() => setRefreshKey((k) => k + 1), []);

  // items id 목록이 실제로 바뀔 때 또는 refreshKey 변경 시 fetch
  const itemIdsKey = items.map((i) => i.id).join(',');

  useEffect(() => {
    if (!itemIdsKey) {
      setMaps(EMPTY_MAPS);
      return;
    }

    let cancelled = false;

    const fetchSummary = async () => {
      setLoadingFulfillments(true);
      try {
        // POST body로 전송 — GET 쿼리 파라미터는 ID 수가 많으면 414 URI Too Long 발생
        const res = await fetch('/api/ft/fulfillments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_item_ids: itemIdsKey.split(',').filter(Boolean) }),
        });
        const json = await res.json();

        if (cancelled) return;

        if (json.success) {
          // ── 타입별 클라이언트 집계 ──────────────────────────
          const arrival  = new Map<string, number>();
          const packed   = new Map<string, number>();
          const cancel   = new Map<string, number>();
          const shipment = new Map<string, number>();

          for (const row of json.data as FulfillmentRow[]) {
            const { order_item_id, quantity, type } = row;
            const qty = quantity ?? 0;

            if (type === 'ARRIVAL') {
              arrival.set(order_item_id, (arrival.get(order_item_id) ?? 0) + qty);
            } else if (type === 'PACKED') {
              packed.set(order_item_id, (packed.get(order_item_id) ?? 0) + qty);
            } else if (type === 'CANCEL') {
              cancel.set(order_item_id, (cancel.get(order_item_id) ?? 0) + qty);
            } else if (type === 'SHIPMENT') {
              shipment.set(order_item_id, (shipment.get(order_item_id) ?? 0) + qty);
            }
          }

          setMaps({ arrivalMap: arrival, packedMap: packed, cancelMap: cancel, shipmentMap: shipment, rawFulfillments: json.data as FulfillmentRow[] });
        } else {
          console.error('fulfillment 조회 실패:', json.error, json.details);
        }
      } catch (err) {
        if (!cancelled) console.error('fulfillment fetch 오류:', err);
      } finally {
        if (!cancelled) setLoadingFulfillments(false);
      }
    };

    fetchSummary();

    // cleanup: race condition 방지
    return () => { cancelled = true; };
  }, [itemIdsKey, refreshKey]);

  return { ...maps, loadingFulfillments, refreshFulfillments };
}

// ============================================================
// useFtPagination — 간단한 페이지네이션
// ============================================================
export function useFtPagination(data: FtOrderItem[], itemsPerPage = 20) {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(data.length / itemsPerPage));

  // 데이터 변경 시 첫 페이지로 리셋
  useEffect(() => {
    setCurrentPage(1);
  }, [data.length]);

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return data.slice(start, start + itemsPerPage);
  }, [data, currentPage, itemsPerPage]);

  const goToNextPage = useCallback(() => {
    setCurrentPage((p) => Math.min(p + 1, totalPages));
  }, [totalPages]);

  const goToPrevPage = useCallback(() => {
    setCurrentPage((p) => Math.max(p - 1, 1));
  }, []);

  return {
    currentPage,
    setCurrentPage,
    paginatedData,
    totalPages,
    goToNextPage,
    goToPrevPage,
  };
}
