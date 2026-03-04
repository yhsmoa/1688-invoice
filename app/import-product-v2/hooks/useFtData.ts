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

  const fetchItems = useCallback(async (userId: string) => {
    if (!userId) {
      setItems([]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/ft/order-items?user_id=${userId}&status=PROCESSING`);
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
// useFtSearch — 클라이언트 필터링 (item_name, barcode, order_no)
// ============================================================
export function useFtSearch(items: FtOrderItem[]) {
  const [searchTerm, setSearchTerm] = useState('');

  // 검색어 기반 필터링 (메모이제이션)
  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return items;

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
  }, [items, searchTerm]);

  const clearSearch = useCallback(() => {
    setSearchTerm('');
  }, []);

  return { searchTerm, setSearchTerm, filteredItems, clearSearch };
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
