'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CheckTab,
  CustomerCheckCounts,
  CustomerCheckListRow,
  AnsweredDecision,
  AnsweredDecisionCounts,
} from '../../../lib/customerChecks';

// ============================================================
// 고객 검수 확인 — 목록 조회 훅 (GET /api/ft/customer-checks)
//
//   필터(탭·팀·검색어·페이지)가 바뀌면 다시 조회한다. 서버 페이지네이션(50건).
//   늦게 도착한 이전 요청 결과가 최신 결과를 덮어쓰지 않도록 요청 순번을 둔다.
// ============================================================

export interface CheckFilter {
  tab: CheckTab;
  /** 팀 필터 (null = 전체 팀) — 모든 탭 공통 */
  userId: string | null;
  /** 답변완료 탭에서 출고분 / 취소분만 (null = 둘 다) — 다른 탭에서는 서버가 무시 */
  decision: AnsweredDecision | null;
  q: string;
  page: number;
}

interface ListResponse {
  success: boolean;
  error?: string;
  rows: CustomerCheckListRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: CustomerCheckCounts;
  answeredByDecision: AnsweredDecisionCounts;
}

const EMPTY_COUNTS: CustomerCheckCounts = {
  open: { total: 0, byUser: {} },
  reinquiry: { total: 0, byUser: {} },
  answered: { total: 0, byUser: {} },
  done: { total: 0, byUser: {} },
};

export function useCustomerChecks(filter: CheckFilter) {
  const [rows, setRows] = useState<CustomerCheckListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [counts, setCounts] = useState<CustomerCheckCounts>(EMPTY_COUNTS);
  const [answeredByDecision, setAnsweredByDecision] = useState<AnsweredDecisionCounts>({ 출고: 0, 취소: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const fetchList = useCallback(async () => {
    const seq = ++seqRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ tab: filter.tab, page: String(filter.page) });
      if (filter.userId) params.set('user_id', filter.userId);
      if (filter.tab === 'answered' && filter.decision) params.set('decision', filter.decision);
      if (filter.q.trim()) params.set('q', filter.q.trim());

      const res = await fetch(`/api/ft/customer-checks?${params.toString()}`, { cache: 'no-store' });
      const json = (await res.json()) as ListResponse;
      if (seq !== seqRef.current) return;
      if (!res.ok || !json.success) throw new Error(json.error || '목록 조회 실패');

      setRows(json.rows);
      setTotal(json.total);
      setPageSize(json.pageSize);
      setCounts(json.counts);
      setAnsweredByDecision(json.answeredByDecision);
    } catch (e) {
      if (seq !== seqRef.current) return;
      console.error('customer-checks 목록 조회 오류:', e);
      setRows([]);
      setError(e instanceof Error ? e.message : '목록 조회 실패');
    } finally {
      if (seq === seqRef.current) setIsLoading(false);
    }
  }, [filter.tab, filter.userId, filter.decision, filter.q, filter.page]);

  useEffect(() => { fetchList(); }, [fetchList]);

  return { rows, total, pageSize, counts, answeredByDecision, isLoading, error, refetch: fetchList };
}
