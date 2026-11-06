'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SELLER_INQUIRY_KINDS,
  SELLER_INQUIRY_PAGE_SIZE,
  SELLER_INQUIRY_STATUSES,
  type SellerInquiryCounts,
  type SellerInquiryKind,
  type SellerInquiryListRow,
  type SellerInquiryStatus,
} from '../../../lib/sellerInquiries';

// ============================================================
// useSellerInquiryList — /seller-inquiry 목록 조회
//   GET /api/ft/seller-inquiries ?status= &kind= &q= &page=
//   필터가 바뀌면 다시 조회한다. refresh() 는 같은 필터로 다시 조회 (상태·메모 저장 후)
//   탭을 빠르게 바꿔 요청이 겹치면 마지막 요청의 응답만 반영한다 (requestSeq)
// ============================================================

export interface SellerInquiryListFilter {
  /** null = 전체 */
  status: SellerInquiryStatus | null;
  /** null = 전체 */
  kind: SellerInquiryKind | null;
  q: string;
  page: number;
}

interface ListResponse {
  success: boolean;
  rows: SellerInquiryListRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: SellerInquiryCounts;
  error?: string;
}

const zero = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

export const EMPTY_SELLER_INQUIRY_COUNTS: SellerInquiryCounts = {
  status: zero(SELLER_INQUIRY_STATUSES),
  kind: zero(SELLER_INQUIRY_KINDS),
};

export function useSellerInquiryList({ status, kind, q, page }: SellerInquiryListFilter) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SellerInquiryListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(SELLER_INQUIRY_PAGE_SIZE);
  const [counts, setCounts] = useState<SellerInquiryCounts>(EMPTY_SELLER_INQUIRY_COUNTS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set('status', status);
      if (kind) params.set('kind', kind);
      if (q) params.set('q', q);
      const res = await fetch(`/api/ft/seller-inquiries?${params.toString()}`, { cache: 'no-store' });
      const json = (await res.json()) as ListResponse;
      if (!res.ok || !json.success) throw new Error(json.error || t('sellerInquiry.loadError'));
      if (seq !== requestSeq.current) return;
      setRows(json.rows);
      setTotal(json.total);
      setPageSize(json.pageSize);
      setCounts(json.counts);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      console.error('seller-inquiry 목록 오류:', e);
      setRows([]);
      setError(e instanceof Error ? e.message : t('sellerInquiry.loadError'));
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  }, [status, kind, q, page, t]);

  useEffect(() => { refresh(); }, [refresh]);

  return { rows, total, pageSize, counts, isLoading, error, refresh };
}
