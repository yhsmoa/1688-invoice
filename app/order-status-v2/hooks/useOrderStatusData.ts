import { useState, useEffect, useCallback, useMemo } from 'react';
import type { DeliveryStatusInfo } from '../utils/deliveryStatusMap';

// ============================================================
// /order-status-v2 전용 데이터 훅
//
// import-product-v2 훅과 별도로 유지 (독립 운영):
//   - 두 페이지의 기능 분화 시 서로 영향 없음
//   - API 경로는 공용 (동일 백엔드 스펙)
// ============================================================

// ── 타입 정의 (order-status-v2 전용) ─────────────────────
export interface FtUser {
  id: string;
  full_name: string;
  user_code: string;
  brand: string | null;
  vender_name: string | null;
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
  created_at?: string | null;
  note_notice?: string | null;
}

export type FulfillmentRow = {
  id: string;
  order_item_id: string;
  quantity: number;
  type: string;
  created_at: string;
  operator_name: string | null;
  product_id?: string | null;
  shipment_id?: string | null;
};

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
      }
    } catch (err) {
      console.error('ft_users fetch 오류:', err);
    } finally {
      setLoading(false);
    }
  }, []);

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
// useFtFulfillmentSummary — ARRIVAL/PACKED/CANCEL/SHIPMENT 집계
//   · items 변경 시 자동 refetch
//   · rawFulfillments: FulfillmentLogModal 표시용 원본
// ============================================================
type FulfillmentMaps = {
  arrivalMap: Map<string, number>;
  packedMap: Map<string, number>;
  cancelMap: Map<string, number>;
  shipmentMap: Map<string, number>;
  /** PACKED + shipment_id NOT NULL → product_id 기준 출고 집계 */
  exportMap: Map<string, number>;
  rawFulfillments: FulfillmentRow[];
};

const EMPTY_MAPS: FulfillmentMaps = {
  arrivalMap: new Map(),
  packedMap: new Map(),
  cancelMap: new Map(),
  shipmentMap: new Map(),
  exportMap: new Map(),
  rawFulfillments: [],
};

export function useFtFulfillmentSummary(items: FtOrderItem[]) {
  const [maps, setMaps] = useState<FulfillmentMaps>(EMPTY_MAPS);
  const [loadingFulfillments, setLoadingFulfillments] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshFulfillments = useCallback(() => setRefreshKey((k) => k + 1), []);

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
        const res = await fetch('/api/ft/fulfillments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_item_ids: itemIdsKey.split(',').filter(Boolean) }),
        });
        const json = await res.json();

        if (cancelled) return;

        if (json.success) {
          const arrival  = new Map<string, number>();
          const packed   = new Map<string, number>();
          const cancel   = new Map<string, number>();
          const shipment = new Map<string, number>();
          const exportMap = new Map<string, number>();

          for (const row of json.data as FulfillmentRow[]) {
            const { order_item_id, quantity, type, product_id, shipment_id } = row;
            const qty = quantity ?? 0;

            if (type === 'ARRIVAL') {
              arrival.set(order_item_id, (arrival.get(order_item_id) ?? 0) + qty);
            } else if (type === 'PACKED') {
              packed.set(order_item_id, (packed.get(order_item_id) ?? 0) + qty);
              if (shipment_id != null && product_id) {
                exportMap.set(product_id, (exportMap.get(product_id) ?? 0) + qty);
              }
            } else if (type === 'CANCEL') {
              cancel.set(order_item_id, (cancel.get(order_item_id) ?? 0) + qty);
            } else if (type === 'SHIPMENT') {
              shipment.set(order_item_id, (shipment.get(order_item_id) ?? 0) + qty);
            }
          }

          setMaps({
            arrivalMap: arrival,
            packedMap: packed,
            cancelMap: cancel,
            shipmentMap: shipment,
            exportMap,
            rawFulfillments: json.data as FulfillmentRow[],
          });
        }
      } catch (err) {
        if (!cancelled) console.error('fulfillment fetch 오류:', err);
      } finally {
        if (!cancelled) setLoadingFulfillments(false);
      }
    };

    fetchSummary();
    return () => { cancelled = true; };
  }, [itemIdsKey, refreshKey]);

  return { ...maps, loadingFulfillments, refreshFulfillments };
}

// ============================================================
// use1688DeliveryStatus — im_1688_orders_delivery_status 조회
//
// items 의 unique 1688_order_id 추출 → POST /api/ft/1688-delivery-status
// Map<1688_order_id, DeliveryStatusInfo> 반환
//
// · items 변경 시 자동 refetch (idsKey 문자열 기반)
// · 최신 1건만 (API가 timestamp DESC 정렬 후 첫 건 유지)
// ============================================================
export function use1688DeliveryStatus(items: FtOrderItem[]) {
  const [statusMap, setStatusMap] = useState<Map<string, DeliveryStatusInfo>>(new Map());
  const [loading, setLoading] = useState(false);

  // unique 1688_order_id 추출
  const idsKey = useMemo(() => {
    const ids = Array.from(new Set(
      items
        .map((i) => i['1688_order_id'])
        .filter((v): v is string => !!v)
    ));
    return ids.join(',');
  }, [items]);

  useEffect(() => {
    if (!idsKey) {
      setStatusMap(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/ft/1688-delivery-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_ids: idsKey.split(',').filter(Boolean) }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (json.success) {
          const m = new Map<string, DeliveryStatusInfo>();
          for (const [k, v] of Object.entries(json.data as Record<string, DeliveryStatusInfo>)) {
            m.set(k, v);
          }
          setStatusMap(m);
        }
      } catch (err) {
        if (!cancelled) console.error('배송 상태 조회 오류:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [idsKey]);

  return { statusMap, loading };
}
