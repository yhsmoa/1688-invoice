'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

// ============================================================
// 공유 컴포넌트
// ============================================================
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';

// ============================================================
// V2 전용 CSS
// ============================================================
import './ItemCheck.css';

// ============================================================
// V2 전용 hooks (ft_users / ft_order_items)
// ============================================================
import {
  useFtUsers,
  useFtOrderItems,
  useFtSearch,
  useFtPagination,
  SEARCH_SHOW_ALL_MAX,
  useFtFulfillmentSummary,
  type FtOrderItem,
} from './hooks/useFtData';

// ============================================================
// V2 전용 컴포넌트
// ============================================================
import ItemTable from './components/ItemTable';
import SearchSection from './components/SearchSection';
import V2ReadyModal, { type V2ReadyItem } from './components/V2ReadyModal';
import V2LabelModal from './components/V2LabelModal';
import V2CancelModal from './components/V2CancelModal';
import V2NoteModal from './components/V2NoteModal';
import V2CustomerConfirmModal from './components/V2CustomerConfirmModal';
import FulfillmentLogModal from './components/FulfillmentLogModal';
import RightActionSidebar from './components/RightActionSidebar';
import { saveLabelData } from './utils/saveLabelData';
import { printLabels, type AudienceTemplates, type PrintLabelResult } from './utils/printLabels';
import ImportUploadButtons, { V2MigrationButton } from './components/ImportUploadButtons';
import { useWorkers, PC_NO_OPTIONS } from './hooks/useWorkers';
import { useImportUploads } from './hooks/useImportUploads';
import { usePersonalInvoicePrint } from './hooks/usePersonalInvoicePrint';
import type { LabelType } from '../../lib/labelTypes';

const ItemCheck: React.FC = () => {
  const { t } = useTranslation();

  // ============================================================
  // 1) ft_users 드롭박스
  // ============================================================
  const { users, loading: usersLoading } = useFtUsers();
  const [selectedUserId, setSelectedUserId] = useState('');

  // ============================================================
  // 2) ft_order_items 데이터 (선택된 user_id + status 필터)
  // ============================================================
  const { items, loading: itemsLoading, fetchItems } = useFtOrderItems();
  const [statusFilter, setStatusFilter] = useState<'PROCESSING' | 'ALL'>('PROCESSING');

  // ── 비고 모달 state ──
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);

  // ── 고객확인 모달 state ──
  const [isCustomerConfirmModalOpen, setIsCustomerConfirmModalOpen] = useState(false);

  // ── FulfillmentLogModal delivery_codes state ──
  const [logDeliveryCodes, setLogDeliveryCodes] = useState<string[]>([]);
  const [logDeliveryCodesLoading, setLogDeliveryCodesLoading] = useState(false);

  // ============================================================
  // 2-1) 검색 타입 — 기본값: 배송번호 (hook 순서 때문에 여기 선언)
  // ============================================================
  const [searchType, setSearchType] = useState('배송번호');

  // ============================================================
  // 2-2) 배송번호 서버 조회 결과
  //      null = 아직 검색 안 함 → 기본 items 표시
  //      FtOrderItem[] = 검색 완료 → 해당 결과 표시
  // ============================================================
  const [deliveryItems, setDeliveryItems] = useState<FtOrderItem[] | null>(null);
  const [isDeliverySearching, setIsDeliverySearching] = useState(false);

  // ============================================================
  // 2-3) [상품별로 보기] — 정렬 전환 (전역 적용)
  //      체크 시: 1688_offer_id ASC → item_no ASC (동일 1688 offer 그룹핑)
  //      해제 시: 원본 순서 (서버 기본 정렬)
  //      페이지 접속 시 기본 false. 사용자 수동 체크로만 동작.
  // ============================================================
  const [groupByProduct, setGroupByProduct] = useState(false);

  // baseActiveItems: 배송번호 모드+검색완료 → deliveryItems / 그 외 → items
  const baseActiveItems =
    searchType === '배송번호' && deliveryItems !== null ? deliveryItems : items;

  // groupByProduct 체크 시 클라이언트 정렬 (1688_offer_id → item_no)
  //   로컬 정렬 → 서버 재조회 불필요 → 토글 반응 즉시
  const activeItems = useMemo(() => {
    if (!groupByProduct) return baseActiveItems;
    const cmp = (a: string | null | undefined, b: string | null | undefined): number => {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return String(a).localeCompare(String(b), undefined, { numeric: true });
    };
    return [...baseActiveItems].sort((x, y) => {
      const p = cmp(x['1688_offer_id'], y['1688_offer_id']);
      if (p !== 0) return p;
      return cmp(x.item_no, y.item_no);
    });
  }, [baseActiveItems, groupByProduct]);

  // ============================================================
  // 3) 검색
  //    - 일반검색: useFtSearch가 activeItems를 client-side 필터
  //    - 배송번호: 서버 조회 결과(deliveryItems)를 그대로 표시
  // ============================================================
  // searchType을 전달 → 주문번호 모드 시 1688_order_id 필터 적용
  const { searchTerm, setSearchTerm, filteredItems, clearSearch } = useFtSearch(activeItems, searchType);

  // ============================================================
  // 4) 페이지네이션
  //    처음 화면은 페이지(20건) 표시. 검색했을 때는 결과 전체를 한 화면에 —
  //    단 SEARCH_SHOW_ALL_MAX 를 넘으면 렌더·이미지 부담 때문에 페이지 표시 유지.
  // ============================================================
  const isSearchActive =
    searchType === '배송번호' ? deliveryItems !== null : searchTerm.trim() !== '';
  const showAllResults = isSearchActive && filteredItems.length <= SEARCH_SHOW_ALL_MAX;

  const {
    currentPage,
    setCurrentPage,
    paginatedData,
    totalPages,
    goToFirstPage,
    goToLastPage,
  } = useFtPagination(filteredItems, undefined, showAllResults);

  // ============================================================
  // 4-1) ft_fulfillments ARRIVAL/PACKED/CANCEL/SHIPMENT 합계
  //      activeItems 변경 시 자동 fetch (1회 요청, 타입별 집계)
  // ============================================================
  const { arrivalMap, packedMap, cancelMap, returnMap, shipmentMap, exportMap, shippedItemMap, rawFulfillments, refreshFulfillments } = useFtFulfillmentSummary(activeItems, selectedUserId);

  // ============================================================
  // 5) Worker / PC-NO 드롭박스
  // ============================================================
  const workers = useWorkers();
  const [selectedWorker, setSelectedWorker] = useState('');
  const [selectedPcNo, setSelectedPcNo] = useState<number | null>(null);

  // ============================================================
  // 5-2) 업로드·다운로드 액션 — [V2 이전] / 1688 XLSX / 배송상황 csv / XLSX 다운 / 주문 ID
  //      핸들러·상태는 hooks/useImportUploads.ts (상품입고 V3 공용)
  // ============================================================
  const uploads = useImportUploads({ selectedUserId, selectedWorker, workers, fetchItems });

  // 5-1) searchType은 2-1 섹션에서 선언됨 (hook 순서)

  // ============================================================
  // 6) 체크박스 선택 관리
  // ============================================================
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  const isAllSelected =
    paginatedData.length > 0 && paginatedData.every((item) => selectedRows.has(item.id));
  const isIndeterminate =
    paginatedData.some((item) => selectedRows.has(item.id)) && !isAllSelected;

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectedRows((prev) => {
        const next = new Set(prev);
        paginatedData.forEach((item) => {
          if (checked) next.add(item.id);
          else next.delete(item.id);
        });
        return next;
      });
    },
    [paginatedData]
  );

  const handleSelectRow = useCallback((id: string, checked: boolean) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // ============================================================
  // 7) 이미지 미리보기용 마우스 위치
  // ============================================================
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setMousePosition({ x: e.clientX, y: e.clientY });
  }, []);

  // ============================================================
  // 8) ft_users 드롭박스 변경 → 자동 데이터 조회 + 배송번호 결과 초기화
  // ============================================================
  const handleUserChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const userId = e.target.value;
      setSelectedUserId(userId);
      setSelectedRows(new Set());
      setModifiedImportQty(new Map());
      setDeliveryItems(null);
      setSearchInput('');
      clearSearch();

      if (userId) {
        fetchItems(userId, statusFilter);
      }
    },
    [fetchItems, clearSearch, statusFilter]
  );

  // ============================================================
  // 8-1) 상태 필터 변경 → 데이터 재조회
  // ============================================================
  const handleStatusFilterChange = useCallback(
    (newStatus: 'PROCESSING' | 'ALL') => {
      setStatusFilter(newStatus);
      setSelectedRows(new Set());
      setModifiedImportQty(new Map());
      setDeliveryItems(null);
      setSearchInput('');
      clearSearch();

      if (selectedUserId) {
        fetchItems(selectedUserId, newStatus);
      }
    },
    [fetchItems, clearSearch, selectedUserId]
  );

  // ============================================================
  // 9) 검색 핸들러
  //
  // 입력값(searchInput)과 적용값(setSearchTerm)을 분리하여
  // Enter / [검색] 버튼 클릭 시에만 필터/조회 실행
  // ============================================================

  // 9-0) 입력 필드 live 값 (표시용) — setSearchTerm은 적용 시에만 호출
  const [searchInput, setSearchInput] = useState('');

  // 9-1) 배송번호 서버 조회 (delivery_code → order_id → ft_order_items)
  //      정렬은 클라이언트 측 groupByProduct 에서 처리 → API 호출은 단순
  const handleDeliverySearch = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;

      setIsDeliverySearching(true);
      try {
        const res = await fetch(
          `/api/ft/order-items/by-delivery-code?delivery_code=${encodeURIComponent(trimmed)}`
        );
        const json = await res.json();

        if (json.success) {
          setDeliveryItems(json.data);
          if (json.data.length === 0) {
            alert(t('importProductV2.alerts.deliveryNoResult'));
          }
        } else {
          alert(json.error || '배송번호 조회 중 오류가 발생했습니다.');
        }
      } catch {
        alert('배송번호 조회 중 오류가 발생했습니다.');
      } finally {
        setIsDeliverySearching(false);
      }
    },
    [t]
  );

  // 9-2) 검색 타입 변경 → 입력값·결과 초기화
  const handleSearchTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSearchType(e.target.value);
      setDeliveryItems(null);
      setSearchInput('');
      clearSearch(); // useFtSearch 내부 searchTerm 초기화
    },
    [clearSearch]
  );

  // 9-3) 입력값 변경 → searchInput만 업데이트 (필터 미적용)
  const handleSearchInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchInput(e.target.value);
    },
    []
  );

  // 9-4) 검색 실행 공통 함수
  //      빈 값 입력 시 모든 검색 결과 초기화 → 전체 데이터 복원
  //      (페이지 새로고침 없이 전체 조회로 돌아갈 수 있도록)
  const applySearch = useCallback(
    (value: string) => {
      const trimmed = value.trim();

      // ── 빈 값: 서버 조회 결과 + 클라이언트 필터 모두 리셋 ──
      if (!trimmed) {
        setDeliveryItems(null);
        clearSearch();
        return;
      }

      if (searchType === '배송번호') {
        handleDeliverySearch(trimmed);
      } else {
        // 일반검색 / 주문번호: 클라이언트 필터 (useFtSearch가 searchType에 맞게 처리)
        setSearchTerm(trimmed);
      }
    },
    [searchType, handleDeliverySearch, setSearchTerm, clearSearch]
  );

  // 9-5) Enter 키 → 검색 실행
  const handleSearchKeyPress = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applySearch(searchInput);
      }
    },
    [searchInput, applySearch]
  );

  // 9-6) [검색] 버튼 클릭 → 검색 실행
  const handleSearchClick = useCallback(() => {
    applySearch(searchInput);
  }, [searchInput, applySearch]);

  // ============================================================
  // 10) 입고(import_qty) 셀 편집 — V1 useEditCell 방식 동일
  // ============================================================
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [cellValue, setCellValue] = useState('');
  const [modifiedImportQty, setModifiedImportQty] = useState<Map<string, number>>(new Map());

  // 셀 클릭 → 편집 시작
  const startEditingCell = useCallback(
    (id: string, field: string, value: number | string | null | undefined) => {
      setEditingCell({ id, field });
      setCellValue(value != null && value !== 0 ? String(value) : '');
    },
    []
  );

  // 입력값 변경 (숫자만 허용)
  const handleCellValueChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const cleaned = e.target.value.replace(/[^0-9]/g, '');
      setCellValue(cleaned);
    },
    []
  );

  // 편집 완료 (blur / Enter) — 진행(order_qty - 입고 - 취소)보다 큰 값 입력 불가
  const finishEditingCell = useCallback(() => {
    if (!editingCell) return;

    const { id } = editingCell;
    const numValue = cellValue.trim() === '' ? 0 : parseInt(cellValue, 10);

    // 입고 입력 한도 = order_qty - ARRIVAL - CANCEL  (raw, RETURN 무관)
    //   - ARRIVAL: 이미 입고된 수량
    //   - CANCEL: 입고 안 들어올 (취소된) 수량
    //   - RETURN: 입고된 후 돌려보낸 수량 — 입고 한도엔 영향 없음
    //     (RETURN 이 발생해도 supplier 가 보낸 ARRIVAL 자체는 변동 없음)
    const item = activeItems.find((i) => i.id === id);
    const inputLimit = (item?.order_qty ?? 0) - (arrivalMap.get(id) ?? 0) - (cancelMap.get(id) ?? 0);

    if (numValue > inputLimit) {
      alert(`작업 수량(${numValue})이 입고 가능 수량(${inputLimit})을 초과할 수 없습니다.`);
      setEditingCell(null);
      setCellValue('');
      return;
    }

    setModifiedImportQty((prev) => {
      const next = new Map(prev);
      if (numValue > 0) {
        next.set(id, numValue);
      } else {
        next.delete(id);
      }
      return next;
    });

    setEditingCell(null);
    setCellValue('');
  }, [editingCell, cellValue, activeItems, arrivalMap, cancelMap]);

  // 키보드 핸들러 (Enter → 완료 + 다음 행 이동, Escape → 취소)
  const handleCellKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();

        // 현재 편집 중인 셀 정보 보관
        const currentId = editingCell?.id;
        const currentField = editingCell?.field;

        // 현재 셀 편집 완료
        finishEditingCell();

        // 다음 행의 같은 필드로 이동
        if (currentId && currentField) {
          const idx = paginatedData.findIndex((item) => item.id === currentId);
          if (idx >= 0 && idx < paginatedData.length - 1) {
            const nextItem = paginatedData[idx + 1];
            const nextValue = modifiedImportQty.get(nextItem.id) ?? 0;
            // setTimeout: finishEditingCell의 state 업데이트 이후 실행
            setTimeout(() => {
              startEditingCell(nextItem.id, currentField, nextValue);
            }, 0);
          }
        }
      } else if (e.key === 'Escape') {
        setEditingCell(null);
        setCellValue('');
      }
    },
    [finishEditingCell, editingCell, paginatedData, modifiedImportQty, startEditingCell]
  );

  // ============================================================
  // 11) readyItems — 수정된 입고 데이터 목록
  // ============================================================
  const readyItems: V2ReadyItem[] = useMemo(() => {
    return Array.from(modifiedImportQty.entries())
      .map(([id, qty]) => {
        const item = items.find((i) => i.id === id);
        if (!item) return null;
        return { item, import_qty: qty };
      })
      .filter((v): v is V2ReadyItem => v !== null);
  }, [modifiedImportQty, items]);

  // ============================================================
  // 11-1) P 상품 송장 출력 — personal_order_no dedup + Storage check
  //
  // readyItems 중 shipment_type='PERSONAL' 이고 personal_order_no 있는 항목을
  // 중복 제거하여 unique 주문번호 리스트로 변환.
  // 모달 open 시 /api/ft/personal-invoices/check 호출하여 Storage PDF 존재 여부 조회.
  // ============================================================
  const uniquePersonalOrderNos = useMemo(() => {
    const nos = new Set<string>();
    for (const { item } of readyItems) {
      const type = item.shipment_type?.trim().toUpperCase() ?? '';
      if (type !== 'PERSONAL') continue;
      const no = item.personal_order_no?.trim();
      if (no) nos.add(no);
    }
    return Array.from(nos).sort();
  }, [readyItems]);

  // ── P 상품 운송장 — PDF 존재·출력 이력 조회 + 출력 ──
  //    로직은 hooks/usePersonalInvoicePrint.ts (상품입고 V3 공용).
  //    출력 가능 룰: PDF 존재 + (출력 이력 없음 OR 선택 item ⊆ 이전 출력 조합)
  const {
    invoicePdfSet,
    isCheckingInvoices,
    printedItemIdsMap,
    isItemInvoicePrintable,
    printInvoicesForItems,
  } = usePersonalInvoicePrint({ selectedUserId, selectedWorker, activeItems, t });

  // ============================================================
  // 12) 처리준비 모달
  // ============================================================
  const [isReadyModalOpen, setIsReadyModalOpen] = useState(false);

  // ============================================================
  // 12-1) 저장 완료 플래그 — 모달 유지 + 조건부 초기화 + 중복저장 방지
  //   규칙:
  //     - [postgre + 저장] 성공 → true (저장 버튼 "저장 완료" 로 비활성화)
  //     - modifiedImportQty 변경 → 자동 false (저장 후 재수정 시 버튼 재활성화)
  //     - 모달 닫을 때 true 인 상태였으면 부모 state 초기화
  // ============================================================
  const [hasReadySaveCompleted, setHasReadySaveCompleted] = useState(false);

  // modifiedImportQty 가 변경되면 저장 완료 플래그를 자동 해제.
  //   - Map 참조가 동일하면 effect 재실행 X → 저장 직후 setHasReadySaveCompleted(true) 가 안전
  //   - 사용자가 새 항목 추가/수정 시 readyItems 가 바뀌어 Map 참조 변경 → 자동 false 복귀
  useEffect(() => {
    setHasReadySaveCompleted(false);
  }, [modifiedImportQty]);

  // ── 모달 닫기 핸들러 — 저장 완료 상태였을 때만 부모 state 초기화 ──
  const handleReadyModalClose = useCallback(() => {
    setIsReadyModalOpen(false);
    if (hasReadySaveCompleted) {
      setModifiedImportQty(new Map());
      setSelectedRows(new Set());
      setHasReadySaveCompleted(false);   // 다음 모달 세션 준비
    }
  }, [hasReadySaveCompleted]);

  // ── 모달 [송장 출력] — readyItems(작업값 입력 항목) 의 P 상품 ──
  const handlePrintInvoices = useCallback(
    () => printInvoicesForItems(readyItems.map(({ item }) => item)),
    [readyItems, printInvoicesForItems]
  );

  // ── 사이드바 [운송장] — 체크박스 선택된 행의 P 상품 (라벨 버튼과 동일 패턴) ──
  const handlePrintInvoicesFromSelection = useCallback(() => {
    if (selectedRows.size === 0) {
      alert(t('importProductV2.alerts.selectItems'));
      return;
    }
    return printInvoicesForItems(items.filter((item) => selectedRows.has(item.id)));
  }, [selectedRows, items, t, printInvoicesForItems]);

  // 모달 [송장 출력] 버튼 활성화 조건 — readyItems 기준 (P + PDF 매칭 + 출력 가능 룰)
  const invoicePrintable = useMemo(() => {
    if (isCheckingInvoices) return false;
    return readyItems.some(({ item }) => isItemInvoicePrintable(item));
  }, [readyItems, isCheckingInvoices, isItemInvoicePrintable]);

  // 사이드바 [운송장] 버튼 활성화 조건 — 선택된 행 중 출력 가능 룰 통과 ≥ 1
  const selectedShippingPrintable = useMemo(() => {
    if (selectedRows.size === 0) return false;
    for (const item of items) {
      if (!selectedRows.has(item.id)) continue;
      if (isItemInvoicePrintable(item)) return true;
    }
    return false;
  }, [items, selectedRows, isItemInvoicePrintable]);

  // ============================================================
  // 13) 반품 모달 — 체크박스 선택 시 선택 항목, 미선택 시 전체 항목
  // ============================================================
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);

  const cancelItems = useMemo(
    () => selectedRows.size > 0
      ? items.filter((item) => selectedRows.has(item.id))
      : items,
    [items, selectedRows]
  );

  // ============================================================
  // 14) 라벨 모달 — 선택된 항목 중 barcode 있는 것만 표시
  // ============================================================
  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);

  // 라벨 모달에 표시할 항목: 체크된 행 중 barcode가 있는 것
  const labelItems = useMemo(() => {
    return items.filter(
      (item) => selectedRows.has(item.id) && item.barcode
    );
  }, [items, selectedRows]);

  // 선택된 ft_user 객체 (brand 조회용)
  const selectedUser = useMemo(() => {
    return users.find((u) => u.id === selectedUserId) || null;
  }, [users, selectedUserId]);

  // ── 고객확인 모달 대상 — 체크된 항목 (Notion 전송) ──
  const customerConfirmItems = useMemo(
    () => items.filter((item) => selectedRows.has(item.id)),
    [items, selectedRows]
  );

  // ── 비고 모달 초기값 — 선택 항목들의 note_cn 이 모두 같으면 그 값(수정), 다르면 '' ──
  const noteModalInitial = useMemo(() => {
    const notes = items
      .filter((item) => selectedRows.has(item.id))
      .map((item) => item.note_cn || '');
    const unique = Array.from(new Set(notes));
    return unique.length === 1 ? unique[0] : '';
  }, [items, selectedRows]);

  // [고객확인] 버튼 클릭 — 선택 항목이 있을 때만 모달 open
  const handleCustomerConfirmClick = useCallback(() => {
    if (selectedRows.size === 0) {
      alert(t('importProductV2.alerts.selectItems'));
      return;
    }
    setIsCustomerConfirmModalOpen(true);
  }, [selectedRows, t]);

  // PC-NO → operator_id (라벨 저장용)
  const operatorId = selectedPcNo;

  // [라벨] 버튼 클릭 핸들러
  const handleLabelClick = useCallback(() => {
    if (selectedRows.size === 0) {
      alert('항목을 선택해주세요.');
      return;
    }
    const withBarcode = items.filter(
      (item) => selectedRows.has(item.id) && item.barcode
    );
    if (withBarcode.length === 0) {
      alert('바코드가 있는 선택된 항목이 없습니다.');
      return;
    }
    setIsLabelModalOpen(true);
  }, [selectedRows, items]);

  // 라벨 저장 완료 콜백
  const handleLabelSaveComplete = useCallback(() => {
    setSelectedRows(new Set());
    refreshFulfillments();
  }, [refreshFulfillments]);

  // ============================================================
  // 14) [저장] 모달 → ft_fulfillments(ARRIVAL) + 라벨 저장
  //     라벨 저장은 saveLabelData 공통 유틸 사용 ([라벨] 버튼과 동일)
  //
  //     반환값(boolean)은 [모두] 버튼이 "저장 성공해야 다음 단계(출력)로
  //     진행" 을 판단하는 데 쓴다. 실패 시 알림은 이 함수 안에서 띄우므로
  //     호출부는 false 를 받으면 조용히 멈추면 된다.
  // ============================================================
  const handleReadySave = useCallback(async (): Promise<boolean> => {
    if (!selectedWorker) {
      alert('Worker를 선택해주세요.');
      return false;
    }
    if (!selectedPcNo) {
      alert('PC-NO를 선택해주세요.');
      return false;
    }
    if (!selectedUserId) {
      alert('사용자를 선택해주세요.');
      return false;
    }

    const currentUser = users.find((u) => u.id === selectedUserId) || null;

    try {
      // ── 1) ft_fulfillments 저장 ──
      const fulfillmentItems = readyItems.map(({ item, import_qty }) => ({
        order_item_id: item.id,
        type: 'ARRIVAL',
        quantity: import_qty,
        operator_name: selectedWorker,
        order_no: item.order_no || null,
        item_no: item.item_no || null,
        product_no: item.product_no || null,
        product_id: item.product_id || null,
        user_id: selectedUserId,
      }));

      // ── 2) 라벨 저장 데이터 (barcode 있는 항목만) ──
      const barcodeReadyItems = readyItems
        .filter(({ item }) => item.barcode)
        .map(({ item, import_qty }) => ({ item, qty: import_qty }));

      // ── 3) 동시 호출 ──
      const promises: Promise<any>[] = [
        fetch('/api/ft/fulfillments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: fulfillmentItems }),
        }).then(async (res) => {
          const json = await res.json();
          if (!res.ok || !json.success) throw new Error(json.error || '입고 저장 실패');
          return json;
        }),
      ];

      if (barcodeReadyItems.length > 0 && selectedPcNo) {
        promises.push(
          saveLabelData({
            items: barcodeReadyItems,
            brand: currentUser?.brand || null,
            operatorNo: selectedPcNo,
          }).then((result) => {
            if (!result.success) console.error('라벨 저장 실패:', result.error);
            return result;
          })
        );
      }

      await Promise.all(promises);

      // ── 저장 성공 → 모달 유지 + 저장 완료 플래그 ON ──
      //   초기화는 handleReadyModalClose 에서 조건부로 수행.
      //   (모달 유지 → 사용자가 이어서 [송장 출력] 클릭 가능)
      setHasReadySaveCompleted(true);
      refreshFulfillments();
      return true;

    } catch (error) {
      console.error('저장 오류:', error);
      alert(error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.');
      return false;
    }
  }, [readyItems, selectedWorker, selectedPcNo, selectedUserId, users, refreshFulfillments]);

  // ============================================================
  // 14-1) [모두] 버튼용 즉시 출력 — 처리준비 목록(readyItems) 을
  //       QZ Tray 로 그 자리에서 인쇄한다. [라벨] 모달의 handlePrint 와
  //       같은 printLabels() 유틸을 쓰되, 데이터 출처만 readyItems 로 다르다.
  //       세트상품 병합은 printLabels() 내부에서 처리하므로 여기선 안 한다.
  //       templates 는 모달의 드롭다운에서 확정된 대상(성인/키즈)별 템플릿.
  // ============================================================
  const handleReadyPrint = useCallback(
    async (labelType: LabelType, templates: AudienceTemplates): Promise<PrintLabelResult> => {
      if (!selectedPcNo) {
        return { success: false, printed: 0, error: 'PC-NO를 선택해주세요.' };
      }
      const printItems = readyItems
        .filter(({ item }) => item.barcode)
        .map(({ item, import_qty }) => ({ item, qty: import_qty }));
      if (printItems.length === 0) {
        return { success: false, printed: 0, error: '바코드가 있는 항목이 없습니다.' };
      }

      const currentUser = users.find((u) => u.id === selectedUserId) || null;
      return printLabels({
        items: printItems,
        selectedUser: currentUser,
        brand: currentUser?.brand || null,
        stationNo: selectedPcNo,
        labelType,
        templates,
        printedBy: null,
      });
    },
    [readyItems, selectedPcNo, selectedUserId, users]
  );

  // ============================================================
  // 18) 품목 분류 (Gemini AI)
  // ============================================================
  const [isClassifying, setIsClassifying] = useState(false);

  const handleClassifyProducts = useCallback(async () => {
    if (activeItems.length === 0) {
      alert('분류할 데이터가 없습니다.');
      return;
    }

    // customs_category가 비어있는 항목의 unique item_name 추출
    const uniqueNames = [
      ...new Set(
        activeItems
          .filter((item) => !item.customs_category && item.item_name)
          .map((item) => item.item_name!)
      ),
    ];

    if (uniqueNames.length === 0) {
      alert('분류할 항목이 없습니다. (이미 모두 분류됨)');
      return;
    }

    setIsClassifying(true);
    try {
      const res = await fetch('/api/ft/classify-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_names: uniqueNames }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '분류 실패');

      alert(`${json.classified}개 품목 분류 완료`);

      // 데이터 새로고침
      if (selectedUserId) fetchItems(selectedUserId);
    } catch (error) {
      console.error('품목 분류 오류:', error);
      alert(error instanceof Error ? error.message : '품목 분류 중 오류가 발생했습니다.');
    } finally {
      setIsClassifying(false);
    }
  }, [activeItems, selectedUserId, fetchItems]);

  // ============================================================
  // 18-1) 품목(customs_category) 인라인 편집
  // ============================================================
  const [categoryEditing, setCategoryEditing] = useState<{ id: string } | null>(null);
  const [categoryValue, setCategoryValue] = useState('');

  const startCategoryEdit = useCallback((id: string, currentValue: string | null) => {
    setCategoryEditing({ id });
    setCategoryValue(currentValue || '');
  }, []);

  const finishCategoryEdit = useCallback(async () => {
    if (!categoryEditing) return;
    const { id } = categoryEditing;
    const trimmed = categoryValue.trim();

    setCategoryEditing(null);
    setCategoryValue('');

    // 서버에 저장
    try {
      const res = await fetch('/api/ft/order-items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, fields: { customs_category: trimmed || null } }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      // 로컬 상태 갱신 (새로고침 없이)
      if (selectedUserId) fetchItems(selectedUserId);
    } catch (error) {
      console.error('품목 저장 오류:', error);
    }
  }, [categoryEditing, categoryValue, selectedUserId, fetchItems]);

  const handleCategoryKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishCategoryEdit();
      } else if (e.key === 'Escape') {
        setCategoryEditing(null);
        setCategoryValue('');
      }
    },
    [finishCategoryEdit]
  );

  // ============================================================
  // 19) 상품명 클릭 → 처리 로그 슬라이드 모달
  // ============================================================
  const [logModalItem, setLogModalItem] = useState<FtOrderItem | null>(null);

  const handleProductNameClick = useCallback((item: FtOrderItem) => {
    setLogModalItem(item);
    // delivery_codes 조회
    setLogDeliveryCodes([]);
    const orderId = item['1688_order_id'];
    if (orderId) {
      setLogDeliveryCodesLoading(true);
      fetch(`/api/ft/delivery-codes?order_id=${encodeURIComponent(orderId)}`)
        .then((res) => res.json())
        .then((json) => {
          if (json.success) setLogDeliveryCodes(json.data);
        })
        .catch(() => {})
        .finally(() => setLogDeliveryCodesLoading(false));
    }
  }, []);

  const handleLogModalClose = useCallback(() => {
    setLogModalItem(null);
    setLogDeliveryCodes([]);
  }, []);

  // 로그 삭제 → supabase 삭제 + fulfillment 갱신
  const handleFulfillmentDelete = useCallback(async (fulfillmentId: string) => {
    const res = await fetch(`/api/ft/fulfillments?id=${fulfillmentId}`, { method: 'DELETE' });
    const result = await res.json();
    if (!result.success) {
      alert(result.error || '삭제 실패');
      return;
    }
    refreshFulfillments();
  }, [refreshFulfillments]);

  // ============================================================
  // 로딩 상태
  // ============================================================
  const loading = usersLoading || itemsLoading;

  // ============================================================
  // 렌더링
  // ============================================================
  return (
    <div className="v2-item-layout" onMouseMove={handleMouseMove}>
      <TopsideMenu />
      <div className="v2-item-main-content">
        <LeftsideMenu />
        <main className="v2-item-content">
          <div className="v2-item-container">
            {/* ============================================================ */}
            {/* 타이틀 행: 왼쪽(제목) / 오른쪽(드롭박스 2개) */}
            {/* ============================================================ */}
            <div className="v2-title-row">
              {/* ── 왼쪽: 제목 + [V2 이전] 버튼 ─────────── */}
              <div className="v2-title-left">
                <h1 className="v2-item-title">{t('importProductV2.title')}</h1>
                <V2MigrationButton
                  uploads={uploads}
                  selectedUserId={selectedUserId}
                  selectedWorker={selectedWorker}
                />
              </div>
              <div className="v2-title-dropdowns">
                {/* Worker 선택 (invoiceManager_employees) */}
                <select
                  className="v2-coupang-user-dropdown"
                  value={selectedWorker}
                  onChange={(e) => setSelectedWorker(e.target.value)}
                >
                  <option value="">{t('importProductV2.worker')}</option>
                  {workers.map((w) => (
                    <option key={w.id} value={`${w.name} ${w.name_kr}`}>
                      {w.name} {w.name_kr}
                    </option>
                  ))}
                </select>

                {/* PC-NO 선택 (라벨 프린터 번호) */}
                <select
                  className="v2-coupang-user-dropdown"
                  value={selectedPcNo ?? ''}
                  onChange={(e) => setSelectedPcNo(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">{t('importProductV2.pcNo')}</option>
                  {PC_NO_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>

                {/* ft_users 선택 → 자동 데이터 조회 */}
                <select
                  className="v2-coupang-user-dropdown"
                  value={selectedUserId}
                  onChange={handleUserChange}
                >
                  <option value="">{t('importProductV2.selectUser')}</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.vender_name || user.full_name} {user.user_code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* ============================================================ */}
            {/* 컨트롤 바: 왼쪽(버튼) / 오른쪽(액션 버튼) */}
            {/* ============================================================ */}
            {/* ============================================================ */}
            {/* 검색 영역 (상태 필터 + 검색유형/액션버튼 + 알약 검색 폼)      */}
            {/*   · 액션 버튼(1688 XLSX ~ 주문 ID)은 rightButtons 로 전달 →     */}
            {/*     배송번호(검색유형) 맞은편 오른쪽, 입력폼 위에 배치          */}
            {/* ============================================================ */}
            <SearchSection
              searchType={searchType}
              searchTerm={searchInput}
              onSearchTypeChange={handleSearchTypeChange}
              onSearchInputChange={handleSearchInputChange}
              onSearchKeyPress={handleSearchKeyPress}
              onSearchClick={handleSearchClick}
              isSearching={isDeliverySearching}
              statusFilter={statusFilter}
              onStatusFilterChange={(s) => handleStatusFilterChange(s as 'PROCESSING' | 'ALL')}
              filteredItemsCount={filteredItems.length}
              groupByProduct={groupByProduct}
              onGroupByProductChange={setGroupByProduct}
              rightButtons={<ImportUploadButtons uploads={uploads} selectedUserId={selectedUserId} />}
            />

            {/* ============================================================ */}
            {/* 데이터 테이블 */}
            {/* ============================================================ */}
            <ItemTable
              loading={loading}
              paginatedData={paginatedData}
              selectedRows={selectedRows}
              mousePosition={mousePosition}
              isAllSelected={isAllSelected}
              isIndeterminate={isIndeterminate}
              editingCell={editingCell}
              cellValue={cellValue}
              modifiedImportQty={modifiedImportQty}
              arrivalMap={arrivalMap}
              packedMap={packedMap}
              cancelMap={cancelMap}
              returnMap={returnMap}
              shipmentMap={shipmentMap}
              exportMap={exportMap}
              shippedItemMap={shippedItemMap}
              invoicePdfSet={invoicePdfSet}
              printedItemIdsMap={printedItemIdsMap}
              onSelectAll={handleSelectAll}
              onSelectRow={handleSelectRow}
              onStartEditingCell={startEditingCell}
              onCellValueChange={handleCellValueChange}
              onCellKeyDown={handleCellKeyDown}
              onFinishEditingCell={finishEditingCell}
              onProductNameClick={handleProductNameClick}
              categoryEditing={categoryEditing}
              categoryValue={categoryValue}
              onStartCategoryEdit={startCategoryEdit}
              onCategoryValueChange={(e) => setCategoryValue(e.target.value)}
              onCategoryKeyDown={handleCategoryKeyDown}
              onFinishCategoryEdit={finishCategoryEdit}
            />

            {/* ============================================================ */}
            {/* 페이지네이션 */}
            {/* ============================================================ */}
            {/* 검색 결과 전체 표시 중 — 페이지 버튼 대신 건수만 */}
            {!loading && showAllResults && filteredItems.length > 0 && (
              <div className="v2-pagination">
                <span className="v2-page-info">
                  {t('importProductV2.pagination.searchAll', { count: filteredItems.length })}
                </span>
              </div>
            )}

            {!loading && !showAllResults && filteredItems.length > 0 && (
              <div className="v2-pagination">
                {isSearchActive && (
                  <span className="v2-page-info">
                    {t('importProductV2.pagination.searchTooMany', { count: filteredItems.length, max: SEARCH_SHOW_ALL_MAX })}
                  </span>
                )}
                <button
                  onClick={goToFirstPage}
                  disabled={currentPage === 1}
                  className="v2-pagination-button"
                >
                  {t('importProductV2.pagination.first')}
                </button>

                <div className="v2-page-numbers">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`v2-page-number ${currentPage === pageNum ? 'active' : ''}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={goToLastPage}
                  disabled={currentPage === totalPages}
                  className="v2-pagination-button"
                >
                  {t('importProductV2.pagination.last')}
                </button>

                <span className="v2-page-info">
                  {t('importProductV2.pagination.pageInfo', { current: currentPage, total: totalPages, count: filteredItems.length })}
                </span>
              </div>
            )}

            {/* 데이터 없음 안내 */}
            {!loading && selectedUserId && items.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                {t('importProductV2.table.noData')}
              </div>
            )}

            {/* ============================================================ */}
            {/* 라벨 설정 진입점 — 사용자별 라벨 양식 / 프린터 매핑          */}
            {/* ============================================================ */}
            <div className="v2-label-settings-entry">
              <a href="/label-settings" className="v2-label-settings-link">
                🏷️ 라벨 설정
              </a>
              <span className="v2-label-settings-hint">
                라벨 양식(템플릿)과 PC-NO별 프린터를 지정하면 [라벨] 모달에서 바로 출력할 수 있습니다.
              </span>
            </div>
          </div>
        </main>

        {/* ============================================================ */}
        {/* 우측 액션 사이드바 — LeftsideMenu 와 대칭되는 flex item      */}
        {/* ============================================================ */}
        <RightActionSidebar
          disabled={!selectedUserId || items.length === 0}
          shippingEnabled={selectedShippingPrintable}
          importBadgeCount={readyItems.length}
          onNoteClick={() => {
            if (selectedRows.size === 0) {
              alert(t('importProductV2.alerts.selectItems'));
              return;
            }
            setIsNoteModalOpen(true);
          }}
          onCancelClick={() => setIsCancelModalOpen(true)}
          onMissingClick={() => { /* 미입고 기능은 별도 작업에서 구현 예정 */ }}
          onLabelClick={handleLabelClick}
          onImportClick={() => setIsReadyModalOpen(true)}
          onShippingClick={handlePrintInvoicesFromSelection}
          onCustomerConfirmClick={handleCustomerConfirmClick}
        />
      </div>

      {/* ============================================================ */}
      {/* 취소 접수 모달                                               */}
      {/* ============================================================ */}
      <V2CancelModal
        isOpen={isCancelModalOpen}
        onClose={() => setIsCancelModalOpen(false)}
        items={cancelItems}
        selectedUserId={selectedUserId}
        selectedOperator={selectedWorker}
        arrivalMap={arrivalMap}
        cancelMap={cancelMap}
        returnMap={returnMap}
        onSaveComplete={() => {
          setIsCancelModalOpen(false);
          setSelectedRows(new Set());
          refreshFulfillments();
          if (selectedUserId) fetchItems(selectedUserId, statusFilter);
        }}
      />

      {/* ============================================================ */}
      {/* 처리준비 모달 */}
      {/* ============================================================ */}
      <V2ReadyModal
        isOpen={isReadyModalOpen}
        onClose={handleReadyModalClose}
        readyItems={readyItems}
        onSavePostgre={handleReadySave}
        onPrintLabel={handleReadyPrint}
        selectedUserId={selectedUserId || null}
        onPrintInvoices={handlePrintInvoices}
        invoicePrintable={invoicePrintable}
        isSaved={hasReadySaveCompleted}
        invoicePdfSet={invoicePdfSet}
      />

      {/* ============================================================ */}
      {/* 라벨 모달 — LABEL postgre 저장 */}
      {/* ============================================================ */}
      <V2LabelModal
        isOpen={isLabelModalOpen}
        onClose={() => setIsLabelModalOpen(false)}
        items={labelItems}
        selectedUser={selectedUser}
        operatorId={operatorId}
        modifiedImportQty={modifiedImportQty}
        onSaveComplete={handleLabelSaveComplete}
      />

      {/* ============================================================ */}
      {/* 처리 로그 슬라이드 모달 — 상품명 클릭 시 */}
      {/* ============================================================ */}
      <FulfillmentLogModal
        isOpen={logModalItem !== null}
        item={logModalItem}
        rawFulfillments={rawFulfillments}
        onClose={handleLogModalClose}
        onDelete={handleFulfillmentDelete}
        deliveryCodes={logDeliveryCodes}
        deliveryCodesLoading={logDeliveryCodesLoading}
      />

      {/* ============================================================ */}
      {/* 비고 모달 — 체크박스 선택 후 비고 버튼 클릭 시 */}
      {/* ============================================================ */}
      <V2NoteModal
        isOpen={isNoteModalOpen}
        onClose={() => setIsNoteModalOpen(false)}
        selectedIds={[...selectedRows]}
        initialNote={noteModalInitial}
        onSaveComplete={() => {
          setIsNoteModalOpen(false);
          if (selectedUserId) fetchItems(selectedUserId, statusFilter);
        }}
      />

      {/* ============================================================ */}
      {/* 고객확인 모달 — 체크된 항목을 Notion 으로 전송 */}
      {/* ============================================================ */}
      <V2CustomerConfirmModal
        isOpen={isCustomerConfirmModalOpen}
        onClose={() => setIsCustomerConfirmModalOpen(false)}
        items={customerConfirmItems}
        sellerCode={selectedUser?.user_code || ''}
        arrivalMap={arrivalMap}
        onSaveComplete={() => {
          setIsCustomerConfirmModalOpen(false);
          setSelectedRows(new Set());
        }}
      />
    </div>
  );
};

export default ItemCheck;
