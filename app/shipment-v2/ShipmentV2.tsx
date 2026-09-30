'use client';

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import ExcelJS from 'exceljs';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import { useFtUsers } from '../import-product-v2/hooks/useFtData';
import MoveModal from './components/MoveModal';
import SummaryFilterBar from './components/SummaryFilterBar';
import type { BoxInfoItem, ShipmentV2Row } from './types';
import {
  getBadgeClass,
  getBoxType,
  getShipmentError,
} from './utils/shipmentCodes';
import { FILTER_ALL, matchesFilter, type RowFilter } from './utils/rowFilter';
import './ShipmentV2.css';

// ============================================================
// 메인 컴포넌트
// ============================================================
const ShipmentV2: React.FC = () => {
  const { t } = useTranslation();
  const { users: ftUsers } = useFtUsers();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [rows, setRows] = useState<ShipmentV2Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // ── 요약 보드 필터 (품목 / 쉽먼트에러) ──
  const [filter, setFilter] = useState<RowFilter>(FILTER_ALL);

  // ── 입고 인라인 편집 ──
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const editRef = useRef<HTMLTableCellElement>(null);

  // ── 이동 모달 ──
  const [showMoveModal, setShowMoveModal] = useState(false);

  // ── 품목 분류 ──
  const [isClassifying, setIsClassifying] = useState(false);

  // ── 품목 인라인 편집 ──
  const [editingCategory, setEditingCategory] = useState<string | null>(null); // idx as string
  const categoryRef = useRef<HTMLTableCellElement>(null);

  // ── 배치 저장: 변경된 품목 추적 (order_item_id → new value) ──
  const [dirtyCategories, setDirtyCategories] = useState<Map<string, string | null>>(new Map());

  // ── 출고 모달 ──
  const [showShipModal, setShowShipModal] = useState(false);
  const [shipInput, setShipInput] = useState('');
  const [isShipping, setIsShipping] = useState(false);



  // ── 합배송 모달 ──
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeBoxes, setMergeBoxes] = useState<BoxInfoItem[]>([]);
  const [mergeFrom, setMergeFrom] = useState(''); // ft_box_info.id (source)
  const [mergeTo, setMergeTo] = useState('');     // ft_box_info.id (target/master)

  // ============================================================
  // 데이터 로딩
  // ============================================================
  const fetchData = useCallback(async (userId: string) => {
    if (!userId) { setRows([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/ft/shipment-v2?user_id=${userId}`);
      const json = await res.json();
      setRows(json.success ? (json.data || []) : []);
    } catch (err) {
      console.error('shipment-v2 fetch error:', err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── 사용자 변경 ──
  const handleUserChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const userId = e.target.value;
    setSelectedUserId(userId);
    setCheckedIds(new Set());
    setFilter(FILTER_ALL);
    fetchData(userId);
  };

  // ============================================================
  // 쉽먼트 에러 + 필터링된 행 (원본 idx 유지 — 체크·편집은 원본 idx 기준)
  // ============================================================
  const rowErrors = useMemo(() => rows.map(getShipmentError), [rows]);

  const visibleIndices = useMemo(
    () => rows.reduce<number[]>((acc, row, idx) => {
      if (matchesFilter(row, rowErrors[idx], filter)) acc.push(idx);
      return acc;
    }, []),
    [rows, rowErrors, filter]
  );

  // ── 화면에서 사라진 행은 체크 해제 (숨은 행이 이동·출고되지 않도록) ──
  useEffect(() => {
    const visible = new Set(visibleIndices.map(String));
    setCheckedIds((prev) => {
      const next = new Set(Array.from(prev).filter((key) => visible.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIndices]);

  // ============================================================
  // 체크박스
  // ============================================================
  const toggleCheck = (key: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // ── 전체 선택: 현재 보이는 행 기준 ──
  const allVisibleChecked =
    visibleIndices.length > 0 && visibleIndices.every((i) => checkedIds.has(String(i)));

  const toggleAll = () => {
    setCheckedIds(allVisibleChecked ? new Set() : new Set(visibleIndices.map(String)));
  };

  // ── 주문번호 클릭 → 체크박스 토글 ──
  const handleProductNoClick = (idx: number) => toggleCheck(String(idx));

  // ── 박스번호 배지 클릭 → 해당 box_code 중 보이는 행 전체 토글 ──
  const handlePackageClick = (packageNo: string) => {
    const indices = visibleIndices
      .filter((i) => rows[i].box_code === packageNo)
      .map(String);
    const allChecked = indices.every((i) => checkedIds.has(i));
    setCheckedIds((prev) => {
      const next = new Set(prev);
      for (const i of indices) allChecked ? next.delete(i) : next.add(i);
      return next;
    });
  };

  // ============================================================
  // 개수 셀 인라인 편집
  // ============================================================
  const handleQuantityClick = (idx: number) => {
    setEditingCell(String(idx));
    setTimeout(() => {
      if (editRef.current) {
        editRef.current.focus();
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(editRef.current);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }, 0);
  };

  const handleQuantityBlur = (idx: number) => {
    if (editRef.current) {
      const newVal = parseInt(editRef.current.textContent || '0', 10);
      if (!isNaN(newVal) && newVal !== rows[idx].quantity) {
        setRows((prev) => {
          const next = [...prev];
          next[idx] = { ...next[idx], quantity: newVal };
          return next;
        });
      }
    }
    setEditingCell(null);
  };

  const handleQuantityKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Enter') { e.preventDefault(); handleQuantityBlur(idx); }
    else if (e.key === 'Escape') setEditingCell(null);
  };

  // ============================================================
  // 품목 셀 인라인 편집
  // ============================================================
  const handleCategoryClick = (idx: number) => {
    setEditingCategory(String(idx));
    setTimeout(() => {
      if (categoryRef.current) {
        categoryRef.current.focus();
        // 전체 텍스트 선택
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(categoryRef.current);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }, 0);
  };

  const handleCategoryBlur = (idx: number) => {
    if (categoryRef.current) {
      const newVal = (categoryRef.current.textContent || '').trim();
      const row = rows[idx];
      if (newVal !== (row.customs_category || '')) {
        // 로컬 상태 업데이트
        setRows((prev) => {
          const next = [...prev];
          next[idx] = { ...next[idx], customs_category: newVal || null };
          return next;
        });
        // 변경 추적 (배치 저장용)
        setDirtyCategories((prev) => {
          const next = new Map(prev);
          next.set(row.order_item_id, newVal || null);
          return next;
        });
      }
    }
    setEditingCategory(null);
  };

  const handleCategoryKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Enter') { e.preventDefault(); handleCategoryBlur(idx); }
    else if (e.key === 'Escape') setEditingCategory(null);
  };

  // ============================================================
  // 품목 일괄 저장 ([저장] 버튼)
  // ============================================================
  const handleSaveAll = useCallback(async () => {
    if (dirtyCategories.size === 0) {
      alert('변경된 품목이 없습니다.');
      return;
    }

    const updates = Array.from(dirtyCategories.entries()).map(([id, val]) => ({
      id,
      fields: { customs_category: val },
    }));

    try {
      const res = await fetch('/api/ft/order-items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const json = await res.json();
      if (json.success) {
        alert(`${updates.length}개 품목 저장 완료`);
        setDirtyCategories(new Map());
      } else {
        alert('저장 실패: ' + (json.error || '알 수 없는 오류'));
      }
    } catch (err) {
      console.error('품목 일괄 저장 오류:', err);
      alert('저장 중 오류가 발생했습니다.');
    }
  }, [dirtyCategories]);

  // ============================================================
  // 엑셀 다운로드
  // ============================================================
  const handleExcelDownload = useCallback(async () => {
    if (rows.length === 0) return;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('쉽먼트');

    worksheet.columns = [
      { header: '박스위치',  key: 'box_code',         width: 14 },
      { header: '주문번호',  key: 'product_no',        width: 16 },
      { header: '바코드',    key: 'barcode',           width: 18 },
      { header: '상품명',    key: 'item_name',         width: 30 },
      { header: '옵션명',    key: 'option_name',       width: 25 },
      { header: '단가',      key: 'price_cny',         width: 10 },
      { header: '품목',      key: 'customs_category',  width: 20 },
      { header: '출고개수',  key: 'quantity',          width: 10 },
      { header: '입고개수',  key: 'available_qty',     width: 10 },
      { header: '확인사항',  key: 'note',              width: 15 },
      { header: '이미지',    key: 'img_url',           width: 30 },
      { header: '혼용률',    key: 'composition',       width: 20 },
    ];

    for (const row of rows) {
      worksheet.addRow({
        box_code:        row.box_code || '',
        product_no:      row.product_no || '',
        barcode:         row.barcode || '',
        item_name:       row.item_name || '',
        option_name:     row.option_name || '',
        price_cny:       row.price_cny ?? '',
        customs_category: row.customs_category || '',
        quantity:        row.quantity,
        available_qty:   row.available_qty,
        note:            '',
        img_url:         row.img_url || '',
        composition:     row.composition || '',
      });
    }

    // 헤더 스타일
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shipment_v2_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows]);

  // ============================================================
  // 이동 모달 — 입력·저장은 components/MoveModal (단건 수량 분할 / 다건 전체 이동)
  // ============================================================

  /** 선택된 행 (화면 순서) — 모달의 "첫 주문번호 외 N건" 기준 */
  const selectedRows = useMemo(
    () => rows.filter((_, idx) => checkedIds.has(String(idx))),
    [rows, checkedIds]
  );

  /** 선택 사용자의 user_code — 새 박스 코드 접두어 (상품출고 V2 와 동일하게 대문자) */
  const selectedUserCode = useMemo(
    () => (ftUsers.find((u) => u.id === selectedUserId)?.user_code || '').toUpperCase(),
    [ftUsers, selectedUserId]
  );

  const handleMoveOpen = () => {
    if (checkedIds.size === 0) { alert(t('shipmentV2.alerts.selectMove')); return; }
    setShowMoveModal(true);
  };

  /** 이동 완료 (일부 실패 포함) — 분할로 새 행 id 가 생기므로 로컬 패치 대신 재조회 */
  const handleMoved = () => {
    setShowMoveModal(false);
    setCheckedIds(new Set());
    fetchData(selectedUserId);
  };

  // ============================================================
  // 합배송 모달
  // ============================================================

  /** PACKING 상태 박스 목록 조회 */
  const fetchMergeBoxes = useCallback(async (userId: string) => {
    try {
      const res = await fetch(`/api/ft/box-info?user_id=${userId}&status=PACKING`);
      const json = await res.json();
      if (json.success) {
        // box_code 오름차순 정렬
        const sorted = (json.data || []).sort((a: BoxInfoItem, b: BoxInfoItem) =>
          (a.box_code || '').localeCompare(b.box_code || '')
        );
        setMergeBoxes(sorted);
      }
    } catch (err) {
      console.error('box-info fetch error:', err);
    }
  }, []);

  const handleMergeOpen = () => {
    setMergeFrom('');
    setMergeTo('');
    fetchMergeBoxes(selectedUserId);
    setShowMergeModal(true);
  };

  /** 합배송 확인: mergeFrom.master_box_id = mergeTo.id, master_box_code = mergeTo.box_code */
  const handleMergeConfirm = async () => {
    if (!mergeFrom || !mergeTo || mergeFrom === mergeTo) {
      alert('박스 1과 박스 2를 다르게 선택해주세요.');
      return;
    }
    const targetBox = mergeBoxes.find((b) => b.id === mergeTo);
    if (!targetBox) return;

    try {
      const res = await fetch('/api/ft/box-info', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: mergeFrom,
          fields: { master_box_id: mergeTo, master_box_code: targetBox.box_code },
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowMergeModal(false);
        fetchData(selectedUserId);
      } else {
        alert('합배송 실패: ' + (json.error || ''));
      }
    } catch {
      alert('합배송 중 오류가 발생했습니다.');
    }
  };

  // ============================================================
  // 출고 모달
  // ============================================================
  const handleShipOpen = () => {
    if (checkedIds.size === 0) {
      alert('출고할 항목을 선택해주세요.');
      return;
    }
    setShipInput('');
    setShowShipModal(true);
  };

  const handleShipConfirm = async () => {
    if (shipInput.length !== 6 || !/^\d{6}$/.test(shipInput)) {
      alert('6자리 숫자를 입력해주세요.');
      return;
    }

    // 선택된 유저의 user_code 가져오기
    const selectedUser = ftUsers.find((u) => u.id === selectedUserId);
    if (!selectedUser) {
      alert('사용자를 먼저 선택해주세요.');
      return;
    }

    const shipmentNo = `SH${selectedUser.user_code}${shipInput}`;

    // 체크된 행의 fulfillment id, box_codes 추출
    const checkedRows = Array.from(checkedIds).map((idxStr) => rows[parseInt(idxStr, 10)]);
    const fulfillmentIds = checkedRows.map((r) => r.id);
    const boxCodes = [...new Set(checkedRows.map((r) => r.box_code).filter(Boolean))];

    setIsShipping(true);
    try {
      const res = await fetch('/api/ft/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: selectedUserId,
          shipment_no: shipmentNo,
          date: new Date().toISOString().slice(0, 10),
          fulfillment_ids: fulfillmentIds,
          box_codes: boxCodes,
        }),
      });
      const json = await res.json();

      if (json.success) {
        alert(`출고 완료: ${shipmentNo}\n(${json.updated_fulfillments}건 처리)`);
        setShowShipModal(false);
        setCheckedIds(new Set());
        // 데이터 새로고침 (출고된 항목은 shipment=true가 되어 목록에서 사라짐)
        fetchData(selectedUserId);
      } else {
        alert('출고 실패: ' + (json.error || ''));
      }
    } catch {
      alert('출고 처리 중 오류가 발생했습니다.');
    } finally {
      setIsShipping(false);
    }
  };

  // ============================================================
  // 품목 분류 (Gemini AI)
  // ============================================================
  const handleClassifyProducts = useCallback(async () => {
    if (rows.length === 0) {
      alert('분류할 데이터가 없습니다.');
      return;
    }

    // customs_category가 비어있는 항목의 unique item_name 추출
    const uniqueNames = [
      ...new Set(
        rows
          .filter((r) => !r.customs_category && r.item_name)
          .map((r) => r.item_name!)
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
      fetchData(selectedUserId);
    } catch (error) {
      console.error('품목 분류 오류:', error);
      alert(error instanceof Error ? error.message : '품목 분류 중 오류가 발생했습니다.');
    } finally {
      setIsClassifying(false);
    }
  }, [rows, selectedUserId, fetchData]);



  // ============================================================
  // box_code 기준 그룹핑 (rowSpan 계산 — 보이는 행 기준, key 는 원본 idx)
  // ============================================================
  const packageGroups: { packageNo: string; startIdx: number; count: number }[] = [];
  let prevPkg: string | null = null;
  for (const i of visibleIndices) {
    const pkg = rows[i].box_code || '';
    if (pkg !== prevPkg) {
      packageGroups.push({ packageNo: pkg, startIdx: i, count: 1 });
      prevPkg = pkg;
    } else {
      packageGroups[packageGroups.length - 1].count++;
    }
  }
  const rowSpanMap = new Map<number, number>();
  for (const g of packageGroups) rowSpanMap.set(g.startIdx, g.count);

  // ── 총 colSpan (12열) ──
  const TOTAL_COLS = 12;

  return (
    <div className="shipment-v2-layout">
      <TopsideMenu />
      <div className="shipment-v2-main-content">
        <LeftsideMenu />
        <main className="shipment-v2-content">
          <div className="shipment-v2-container">

            {/* ── 타이틀 + 사용자 드롭다운 ── */}
            <div className="shipment-v2-header">
              <h1 className="shipment-v2-title">{t('shipmentV2.title')}</h1>
              <div className="shipment-v2-header-right">
                {rows.length > 0 && (
                  <span className="shipment-v2-count">{t('shipmentV2.totalCount', { count: rows.length })}</span>
                )}
                <select
                  className="shipment-v2-user-dropdown"
                  value={selectedUserId}
                  onChange={handleUserChange}
                >
                  <option value="">{t('shipmentV2.selectUser')}</option>
                  {ftUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.vender_name || user.full_name} {user.user_code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── 액션 바: 왼쪽[품목,엑셀,이동,합배송,출고] / 오른쪽[저장] ── */}
            <div className="shipment-v2-action-bar">
              <div className="shipment-v2-action-left">
                <button
                  className="shipment-v2-move-btn"
                  onClick={handleClassifyProducts}
                  disabled={isClassifying || rows.length === 0}
                >
                  {isClassifying ? t('shipmentV2.buttons.classifying') : t('shipmentV2.buttons.classify')}
                </button>
                <button
                  className="shipment-v2-excel-btn"
                  onClick={handleExcelDownload}
                  disabled={rows.length === 0}
                >
                  {t('shipmentV2.buttons.excel')}
                </button>
                <button
                  className="shipment-v2-move-btn"
                  onClick={handleMoveOpen}
                  disabled={checkedIds.size === 0}
                >
                  {t('shipmentV2.buttons.move')}
                </button>
                <button
                  className="shipment-v2-merge-btn"
                  onClick={handleMergeOpen}
                  disabled={!selectedUserId}
                >
                  {t('shipmentV2.buttons.merge')}
                </button>
                <button
                  className="shipment-v2-ship-btn"
                  onClick={handleShipOpen}
                  disabled={checkedIds.size === 0}
                >
                  {t('shipmentV2.buttons.ship')}
                </button>
              </div>
              <div className="shipment-v2-action-right">
                <button
                  className={`shipment-v2-save-btn ${dirtyCategories.size > 0 ? 'shipment-v2-save-btn--dirty' : ''}`}
                  onClick={handleSaveAll}
                  disabled={dirtyCategories.size === 0}
                >
                  {t('shipmentV2.buttons.save')}{dirtyCategories.size > 0 ? ` (${dirtyCategories.size})` : ''}
                </button>
              </div>
            </div>

            {/* ── 요약 보드: 품목별 개수 | 쉽먼트에러 (클릭 → 필터) ── */}
            {rows.length > 0 && (
              <SummaryFilterBar
                rows={rows}
                rowErrors={rowErrors}
                filter={filter}
                onFilterChange={setFilter}
              />
            )}

            {/* ── 테이블 ── */}
            <div className="shipment-v2-table-board">
              <table className="shipment-v2-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'center' }}>{t('shipmentV2.table.box')}</th>
                    <th style={{ textAlign: 'center', width: '30px' }}>
                      <input
                        type="checkbox"
                        checked={allVisibleChecked}
                        onChange={toggleAll}
                      />
                    </th>
                    <th>{t('shipmentV2.table.order')}</th>
                    <th>{t('shipmentV2.table.barcode')}</th>
                    <th>{t('shipmentV2.table.product')}</th>
                    <th>{t('shipmentV2.table.options')}</th>
                    <th style={{ textAlign: 'center' }}>{t('shipmentV2.table.price')}</th>
                    <th style={{ textAlign: 'center' }}>{t('shipmentV2.table.category')}</th>
                    <th style={{ textAlign: 'center' }}>{t('shipmentV2.table.shipmentSize')}</th>
                    <th style={{ textAlign: 'center' }}>{t('shipmentV2.table.arrival')}</th>
                    <th style={{ textAlign: 'center' }}>{t('shipmentV2.table.scan')}</th>
                    <th style={{ textAlign: 'center' }}>{t('shipmentV2.table.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={TOTAL_COLS} className="shipment-v2-empty">{t('shipmentV2.empty.loading')}</td></tr>
                  ) : !selectedUserId ? (
                    <tr><td colSpan={TOTAL_COLS} className="shipment-v2-empty">{t('shipmentV2.empty.selectUser')}</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={TOTAL_COLS} className="shipment-v2-empty">{t('shipmentV2.empty.noData')}</td></tr>
                  ) : visibleIndices.length === 0 ? (
                    <tr><td colSpan={TOTAL_COLS} className="shipment-v2-empty">{t('shipmentV2.empty.noFilterMatch')}</td></tr>
                  ) : (
                    visibleIndices.map((idx) => {
                      const row         = rows[idx];
                      const span        = rowSpanMap.get(idx);
                      const boxType     = getBoxType(row.box_code || '');
                      const badgeClass  = getBadgeClass(boxType);
                      const chinaOptions = [row.china_option1, row.china_option2].filter(Boolean).join(', ');
                      const productInfo  = [row.item_name, row.option_name].filter(Boolean).join(', ');
                      const isChecked   = checkedIds.has(String(idx));
                      const isMismatch  = row.total_qty !== row.available_qty;
                      const isEditing   = editingCell === String(idx);
                      const isCategoryEditing = editingCategory === String(idx);
                      const sizeError   = rowErrors[idx];

                      return (
                        <tr
                          key={`${row.id}-${idx}`}
                          className={isChecked ? 'shipment-v2-row--checked' : ''}
                          style={isMismatch ? { backgroundColor: '#fed7aa' } : undefined}
                        >
                          {/* ── 박스번호: rowSpan 병합, 합배송 시 계층 표시 ── */}
                          {span !== undefined && (
                            <td rowSpan={span} style={{ textAlign: 'center' }}>
                              {/* 원래 박스 배지 — 합배송된 경우 회색 */}
                              <span
                                className={`shipment-v2-badge ${row.master_box_code ? 'shipment-v2-badge--gray' : badgeClass}`}
                                style={{ cursor: 'pointer' }}
                                onClick={() => handlePackageClick(row.box_code)}
                              >
                                {row.box_code}
                              </span>
                              {/* 합배송 마스터 박스 표시 */}
                              {row.master_box_code && (
                                <>
                                  <div className="shipment-v2-merge-arrow">↓</div>
                                  <span className={`shipment-v2-badge ${getBadgeClass(getBoxType(row.master_box_code))}`}>
                                    {row.master_box_code}
                                  </span>
                                </>
                              )}
                            </td>
                          )}

                          {/* ── 체크박스 ── */}
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleCheck(String(idx))}
                            />
                          </td>

                          {/* ── 주문번호 (클릭 → 체크) ── */}
                          <td className="shipment-v2-clickable" onClick={() => handleProductNoClick(idx)}>
                            {row.product_no || '-'}
                          </td>

                          <td>{row.barcode || '-'}</td>
                          <td>{productInfo || '-'}</td>
                          <td>{chinaOptions || '-'}</td>

                          {/* ── 단가 ── */}
                          <td className="shipment-v2-qty">{row.price_cny ?? '-'}</td>

                          {/* ── 품목 (인라인 편집) ── */}
                          <td
                            ref={isCategoryEditing ? categoryRef : undefined}
                            className={`shipment-v2-qty shipment-v2-editable ${isCategoryEditing ? 'shipment-v2-editable--active' : ''}`}
                            contentEditable={isCategoryEditing}
                            suppressContentEditableWarning
                            onClick={() => !isCategoryEditing && handleCategoryClick(idx)}
                            onBlur={() => isCategoryEditing && handleCategoryBlur(idx)}
                            onKeyDown={(e) => isCategoryEditing && handleCategoryKeyDown(e, idx)}
                          >
                            {row.customs_category || '-'}
                          </td>

                          {/* ── 쉽먼트사이즈 (배지) — 주문 기준 size_code, 박스와 안 맞으면 빨간 깜빡임 ── */}
                          <td className="shipment-v2-qty">
                            {(() => {
                              const code = row.size_code;
                              if (!code) return '-';
                              const errorClass = sizeError ? 'shipment-v2-badge--error-blink' : '';
                              return (
                                <span
                                  className={`shipment-v2-badge ${getBadgeClass(code)} ${errorClass}`}
                                  title={sizeError ? t('shipmentV2.summary.shipmentErrorHint') : undefined}
                                >
                                  {code}
                                </span>
                              );
                            })()}
                          </td>

                          {/* ── 입고 ── */}
                          <td className="shipment-v2-qty">{row.available_qty}</td>

                          {/* ── 스캔 (인라인 편집) ── */}
                          <td
                            ref={isEditing ? editRef : undefined}
                            className={`shipment-v2-qty shipment-v2-editable ${isEditing ? 'shipment-v2-editable--active' : ''}`}
                            contentEditable={isEditing}
                            suppressContentEditableWarning
                            onClick={() => !isEditing && handleQuantityClick(idx)}
                            onBlur={() => isEditing && handleQuantityBlur(idx)}
                            onKeyDown={(e) => isEditing && handleQuantityKeyDown(e, idx)}
                          >
                            {row.quantity}
                          </td>

                          {/* ── 전체 (order_item_id 기준 총 PACKED) ── */}
                          <td className="shipment-v2-qty">{row.total_qty}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

          </div>
        </main>
      </div>

      {/* ============================================================ */}
      {/* 이동 모달                                                      */}
      {/* ============================================================ */}
      {showMoveModal && selectedRows.length > 0 && (
        <MoveModal
          userId={selectedUserId}
          userCode={selectedUserCode}
          rows={selectedRows}
          onClose={() => setShowMoveModal(false)}
          onMoved={handleMoved}
        />
      )}

      {/* ============================================================ */}
      {/* 합배송 모달                                                    */}
      {/* ============================================================ */}
      {showMergeModal && (
        <div className="shipment-v2-modal-overlay" onClick={() => setShowMergeModal(false)}>
          <div className="shipment-v2-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="shipment-v2-modal-title">합배송 설정</h3>
            <p className="shipment-v2-modal-desc">
              박스 1이 박스 2에 합배송됩니다.
            </p>

            <div className="shipment-v2-modal-field">
              <label>박스 1 (합배송 대상)</label>
              <select
                className="shipment-v2-modal-select"
                value={mergeFrom}
                onChange={(e) => setMergeFrom(e.target.value)}
              >
                <option value="">선택</option>
                {mergeBoxes.map((b) => (
                  <option key={b.id} value={b.id}>{b.box_code}</option>
                ))}
              </select>
            </div>

            <div className="shipment-v2-merge-arrow-label">↓</div>

            <div className="shipment-v2-modal-field">
              <label>박스 2 (마스터 박스)</label>
              <select
                className="shipment-v2-modal-select"
                value={mergeTo}
                onChange={(e) => setMergeTo(e.target.value)}
              >
                <option value="">선택</option>
                {mergeBoxes
                  .filter((b) => b.id !== mergeFrom)
                  .map((b) => (
                    <option key={b.id} value={b.id}>{b.box_code}</option>
                  ))}
              </select>
            </div>

            <div className="shipment-v2-modal-actions">
              <button className="shipment-v2-modal-cancel" onClick={() => setShowMergeModal(false)}>취소</button>
              <button
                className="shipment-v2-modal-confirm"
                onClick={handleMergeConfirm}
                disabled={!mergeFrom || !mergeTo}
              >
                합배송
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ============================================================ */}
      {/* 출고 모달 — 6자리 숫자 입력                                    */}
      {/* ============================================================ */}
      {showShipModal && (
        <div className="shipment-v2-modal-overlay" onClick={() => !isShipping && setShowShipModal(false)}>
          <div className="shipment-v2-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="shipment-v2-modal-title">출고 처리</h3>
            <p className="shipment-v2-modal-desc">
              선택된 {checkedIds.size}개 항목을 출고합니다.
            </p>
            <div className="shipment-v2-modal-field">
              <label>쉽먼트 번호 (6자리 숫자)</label>
              <div className="shipment-v2-ship-preview">
                SH{ftUsers.find((u) => u.id === selectedUserId)?.user_code || '??'}{shipInput || '______'}
              </div>
              <input
                type="text"
                className="shipment-v2-ship-input"
                placeholder="000000"
                value={shipInput}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setShipInput(val);
                }}
                maxLength={6}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && shipInput.length === 6) handleShipConfirm();
                }}
              />
            </div>
            <div className="shipment-v2-modal-actions">
              <button
                className="shipment-v2-modal-cancel"
                onClick={() => setShowShipModal(false)}
                disabled={isShipping}
              >
                취소
              </button>
              <button
                className="shipment-v2-modal-confirm"
                onClick={handleShipConfirm}
                disabled={shipInput.length !== 6 || isShipping}
                style={{ backgroundColor: '#dc2626' }}
              >
                {isShipping ? '처리 중...' : '출고'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShipmentV2;
