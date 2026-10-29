'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import ExcelJS from 'exceljs';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import { useFtUsers } from '../import-product-v2/hooks/useFtData';
import BoxLabelPrintModal from './components/BoxLabelPrintModal';
import ManualItemModal from './components/ManualItemModal';
import MergeModal from './components/MergeModal';
import MoveModal from './components/MoveModal';
import type { CompletedRequest } from './components/MoveRequestButton';
import ShipModal from './components/ShipModal';
import ShipmentTable from './components/ShipmentTable';
import SummaryFilterBar from './components/SummaryFilterBar';
import TypeBoardCards from './components/TypeBoardCards';
import { useShipmentRows } from './hooks/useShipmentRows';
import { useWorkers, workerLabel } from './hooks/useWorkers';
import type { ShipmentV2Row } from './types';
import { summarizeBoard } from './utils/boardSummary';
import {
  BOARD_ALL,
  FILTER_ALL,
  matchesBoard,
  matchesFilter,
  type BoardFilter,
  type RowFilter,
} from './utils/rowFilter';
import { getShipmentError } from './utils/shipmentCodes';
import './ShipmentV2.css';

// ============================================================
// 쉽먼트 V2 — 미출고 포장 행 관리
//
//   [헤더]   제목 · 총 건수 · 처리 담당자 · 사용자
//   [카드]   전체 / A / B / C / P / X / 요청          components/TypeBoardCards
//   [액션]   품목 · 엑셀 · 이동 · 합배송 · 생성 · 박스라벨 | 저장 · 출고
//   [칩]     품목별 · 쉽먼트에러                         components/SummaryFilterBar
//   [표]                                                 components/ShipmentTable
//
//   필터는 카드(보드) AND 칩. 편집은 원본 rows 인덱스 기준, 체크는 행 id(포장 행 id) 기준 —
//   재조회(품목 분류·저장) 뒤에도 같은 행이 체크된 채로 남고, 사라진 행은 빠진다.
//   필터로 숨겨진 행도 체크에서 빠진다 (숨은 행이 이동·출고되지 않도록).
// ============================================================

type ModalKind = 'move' | 'merge' | 'ship' | 'manual' | 'boxLabel' | null;

const ShipmentV2: React.FC = () => {
  const { t } = useTranslation();
  const { users: ftUsers } = useFtUsers();
  const workers = useWorkers();
  const { rows, setRows, loading, loadError, fetchRows } = useShipmentRows();

  // ============================================================
  // 상태
  // ============================================================
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedWorker, setSelectedWorker] = useState('');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [board, setBoard] = useState<BoardFilter>(BOARD_ALL);
  const [filter, setFilter] = useState<RowFilter>(FILTER_ALL);
  const [modal, setModal] = useState<ModalKind>(null);
  const [isClassifying, setIsClassifying] = useState(false);

  // ── 배치 저장: 변경된 품목 추적 (order_item_id → new value) ──
  const [dirtyCategories, setDirtyCategories] = useState<Map<string, string | null>>(new Map());

  // ── 이번 화면에서 처리완료한 이동요청 (행 id → 타입) — 재조회 후에도 녹색 유지 ──
  const [completedRequests, setCompletedRequests] = useState<Map<string, CompletedRequest>>(new Map());

  const selectedUser = useMemo(() => ftUsers.find((u) => u.id === selectedUserId), [ftUsers, selectedUserId]);
  /** 새 박스 코드 접두어 (상품출고 V2 와 동일하게 대문자) */
  const selectedUserCode = (selectedUser?.user_code || '').toUpperCase();

  // ============================================================
  // 사용자 변경
  // ============================================================
  const handleUserChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const userId = e.target.value;
    setSelectedUserId(userId);
    setCheckedIds(new Set());
    setBoard(BOARD_ALL);
    setFilter(FILTER_ALL);
    setCompletedRequests(new Map());
    fetchRows(userId);
  };

  const refetch = useCallback(() => fetchRows(selectedUserId), [fetchRows, selectedUserId]);

  // ============================================================
  // 파생값 — 쉽먼트 에러 / 카드 집계 / 보이는 행
  // ============================================================
  const rowErrors = useMemo(() => rows.map(getShipmentError), [rows]);
  const boardSummary = useMemo(() => summarizeBoard(rows), [rows]);

  /** 카드 필터만 적용된 원본 인덱스 — 칩 개수의 모수 */
  const boardIndices = useMemo(
    () => rows.reduce<number[]>((acc, row, idx) => {
      if (matchesBoard(row, board)) acc.push(idx);
      return acc;
    }, []),
    [rows, board]
  );
  const boardRows = useMemo(() => boardIndices.map((i) => rows[i]), [boardIndices, rows]);
  const boardRowErrors = useMemo(() => boardIndices.map((i) => rowErrors[i]), [boardIndices, rowErrors]);

  /** 카드 AND 칩 */
  const visibleIndices = useMemo(
    () => boardIndices.filter((i) => matchesFilter(rows[i], rowErrors[i], filter)),
    [boardIndices, rows, rowErrors, filter]
  );

  // ── 화면에서 사라진 행은 체크 해제 (필터로 숨김 · 재조회로 없어짐) ──
  useEffect(() => {
    const visible = new Set(visibleIndices.map((i) => rows[i].id));
    setCheckedIds((prev) => {
      const next = new Set(Array.from(prev).filter((key) => visible.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIndices, rows]);

  const selectedRows = useMemo(
    () => rows.filter((r) => checkedIds.has(r.id)),
    [rows, checkedIds]
  );

  // ============================================================
  // 체크박스
  // ============================================================
  const toggleCheck = useCallback((rowId: string) => {
    const key = rowId;
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggleAll = () => {
    const allChecked = visibleIndices.length > 0 && visibleIndices.every((i) => checkedIds.has(rows[i].id));
    setCheckedIds(allChecked ? new Set() : new Set(visibleIndices.map((i) => rows[i].id)));
  };

  // ── 박스번호 배지 클릭 → 해당 box_code 중 보이는 행 전체 토글 ──
  const handlePackageClick = useCallback((boxCode: string) => {
    const ids = visibleIndices.filter((i) => rows[i].box_code === boxCode).map((i) => rows[i].id);
    setCheckedIds((prev) => {
      const allChecked = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of ids) {
        if (allChecked) next.delete(id); else next.add(id);
      }
      return next;
    });
  }, [visibleIndices, rows]);

  // ============================================================
  // 행 로컬 패치 (스캔 수량 · 품목 · 박스 사이즈 · 이동요청 처리완료)
  // ============================================================

  /** 화면에 있는 한글 → 영문 품목 매핑 (편집 직후 표시용, 저장 후 재조회 전까지) */
  const knownCategoryEn = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.customs_category && r.customs_category_en) map.set(r.customs_category.trim(), r.customs_category_en);
    }
    return map;
  }, [rows]);

  const handleQuantityChange = useCallback((idx: number, quantity: number) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, quantity } : r)));
  }, [setRows]);

  const handleCategoryChange = useCallback((idx: number, category: string | null) => {
    const row = rows[idx];
    if (!row?.order_item_id) return; // 부자재 행은 주문 항목이 없어 저장 대상 아님
    const orderItemId = row.order_item_id;
    const en = category ? (knownCategoryEn.get(category) ?? null) : null;
    // 같은 주문 항목의 다른 포장 행도 같은 품목이므로 함께 갱신
    setRows((prev) => prev.map((r) =>
      r.order_item_id === orderItemId ? { ...r, customs_category: category, customs_category_en: en } : r
    ));
    setDirtyCategories((prev) => new Map(prev).set(orderItemId, category));
  }, [rows, knownCategoryEn, setRows]);

  const handleBoxSizeSaved = useCallback((boxInfoId: string, size: string | null) => {
    setRows((prev) => prev.map((r) => (r.box_info_id === boxInfoId ? { ...r, box_size: size } : r)));
  }, [setRows]);

  const handleRequestCompleted = useCallback((rowId: string, _requestId: string, targetType: string) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, move_request: null } : r)));
    setCompletedRequests((prev) => new Map(prev).set(rowId, { target_type: targetType }));
  }, [setRows]);

  // ============================================================
  // 품목 일괄 저장 ([저장] 버튼)
  // ============================================================
  const handleSaveAll = useCallback(async () => {
    if (dirtyCategories.size === 0) {
      alert(t('shipmentV2.alerts.noChanges'));
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
        // 영문 표시 갱신 (새 한글값의 영문은 서버 매핑에서)
        refetch();
      } else {
        alert('저장 실패: ' + (json.error || '알 수 없는 오류'));
      }
    } catch (err) {
      console.error('품목 일괄 저장 오류:', err);
      alert('저장 중 오류가 발생했습니다.');
    }
  }, [dirtyCategories, refetch, t]);

  // ============================================================
  // 엑셀 다운로드
  // ============================================================
  const handleExcelDownload = useCallback(async () => {
    if (rows.length === 0) return;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('쉽먼트');

    worksheet.columns = [
      { header: '박스위치',   key: 'box_code',            width: 14 },
      { header: '박스사이즈', key: 'box_size',            width: 12 },
      { header: '주문번호',   key: 'product_no',          width: 16 },
      { header: '바코드',     key: 'barcode',             width: 18 },
      { header: '상품명',     key: 'item_name',           width: 30 },
      { header: '옵션명',     key: 'option_name',         width: 25 },
      { header: '단가',       key: 'price_cny',           width: 10 },
      { header: '품목',       key: 'customs_category',    width: 20 },
      { header: '품목(영문)', key: 'customs_category_en', width: 20 },
      { header: '출고개수',   key: 'quantity',            width: 10 },
      { header: '입고개수',   key: 'available_qty',       width: 10 },
      { header: '확인사항',   key: 'note',                width: 15 },
      { header: '이미지',     key: 'img_url',             width: 30 },
      { header: '혼용률',     key: 'composition',         width: 20 },
    ];

    for (const row of rows) {
      worksheet.addRow({
        box_code:            row.box_code || '',
        box_size:            row.box_size || '',
        product_no:          row.product_no || '',
        barcode:             row.barcode || '',
        item_name:           row.item_name || '',
        option_name:         row.option_name || '',
        price_cny:           row.price_cny ?? '',
        customs_category:    row.customs_category || '',
        customs_category_en: row.customs_category_en || '',
        quantity:            row.quantity,
        available_qty:       row.available_qty,
        note:                row.manual_item_id ? 'MANUAL' : '',
        img_url:             row.img_url || '',
        composition:         row.composition || '',
      });
    }

    // 헤더 스타일
    worksheet.getRow(1).eachCell((cell) => {
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
  // 품목 분류 (Gemini AI) — 주문 항목 행만 (부자재는 ft_order_items 가 아니므로 제외)
  // ============================================================
  const handleClassifyProducts = useCallback(async () => {
    if (rows.length === 0) {
      alert('분류할 데이터가 없습니다.');
      return;
    }

    const uniqueNames = [
      ...new Set(
        rows
          .filter((r) => r.order_item_id && !r.customs_category && r.item_name)
          .map((r) => r.item_name!)
      ),
    ];

    if (uniqueNames.length === 0) {
      alert(t('shipmentV2.alerts.noClassify'));
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
      refetch();
    } catch (error) {
      console.error('품목 분류 오류:', error);
      alert(error instanceof Error ? error.message : '품목 분류 중 오류가 발생했습니다.');
    } finally {
      setIsClassifying(false);
    }
  }, [rows, refetch, t]);

  // ============================================================
  // 모달 열기 / 완료 처리
  // ============================================================
  const openMove = () => {
    if (checkedIds.size === 0) { alert(t('shipmentV2.alerts.selectMove')); return; }
    setModal('move');
  };
  const openShip = () => {
    if (checkedIds.size === 0) { alert('출고할 항목을 선택해주세요.'); return; }
    setModal('ship');
  };

  /** 이동·합배송·출고·생성 후 — 분할로 행 id 가 바뀌므로 체크 해제 + 재조회 */
  const closeAndRefetch = () => {
    setModal(null);
    setCheckedIds(new Set());
    refetch();
  };

  const handleManualCreated = (boxCode: string, itemName: string) => {
    alert(t('shipmentV2.manual.created', { box: boxCode, name: itemName }));
    closeAndRefetch();
  };

  // ── 박스라벨 출력 대상: 체크 있으면 체크 행, 없으면 보이는 행 ──
  const labelTargetRows = useMemo(
    () => (checkedIds.size > 0 ? selectedRows : visibleIndices.map((i) => rows[i])),
    [checkedIds, selectedRows, visibleIndices, rows]
  );

  // ============================================================
  // 렌더
  // ============================================================
  const hasUser = !!selectedUserId;

  return (
    <div className="shipment-v2-layout">
      <TopsideMenu />
      <div className="shipment-v2-main-content">
        <LeftsideMenu />
        <main className="shipment-v2-content">
          <div className="sv2-page">

            {/* ── 헤더: 제목 / 담당자 · 사용자 ── */}
            <header className="sv2-header">
              <div className="sv2-header-title">
                <h1>{t('shipmentV2.title')}</h1>
                <p>{t('shipmentV2.subtitle')}</p>
              </div>
              <div className="sv2-header-controls">
                {rows.length > 0 && (
                  <span className="sv2-total">{t('shipmentV2.totalCount', { count: rows.length })}</span>
                )}
                <select
                  className={`sv2-select ${selectedWorker ? '' : 'is-placeholder'}`}
                  value={selectedWorker}
                  onChange={(e) => setSelectedWorker(e.target.value)}
                  aria-label={t('shipmentV2.worker.placeholder')}
                >
                  <option value="">{t('shipmentV2.worker.placeholder')}</option>
                  {workers.map((w) => (
                    <option key={w.id} value={workerLabel(w)}>{workerLabel(w)}</option>
                  ))}
                </select>
                <select
                  className="sv2-select sv2-select--user"
                  value={selectedUserId}
                  onChange={handleUserChange}
                  aria-label={t('shipmentV2.selectUser')}
                >
                  <option value="">{t('shipmentV2.selectUser')}</option>
                  {ftUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.vender_name || user.full_name} {user.user_code}
                    </option>
                  ))}
                </select>
              </div>
            </header>

            {/* ── 타입 카드 보드 ── */}
            {hasUser && (
              <TypeBoardCards summary={boardSummary} board={board} onBoardChange={setBoard} />
            )}

            {/* ── 액션 바 ── */}
            <div className="sv2-toolbar">
              <div className="sv2-toolbar-group">
                <button className="sv2-btn" onClick={handleClassifyProducts} disabled={isClassifying || rows.length === 0}>
                  {isClassifying ? t('shipmentV2.buttons.classifying') : t('shipmentV2.buttons.classify')}
                </button>
                <button className="sv2-btn" onClick={handleExcelDownload} disabled={rows.length === 0}>
                  {t('shipmentV2.buttons.excel')}
                </button>
                <span className="sv2-toolbar-divider" aria-hidden="true" />
                <button className="sv2-btn" onClick={openMove} disabled={checkedIds.size === 0}>
                  {t('shipmentV2.buttons.move')}{checkedIds.size > 0 ? ` (${checkedIds.size})` : ''}
                </button>
                <button className="sv2-btn" onClick={() => setModal('merge')} disabled={!hasUser}>
                  {t('shipmentV2.buttons.merge')}
                </button>
                <span className="sv2-toolbar-divider" aria-hidden="true" />
                <button className="sv2-btn" onClick={() => setModal('manual')} disabled={!hasUser}>
                  + {t('shipmentV2.buttons.create')}
                </button>
                <button className="sv2-btn" onClick={() => setModal('boxLabel')} disabled={rows.length === 0}>
                  {t('shipmentV2.buttons.boxLabel')}
                </button>
              </div>
              <div className="sv2-toolbar-group">
                <button
                  className={`sv2-btn ${dirtyCategories.size > 0 ? 'sv2-btn--success' : ''}`}
                  onClick={handleSaveAll}
                  disabled={dirtyCategories.size === 0}
                >
                  {t('shipmentV2.buttons.save')}{dirtyCategories.size > 0 ? ` (${dirtyCategories.size})` : ''}
                </button>
                <button className="sv2-btn sv2-btn--danger" onClick={openShip} disabled={checkedIds.size === 0}>
                  {t('shipmentV2.buttons.ship')}{checkedIds.size > 0 ? ` (${checkedIds.size})` : ''}
                </button>
              </div>
            </div>

            {/* ── 칩 필터: 품목 / 쉽먼트에러 (카드 필터 적용된 행 기준) ── */}
            {rows.length > 0 && (
              <SummaryFilterBar
                rows={boardRows}
                rowErrors={boardRowErrors}
                filter={filter}
                onFilterChange={setFilter}
              />
            )}

            {/* ── 표 ── */}
            <ShipmentTable
              rows={rows}
              visibleIndices={visibleIndices}
              rowErrors={rowErrors}
              checkedIds={checkedIds}
              completedRequests={completedRequests}
              doneBy={selectedWorker}
              loading={loading}
              loadError={loadError}
              hasUser={hasUser}
              onToggleCheck={toggleCheck}
              onToggleAll={toggleAll}
              onPackageClick={handlePackageClick}
              onQuantityChange={handleQuantityChange}
              onCategoryChange={handleCategoryChange}
              onBoxSizeSaved={handleBoxSizeSaved}
              onRequestCompleted={handleRequestCompleted}
            />
          </div>
        </main>
      </div>

      {/* ============================================================ */}
      {/* 모달                                                          */}
      {/* ============================================================ */}
      {modal === 'move' && selectedRows.length > 0 && (
        <MoveModal
          userId={selectedUserId}
          userCode={selectedUserCode}
          rows={selectedRows}
          onClose={() => setModal(null)}
          onMoved={closeAndRefetch}
        />
      )}
      {modal === 'merge' && (
        <MergeModal userId={selectedUserId} onClose={() => setModal(null)} onMerged={closeAndRefetch} />
      )}
      {modal === 'ship' && selectedRows.length > 0 && (
        <ShipModal
          userId={selectedUserId}
          userCode={selectedUser?.user_code || ''}
          rows={selectedRows}
          onClose={() => setModal(null)}
          onShipped={closeAndRefetch}
        />
      )}
      {modal === 'manual' && (
        <ManualItemModal
          userId={selectedUserId}
          userCode={selectedUserCode}
          operatorName={selectedWorker}
          onClose={() => setModal(null)}
          onCreated={handleManualCreated}
        />
      )}
      {modal === 'boxLabel' && (
        <BoxLabelPrintModal
          allRows={rows}
          targetRows={labelTargetRows}
          fromChecked={checkedIds.size > 0}
          userCode={selectedUserCode}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
};

export default ShipmentV2;
