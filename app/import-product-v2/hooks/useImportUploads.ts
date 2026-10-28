'use client';

import { useCallback, useRef, useState } from 'react';
import type { Worker } from './useWorkers';

// ============================================================
// 상품입고 업로드·다운로드 액션 — V2 · V3 공용
//
//   [V2 이전]       엑셀 → ft_orders + ft_order_items (+ N열 입고) 마이그레이션
//   [1688 XLSX]     /api/upload-delivery-excel  (계정별 엑셀 여러 개 — 그 계정 행만 교체)
//   [배송상황 csv]   /api/upload-delivery-status-csv
//   [XLSX 다운]     /api/ft/order-items/export-xlsx
//   [주문 ID]       엑셀 → 1688_order_id 매칭 후 목록 새로고침
//
// ItemCheck.tsx(V2) 에 인라인으로 있던 핸들러를 동작 변경 없이 옮겼다.
// 버튼 렌더는 components/ImportUploadButtons.tsx.
// ============================================================

interface Params {
  selectedUserId: string;
  /** Worker 드롭박스 값 (`${name} ${name_kr}`) */
  selectedWorker: string;
  workers: Worker[];
  /** 주문 ID 매칭 성공 후 목록 새로고침 */
  fetchItems: (userId: string, status?: string) => Promise<void> | void;
  /** [1688 XLSX] 업로드 성공 후 호출 (선택) — 주문상태 V2 계정 배지 재조회 */
  onDeliveryExcelUploaded?: () => void;
}

export function useImportUploads({ selectedUserId, selectedWorker, workers, fetchItems, onDeliveryExcelUploaded }: Params) {
  // ============================================================
  // [V2 이전] 엑셀 업로드 (ft_orders + ft_order_items 마이그레이션)
  // ============================================================
  const v2MigrationFileInputRef = useRef<HTMLInputElement>(null);
  const [isV2Migrating, setIsV2Migrating] = useState(false);

  const handleV2MigrationClick = useCallback(() => {
    if (!selectedUserId) {
      alert('사용자를 선택해주세요.');
      return;
    }
    if (!selectedWorker) {
      alert('Worker를 선택해주세요. (N열 입고 데이터 저장에 필요)');
      return;
    }
    v2MigrationFileInputRef.current?.click();
  }, [selectedUserId, selectedWorker]);

  const handleV2MigrationFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // selectedWorker(display 문자열)에서 실제 worker 객체 역조회
    const worker = workers.find((w) => `${w.name} ${w.name_kr}` === selectedWorker);
    if (!worker) {
      alert('선택한 Worker 정보를 찾을 수 없습니다. 다시 선택해주세요.');
      e.target.value = '';
      return;
    }

    setIsV2Migrating(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('user_id', selectedUserId);
      fd.append('worker_id', worker.id);
      fd.append('worker_name', worker.name);

      const res = await fetch('/api/ft/v2-migration/upload-xlsx', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        // 사전 중복 케이스 — duplicates 배열 안내
        if (Array.isArray(json.duplicates) && json.duplicates.length > 0) {
          const preview = json.duplicates.slice(0, 10).join(', ');
          const extra = json.duplicates.length > 10 ? ` 외 ${json.duplicates.length - 10}건` : '';
          alert(`⚠️ 이미 존재하는 order_no가 있어 작업을 중단합니다.\n\n${preview}${extra}`);
        } else {
          alert(`❌ 업로드 실패: ${json.error || '알 수 없는 오류'}${json.details ? `\n${json.details}` : ''}`);
        }
        return;
      }

      alert(
        `✅ V2 이전 완료!\n` +
        `ft_orders: ${json.orderCount}건\n` +
        `ft_order_items: ${json.itemCount}건\n` +
        `ft_fulfillment_inbounds: ${json.inboundCount ?? 0}건`
      );
    } catch (err) {
      console.error('[V2 이전] 업로드 오류:', err);
      alert(`❌ 업로드 중 오류가 발생했습니다.\n${err instanceof Error ? err.message : ''}`);
    } finally {
      setIsV2Migrating(false);
      // 같은 파일 재업로드 가능하도록 값 초기화
      e.target.value = '';
    }
  }, [selectedUserId, selectedWorker, workers]);

  // ============================================================
  // 1688 xlsx 업로드
  // ============================================================
  const excelFileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingExcel, setIsUploadingExcel] = useState(false);

  const handleXlsxClick = useCallback(() => {
    excelFileInputRef.current?.click();
  }, []);

  //   1688 계정마다 받은 주문 엑셀 — 한 번에 여러 개 선택 가능.
  //   서버는 파일의 계정(C열 买家会员名) 행만 교체한다 → 다른 계정 데이터는 그대로.
  const handleXlsxFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;

      const notExcel = files.find((f) => !/\.(xlsx|xls)$/i.test(f.name));
      if (notExcel) {
        alert(`엑셀 파일(.xlsx 또는 .xls)만 업로드 가능합니다: ${notExcel.name}`);
        if (excelFileInputRef.current) excelFileInputRef.current.value = '';
        return;
      }

      setIsUploadingExcel(true);
      const formData = new FormData();
      files.forEach((f) => formData.append('file', f));

      try {
        const response = await fetch('/api/upload-delivery-excel', {
          method: 'POST',
          body: formData,
        });
        const result = await response.json();

        if (response.ok) {
          // 계정별 결과
          const lines = (result.accounts ?? []).map(
            (a: { account: string; orders: number; inserted: number; deleted: number }) =>
              `· ${a.account}: 주문 ${a.orders}건 · ${a.inserted}행 저장 (이전 ${a.deleted}행 교체)`
          );
          alert(`1688 엑셀 업로드 완료\n${lines.join('\n')}\n\n올린 계정의 데이터만 바뀌고, 다른 계정 데이터는 그대로입니다.`);
          onDeliveryExcelUploaded?.();
        } else {
          alert(result.error || '업로드 중 오류가 발생했습니다.');
        }
      } catch {
        alert('업로드 중 오류가 발생했습니다.');
      } finally {
        setIsUploadingExcel(false);
        if (excelFileInputRef.current) excelFileInputRef.current.value = '';
      }
    },
    [onDeliveryExcelUploaded]
  );

  // ============================================================
  // 📋 배송상황 CSV 업로드
  // ============================================================
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingCsv, setIsUploadingCsv] = useState(false);

  const handleCsvClick = useCallback(() => {
    csvFileInputRef.current?.click();
  }, []);

  const handleCsvFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.name.toLowerCase().endsWith('.csv')) {
        alert('CSV 파일(.csv)만 업로드 가능합니다.');
        return;
      }

      setIsUploadingCsv(true);
      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch('/api/upload-delivery-status-csv', {
          method: 'POST',
          body: formData,
        });
        const result = await response.json();

        if (response.ok) {
          alert(`배송상황 CSV 업로드 완료\n저장: ${result.savedCount || 0}개`);
        } else {
          alert(result.error || '업로드 중 오류가 발생했습니다.');
        }
      } catch {
        alert('업로드 중 오류가 발생했습니다.');
      } finally {
        setIsUploadingCsv(false);
        if (csvFileInputRef.current) csvFileInputRef.current.value = '';
      }
    },
    []
  );

  // ============================================================
  // 🔗 주문 ID — 엑셀 업로드 → 1688_order_id 매칭
  // ============================================================
  const orderIdFileInputRef = useRef<HTMLInputElement>(null);
  const [isMatchingOrderId, setIsMatchingOrderId] = useState(false);

  const handleOrderIdClick = useCallback(() => {
    orderIdFileInputRef.current?.click();
  }, []);

  const handleOrderIdFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        alert('엑셀 파일(.xlsx 또는 .xls)만 업로드 가능합니다.');
        return;
      }

      setIsMatchingOrderId(true);
      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch('/api/ft/order-items/match-order-id', {
          method: 'POST',
          body: formData,
        });
        const result = await response.json();

        if (response.ok && result.success) {
          alert(`${result.matched}개 항목 매칭 완료\n(전체 미매칭: ${result.total_null}개)`);
          // 데이터 새로고침
          if (selectedUserId) fetchItems(selectedUserId);
        } else {
          alert(result.error || '주문 ID 매칭 중 오류가 발생했습니다.');
        }
      } catch {
        alert('주문 ID 매칭 중 오류가 발생했습니다.');
      } finally {
        setIsMatchingOrderId(false);
        if (orderIdFileInputRef.current) orderIdFileInputRef.current.value = '';
      }
    },
    [selectedUserId, fetchItems]
  );

  // ============================================================
  // XLSX 다운로드
  // ============================================================
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false);

  const handleXlsxDownload = useCallback(async () => {
    if (!selectedUserId) {
      alert('사용자를 선택해주세요.');
      return;
    }

    setIsDownloadingExcel(true);
    try {
      const response = await fetch('/api/ft/order-items/export-xlsx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: selectedUserId }),
      });

      if (!response.ok) throw new Error('XLSX 다운로드 실패');

      const blob = await response.blob();
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ft_order_items_${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      alert('XLSX 다운로드 중 오류가 발생했습니다.');
    } finally {
      setIsDownloadingExcel(false);
    }
  }, [selectedUserId]);

  return {
    v2MigrationFileInputRef,
    isV2Migrating,
    handleV2MigrationClick,
    handleV2MigrationFileChange,
    excelFileInputRef,
    isUploadingExcel,
    handleXlsxClick,
    handleXlsxFileChange,
    csvFileInputRef,
    isUploadingCsv,
    handleCsvClick,
    handleCsvFileChange,
    orderIdFileInputRef,
    isMatchingOrderId,
    handleOrderIdClick,
    handleOrderIdFileChange,
    isDownloadingExcel,
    handleXlsxDownload,
  };
}

export type ImportUploads = ReturnType<typeof useImportUploads>;
