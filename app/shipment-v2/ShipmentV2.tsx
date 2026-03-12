'use client';

import React, { useState, useCallback, useRef } from 'react';
import ExcelJS from 'exceljs';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import { useFtUsers } from '../import-product-v2/hooks/useFtData';
import './ShipmentV2.css';

// ============================================================
// 인터페이스
// ============================================================
interface ShipmentV2Row {
  id: string;
  box_code: string;
  master_box_id: string | null;
  master_box_code: string | null;
  order_item_id: string;
  quantity: number;
  total_qty: number;
  available_qty: number;
  shipment_size: string | null;
  product_no: string | null;
  barcode: string | null;
  item_name: string | null;
  option_name: string | null;
  china_option1: string | null;
  china_option2: string | null;
  price_cny: number | null;
  img_url: string | null;
  composition: string | null;
  customs_category: string | null;
}

interface BoxInfoItem {
  id: string;
  box_code: string;
}

// ============================================================
// 유틸: 박스 타입 추출 (BZ-A-01 → A)
// ============================================================
const getBoxType = (code: string): string => {
  const parts = code.split('-');
  return parts.length >= 2 ? parts[1].toUpperCase() : '';
};

// ============================================================
// 유틸: 배지 색상 클래스 (박스타입 & 사이즈코드 공용)
// ============================================================
const getBadgeClass = (code: string): string => {
  switch (code) {
    case 'A': case 'B': case 'C': return 'shipment-v2-badge--blue';
    case 'P': return 'shipment-v2-badge--orange';
    case 'X': return 'shipment-v2-badge--black';
    default:  return 'shipment-v2-badge--gray';
  }
};

// ============================================================
// 유틸: 쉽먼트사이즈 정규화 (프론트용)
// Small → A, Medium → B, Large → C, P-xxx → P, Direct → X
// ============================================================
const normalizeSizeDisplay = (raw: string | null): string | null => {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  if (lower === 'small') return 'A';
  if (lower === 'medium') return 'B';
  if (lower === 'large') return 'C';
  if (lower.startsWith('p-')) return 'P';
  if (lower === 'direct') return 'X';
  if (['a', 'b', 'c', 'p', 'x'].includes(lower)) return lower.toUpperCase();
  return raw;
};

// ============================================================
// 메인 컴포넌트
// ============================================================
const ShipmentV2: React.FC = () => {
  const { users: ftUsers } = useFtUsers();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [rows, setRows] = useState<ShipmentV2Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // ── 입고 인라인 편집 ──
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const editRef = useRef<HTMLTableCellElement>(null);

  // ── 이동 모달 ──
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveTarget, setMoveTarget] = useState('');

  // ── 품목 분류 ──
  const [isClassifying, setIsClassifying] = useState(false);

  // ── 품목 인라인 편집 ──
  const [editingCategory, setEditingCategory] = useState<string | null>(null); // idx as string
  const categoryRef = useRef<HTMLTableCellElement>(null);

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
    fetchData(userId);
  };

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

  const toggleAll = () => {
    setCheckedIds(
      checkedIds.size === rows.length
        ? new Set()
        : new Set(rows.map((_, idx) => String(idx)))
    );
  };

  // ── 주문번호 클릭 → 체크박스 토글 ──
  const handleProductNoClick = (idx: number) => toggleCheck(String(idx));

  // ── 박스번호 배지 클릭 → 해당 box_code 전체 토글 ──
  const handlePackageClick = (packageNo: string) => {
    const indices = rows
      .map((r, i) => (r.box_code === packageNo ? String(i) : null))
      .filter(Boolean) as string[];
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

  const handleCategoryBlur = async (idx: number) => {
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
        // DB 저장 (order_item_id 기준)
        try {
          await fetch('/api/ft/order-items', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: row.order_item_id,
              fields: { customs_category: newVal || null },
            }),
          });
        } catch (err) {
          console.error('품목 저장 오류:', err);
        }
      }
    }
    setEditingCategory(null);
  };

  const handleCategoryKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Enter') { e.preventDefault(); handleCategoryBlur(idx); }
    else if (e.key === 'Escape') setEditingCategory(null);
  };

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
  // 이동 모달
  // ============================================================
  const handleMoveOpen = () => {
    if (checkedIds.size === 0) { alert('이동할 항목을 선택해주세요.'); return; }
    setMoveTarget('');
    setShowMoveModal(true);
  };

  const handleMoveConfirm = async () => {
    if (!moveTarget.trim()) { alert('이동할 박스번호를 입력해주세요.'); return; }

    const updates = Array.from(checkedIds).flatMap((idxStr) => {
      const row = rows[parseInt(idxStr, 10)];
      return [{ id: row.id, fields: { box_code: moveTarget.trim() } }];
    });

    try {
      const res = await fetch('/api/ft/shipment-v2', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const json = await res.json();
      if (json.success) {
        setRows((prev) => {
          const next = [...prev];
          for (const idxStr of checkedIds) {
            const i = parseInt(idxStr, 10);
            next[i] = { ...next[i], box_code: moveTarget.trim() };
          }
          next.sort((a, b) => (a.box_code || '').localeCompare(b.box_code || ''));
          return next;
        });
        setCheckedIds(new Set());
        setShowMoveModal(false);
      } else {
        alert('이동 실패: ' + (json.error || ''));
      }
    } catch {
      alert('이동 중 오류가 발생했습니다.');
    }
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
  // box_code 기준 그룹핑 (rowSpan 계산)
  // ============================================================
  const packageGroups: { packageNo: string; startIdx: number; count: number }[] = [];
  let prevPkg = '';
  for (let i = 0; i < rows.length; i++) {
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

  // ── 고유 box_code 목록 (이동 모달 드롭다운용) ──
  const uniquePackages = [...new Set(rows.map((r) => r.box_code).filter(Boolean))].sort();

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
              <h1 className="shipment-v2-title">쉽먼트 V2 😈</h1>
              <div className="shipment-v2-header-right">
                {rows.length > 0 && (
                  <span className="shipment-v2-count">총 {rows.length}건</span>
                )}
                <select
                  className="shipment-v2-user-dropdown"
                  value={selectedUserId}
                  onChange={handleUserChange}
                >
                  <option value="">사용자 선택</option>
                  {ftUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.vendor_name || user.full_name} {user.user_code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── 액션 바: [이동] [합배송] [엑셀] ── */}
            <div className="shipment-v2-action-bar">
              <button
                className="shipment-v2-move-btn"
                onClick={handleMoveOpen}
                disabled={checkedIds.size === 0}
              >
                이동
              </button>
              <button
                className="shipment-v2-merge-btn"
                onClick={handleMergeOpen}
                disabled={!selectedUserId}
              >
                합배송
              </button>
              <button
                className="shipment-v2-excel-btn"
                onClick={handleExcelDownload}
                disabled={rows.length === 0}
              >
                엑셀
              </button>
              <button
                className="shipment-v2-move-btn"
                onClick={handleClassifyProducts}
                disabled={isClassifying || rows.length === 0}
              >
                {isClassifying ? '분류 중...' : '품목'}
              </button>
              <button
                className="shipment-v2-ship-btn"
                onClick={handleShipOpen}
                disabled={checkedIds.size === 0}
              >
                출고
              </button>
            </div>

            {/* ── 테이블 ── */}
            <div className="shipment-v2-table-board">
              <table className="shipment-v2-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'center' }}>박스번호</th>
                    <th style={{ textAlign: 'center', width: '30px' }}>
                      <input
                        type="checkbox"
                        checked={rows.length > 0 && checkedIds.size === rows.length}
                        onChange={toggleAll}
                      />
                    </th>
                    <th>주문번호</th>
                    <th>바코드</th>
                    <th>상품정보</th>
                    <th>주문옵션</th>
                    <th style={{ textAlign: 'center' }}>단가</th>
                    <th style={{ textAlign: 'center' }}>품목</th>
                    <th style={{ textAlign: 'center' }}>쉽먼트사이즈</th>
                    <th style={{ textAlign: 'center' }}>입고</th>
                    <th style={{ textAlign: 'center' }}>스캔</th>
                    <th style={{ textAlign: 'center' }}>전체</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={TOTAL_COLS} className="shipment-v2-empty">로딩 중...</td></tr>
                  ) : !selectedUserId ? (
                    <tr><td colSpan={TOTAL_COLS} className="shipment-v2-empty">사용자를 선택해주세요.</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={TOTAL_COLS} className="shipment-v2-empty">데이터 없음</td></tr>
                  ) : (
                    rows.map((row, idx) => {
                      const span        = rowSpanMap.get(idx);
                      const boxType     = getBoxType(row.box_code || '');
                      const badgeClass  = getBadgeClass(boxType);
                      const chinaOptions = [row.china_option1, row.china_option2].filter(Boolean).join(', ');
                      const productInfo  = [row.item_name, row.option_name].filter(Boolean).join(', ');
                      const isChecked   = checkedIds.has(String(idx));
                      const isMismatch  = row.total_qty !== row.available_qty;
                      const isEditing   = editingCell === String(idx);
                      const isCategoryEditing = editingCategory === String(idx);

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

                          {/* ── 쉽먼트사이즈 (배지) ── */}
                          <td className="shipment-v2-qty">
                            {(() => {
                              const code = normalizeSizeDisplay(row.shipment_size);
                              return code
                                ? <span className={`shipment-v2-badge ${getBadgeClass(code)}`}>{code}</span>
                                : '-';
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
      {showMoveModal && (
        <div className="shipment-v2-modal-overlay" onClick={() => setShowMoveModal(false)}>
          <div className="shipment-v2-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="shipment-v2-modal-title">박스 이동</h3>
            <p className="shipment-v2-modal-desc">
              선택된 {checkedIds.size}개 항목을 이동합니다.
            </p>
            <div className="shipment-v2-modal-field">
              <label>이동할 박스번호</label>
              <select
                className="shipment-v2-modal-select"
                value={moveTarget}
                onChange={(e) => setMoveTarget(e.target.value)}
              >
                <option value="">선택 또는 직접 입력</option>
                {uniquePackages.map((pkg) => (
                  <option key={pkg} value={pkg}>{pkg}</option>
                ))}
              </select>
              <input
                type="text"
                className="shipment-v2-modal-input"
                placeholder="직접 입력 (예: BZ-A-03)"
                value={moveTarget}
                onChange={(e) => setMoveTarget(e.target.value.toUpperCase())}
              />
            </div>
            <div className="shipment-v2-modal-actions">
              <button className="shipment-v2-modal-cancel" onClick={() => setShowMoveModal(false)}>취소</button>
              <button className="shipment-v2-modal-confirm" onClick={handleMoveConfirm}>이동</button>
            </div>
          </div>
        </div>
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
