'use client';

import React, { useState, useCallback, useMemo } from 'react';
import ExcelJS from 'exceljs';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import { useFtUsers } from '../import-product-v2/hooks/useFtData';
import '../shipment-v2/ShipmentV2.css';

// ============================================================
// 인터페이스
// ============================================================
interface ShipmentCompleteRow {
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
  shipment_no: string | null;
}

interface ShipmentInfo {
  id: string;
  shipment_no: string;
  date: string; // yyyy-mm-dd
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
// 유틸: 쉽먼트사이즈 정규화 (프론트용 — 이미 정규화 안 된 데이터 대응)
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
const ShipmentCompleteV2: React.FC = () => {
  const { users: ftUsers } = useFtUsers();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [rows, setRows] = useState<ShipmentCompleteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // ── 확정 상태 ──
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // ── 쉽먼트 목록 (ft_shipments) ──
  const [shipments, setShipments] = useState<ShipmentInfo[]>([]);

  // ── 필터 드롭다운 값 ──
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedShipmentId, setSelectedShipmentId] = useState('');

  // ============================================================
  // 쉽먼트 목록 조회 (사용자 선택 시)
  // ============================================================
  const fetchShipments = useCallback(async (userId: string) => {
    if (!userId) {
      setShipments([]);
      return;
    }
    try {
      const res = await fetch(`/api/ft/shipments?user_id=${userId}`);
      const json = await res.json();
      setShipments(json.success ? (json.data || []) : []);
    } catch (err) {
      console.error('shipments fetch error:', err);
      setShipments([]);
    }
  }, []);

  // ============================================================
  // 테이블 데이터 로딩 (shipment_id 기준)
  //   1) 먼저 ft_shipment_details(확정 데이터) 조회
  //   2) 없으면 ft_fulfillments 실시간 계산
  // ============================================================
  const fetchData = useCallback(async (userId: string, shipmentId: string) => {
    if (!userId || !shipmentId) { setRows([]); setIsConfirmed(false); return; }
    setLoading(true);
    try {
      // 1) 확정 데이터 먼저 시도
      const detailRes = await fetch(`/api/ft/shipment-details?user_id=${userId}&shipment_id=${shipmentId}`);
      const detailJson = await detailRes.json();

      if (detailJson.success && detailJson.confirmed && detailJson.data?.length > 0) {
        setRows(detailJson.data);
        setIsConfirmed(true);
        return;
      }

      // 2) 확정 데이터 없으면 실시간 계산
      setIsConfirmed(false);
      const res = await fetch(`/api/ft/shipment-v2?user_id=${userId}&shipment_id=${shipmentId}`);
      const json = await res.json();
      setRows(json.success ? (json.data || []) : []);
    } catch (err) {
      console.error('shipment-complete-v2 fetch error:', err);
      setRows([]);
      setIsConfirmed(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // ============================================================
  // [확정] — ft_shipment_details에 스냅샷 저장
  // ============================================================
  const handleConfirm = useCallback(async () => {
    if (!selectedUserId || !selectedShipmentId || rows.length === 0) return;
    if (!window.confirm(`현재 ${rows.length}건의 데이터를 확정 저장하시겠습니까?`)) return;

    setConfirmLoading(true);
    try {
      const res = await fetch('/api/ft/shipment-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipment_id: selectedShipmentId,
          user_id: selectedUserId,
          rows,
        }),
      });
      const json = await res.json();
      if (json.success) {
        const doneMsg = json.doneCount > 0 ? ` (${json.doneCount}건 DONE 처리)` : '';
        alert(`${json.count}건 확정 저장 완료${doneMsg}`);
        setIsConfirmed(true);
      } else {
        alert(json.error || '확정 저장 실패');
      }
    } catch (err) {
      console.error('confirm error:', err);
      alert('확정 저장 중 오류가 발생했습니다.');
    } finally {
      setConfirmLoading(false);
    }
  }, [selectedUserId, selectedShipmentId, rows]);

  // ============================================================
  // [확정 취소] — ft_shipment_details 삭제 → 실시간 재조회
  // ============================================================
  const handleUnconfirm = useCallback(async () => {
    if (!selectedUserId || !selectedShipmentId) return;
    if (!window.confirm('확정을 취소하시겠습니까? 확정 데이터가 삭제되고 실시간 계산으로 전환됩니다.')) return;

    setConfirmLoading(true);
    try {
      const res = await fetch('/api/ft/shipment-details', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipment_id: selectedShipmentId,
          user_id: selectedUserId,
        }),
      });
      const json = await res.json();
      if (json.success) {
        alert('확정 취소 완료. 실시간 데이터를 다시 조회합니다.');
        setIsConfirmed(false);
        // 실시간 재조회
        const liveRes = await fetch(`/api/ft/shipment-v2?user_id=${selectedUserId}&shipment_id=${selectedShipmentId}`);
        const liveJson = await liveRes.json();
        setRows(liveJson.success ? (liveJson.data || []) : []);
      } else {
        alert(json.error || '확정 취소 실패');
      }
    } catch (err) {
      console.error('unconfirm error:', err);
      alert('확정 취소 중 오류가 발생했습니다.');
    } finally {
      setConfirmLoading(false);
    }
  }, [selectedUserId, selectedShipmentId]);

  // ============================================================
  // 드롭다운 파생 데이터
  // ============================================================

  // ── 연도 목록 (shipments의 date에서 추출) ──
  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    for (const s of shipments) {
      if (s.date) years.add(s.date.slice(0, 4));
    }
    return [...years].sort((a, b) => b.localeCompare(a)); // 최신 연도 먼저
  }, [shipments]);

  // ── 월 목록 (선택된 연도 기준) ──
  const monthOptions = useMemo(() => {
    if (!selectedYear) return [];
    const months = new Set<string>();
    for (const s of shipments) {
      if (s.date && s.date.startsWith(selectedYear)) {
        months.add(s.date.slice(5, 7));
      }
    }
    return [...months].sort((a, b) => b.localeCompare(a)); // 최신 월 먼저
  }, [shipments, selectedYear]);

  // ── shipment_no 목록 (선택된 연도+월 기준) ──
  const shipmentOptions = useMemo(() => {
    if (!selectedYear || !selectedMonth) return [];
    const prefix = `${selectedYear}-${selectedMonth}`;
    return shipments
      .filter((s) => s.date && s.date.startsWith(prefix))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [shipments, selectedYear, selectedMonth]);

  // ============================================================
  // 이벤트 핸들러
  // ============================================================

  // ── 사용자 변경 → 쉽먼트 목록 조회 ──
  const handleUserChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const userId = e.target.value;
    setSelectedUserId(userId);
    setSelectedYear('');
    setSelectedMonth('');
    setSelectedShipmentId('');
    setRows([]);
    setCheckedIds(new Set());
    setIsConfirmed(false);
    fetchShipments(userId);
  };

  // ── 연도 변경 ──
  const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedYear(e.target.value);
    setSelectedMonth('');
    setSelectedShipmentId('');
    setRows([]);
  };

  // ── 월 변경 ──
  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedMonth(e.target.value);
    setSelectedShipmentId('');
    setRows([]);
  };

  // ── 쉽먼트 선택 → 테이블 데이터 로드 ──
  const handleShipmentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const shipId = e.target.value;
    setSelectedShipmentId(shipId);
    setCheckedIds(new Set());
    if (shipId) {
      fetchData(selectedUserId, shipId);
    } else {
      setRows([]);
    }
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

  const handleProductNoClick = (idx: number) => toggleCheck(String(idx));

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
  // 엑셀 다운로드
  // ============================================================
  const handleExcelDownload = useCallback(async () => {
    if (rows.length === 0) return;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('출고완료');

    worksheet.columns = [
      { header: '박스위치',    key: 'box_code',         width: 14 },
      { header: '쉽먼트번호',  key: 'shipment_no',      width: 18 },
      { header: '주문번호',    key: 'product_no',        width: 16 },
      { header: '바코드',      key: 'barcode',           width: 18 },
      { header: '상품명',      key: 'item_name',         width: 30 },
      { header: '옵션명',      key: 'option_name',       width: 25 },
      { header: '단가',        key: 'price_cny',         width: 10 },
      { header: '품목',        key: 'customs_category',  width: 20 },
      { header: '출고개수',    key: 'quantity',          width: 10 },
      { header: '입고개수',    key: 'available_qty',     width: 10 },
      { header: '이미지',      key: 'img_url',           width: 30 },
      { header: '혼용률',      key: 'composition',       width: 20 },
    ];

    for (const row of rows) {
      worksheet.addRow({
        box_code:        row.box_code || '',
        shipment_no:     row.shipment_no || '',
        product_no:      row.product_no || '',
        barcode:         row.barcode || '',
        item_name:       row.item_name || '',
        option_name:     row.option_name || '',
        price_cny:       row.price_cny ?? '',
        customs_category: row.customs_category || '',
        quantity:        row.quantity,
        available_qty:   row.available_qty,
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
    a.download = `shipment_complete_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows]);

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
              <h1 className="shipment-v2-title">출고완료 V2</h1>
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
                      {user.user_code} {user.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── 액션 바: 왼쪽(년/월/쉽먼트 드롭다운) + 오른쪽(엑셀) ── */}
            <div className="shipment-v2-action-bar" style={{ justifyContent: 'space-between' }}>
              {/* ── 왼쪽: 년/월/쉽먼트번호 필터 드롭다운 ── */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {/* 년 */}
                <select
                  className="sc-v2-filter-dropdown"
                  value={selectedYear}
                  onChange={handleYearChange}
                  disabled={!selectedUserId}
                >
                  <option value="">년도</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{y}년</option>
                  ))}
                </select>
                {/* 월 */}
                <select
                  className="sc-v2-filter-dropdown"
                  value={selectedMonth}
                  onChange={handleMonthChange}
                  disabled={!selectedYear}
                >
                  <option value="">월</option>
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>{parseInt(m, 10)}월</option>
                  ))}
                </select>
                {/* 쉽먼트번호 */}
                <select
                  className="sc-v2-filter-dropdown sc-v2-filter-dropdown--wide"
                  value={selectedShipmentId}
                  onChange={handleShipmentChange}
                  disabled={!selectedMonth}
                >
                  <option value="">쉽먼트 선택</option>
                  {shipmentOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.shipment_no} ({s.date})
                    </option>
                  ))}
                </select>
              </div>

              {/* ── 오른쪽: 버튼들 ── */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {isConfirmed ? (
                  <button
                    className="shipment-v2-excel-btn"
                    style={{ background: '#ef4444' }}
                    onClick={handleUnconfirm}
                    disabled={confirmLoading}
                  >
                    {confirmLoading ? '처리중...' : '확정 취소'}
                  </button>
                ) : (
                  <button
                    className="shipment-v2-excel-btn"
                    style={{ background: '#2563eb' }}
                    onClick={handleConfirm}
                    disabled={rows.length === 0 || confirmLoading}
                  >
                    {confirmLoading ? '처리중...' : '확정'}
                  </button>
                )}
                <button
                  className="shipment-v2-excel-btn"
                  onClick={handleExcelDownload}
                  disabled={rows.length === 0}
                >
                  엑셀
                </button>
              </div>
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
                    <th style={{ textAlign: 'center' }}>출고개수</th>
                    <th style={{ textAlign: 'center' }}>전체</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={TOTAL_COLS} className="shipment-v2-empty">로딩 중...</td></tr>
                  ) : !selectedUserId ? (
                    <tr><td colSpan={TOTAL_COLS} className="shipment-v2-empty">사용자를 선택해주세요.</td></tr>
                  ) : !selectedShipmentId ? (
                    <tr><td colSpan={TOTAL_COLS} className="shipment-v2-empty">쉽먼트를 선택해주세요.</td></tr>
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

                      return (
                        <tr
                          key={`${row.id}-${idx}`}
                          className={isChecked ? 'shipment-v2-row--checked' : ''}
                        >
                          {/* ── 박스번호: rowSpan 병합, 합배송 시 계층 표시 ── */}
                          {span !== undefined && (
                            <td rowSpan={span} style={{ textAlign: 'center' }}>
                              <span
                                className={`shipment-v2-badge ${row.master_box_code ? 'shipment-v2-badge--gray' : badgeClass}`}
                                style={{ cursor: 'pointer' }}
                                onClick={() => handlePackageClick(row.box_code)}
                              >
                                {row.box_code}
                              </span>
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

                          {/* ── 품목 ── */}
                          <td className="shipment-v2-qty">{row.customs_category || '-'}</td>

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

                          {/* ── 출고개수 ── */}
                          <td className="shipment-v2-qty">{row.quantity}</td>

                          {/* ── 전체 ── */}
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
    </div>
  );
};

export default ShipmentCompleteV2;
