'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStorage } from '../hooks/StorageContext';
import StockTable, { stockKey } from '../components/StockTable';
import StockDetailModal from '../components/StockDetailModal';
import StockMoveModal from '../components/StockMoveModal';
import StockAdjustModal from '../components/StockAdjustModal';
import PickToShipmentModal from '../components/PickToShipmentModal';
import type { StockRow } from '../types';
import './Stock.css';

// ============================================================
// [재고] — 위치별 재고 → 쉽먼트 / 위치 이동
//
//   · 검색: 상품명 · 옵션 · 중국어옵션 · 바코드 · 주문번호 · 위치
//   · 체크 → [쉽먼트] (여러 칸·여러 상품 가능) / [위치 이동] · [수량 수정] (1칸만)
//   · 행 클릭 → 상세(원장 타임라인)
//   모달에는 열 때의 행을 넘긴다 — 저장 후 재조회로 목록이 바뀌어도 모달 내용은 유지
// ============================================================
const Stock: React.FC = () => {
  const { t } = useTranslation();
  const { userId, stock, requests, reloadAll } = useStorage();

  const [search, setSearch] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [detailRow, setDetailRow] = useState<StockRow | null>(null);
  const [moveRow, setMoveRow] = useState<StockRow | null>(null);
  const [adjustRow, setAdjustRow] = useState<StockRow | null>(null);
  const [pickRows, setPickRows] = useState<StockRow[] | null>(null);

  // ── 사용자가 바뀌면 체크 해제 ──
  useEffect(() => { setChecked(new Set()); }, [userId]);

  // ── 재조회 뒤 사라진 칸의 체크는 정리 ──
  useEffect(() => {
    const keys = new Set(stock.rows.filter((r) => r.qty > 0).map(stockKey));
    setChecked((prev) => {
      const next = new Set(Array.from(prev).filter((k) => keys.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [stock.rows]);

  // ── 검색 ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stock.rows;
    return stock.rows.filter((r) =>
      [r.location_code, r.product_no, r.item_no, r.item_name, r.option_name, r.china_option1, r.china_option2, r.barcode]
        .some((v) => v?.toLowerCase().includes(q))
    );
  }, [stock.rows, search]);

  const checkedRows = useMemo(
    () => stock.rows.filter((r) => checked.has(stockKey(r))),
    [stock.rows, checked]
  );

  // ============================================================
  // 체크
  // ============================================================
  const toggle = useCallback((key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback((on: boolean) => {
    setChecked(on ? new Set(filtered.filter((r) => r.qty > 0).map(stockKey)) : new Set());
  }, [filtered]);

  // ── 모달 닫힘 ──
  const handlePickClose = useCallback((changed: boolean) => {
    setPickRows(null);
    if (changed) setChecked(new Set());
  }, []);

  const handleMoveClose = useCallback((moved: boolean) => {
    setMoveRow(null);
    if (moved) {
      setChecked(new Set());
      reloadAll();
    }
  }, [reloadAll]);

  const handleAdjustClose = useCallback((changed: boolean) => {
    setAdjustRow(null);
    if (changed) {
      setChecked(new Set());
      reloadAll();
    }
  }, [reloadAll]);

  // ============================================================
  // 렌더
  // ============================================================
  if (!userId) return <div className="storage-empty">{t('storage.needUser')}</div>;

  return (
    <section className="storage-stock">
      <div className="storage-toolbar">
        <input
          className="storage-search"
          value={search}
          placeholder={t('storage.searchPlaceholderStock')}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="storage-toolbar-actions">
          <span className="storage-hint">{t('storage.stock.checked', { count: checkedRows.length })}</span>
          <button
            type="button"
            className="storage-btn"
            onClick={() => setAdjustRow(checkedRows[0])}
            disabled={checkedRows.length !== 1}
            title={t('storage.stock.moveHint')}
          >
            {t('storage.stock.adjust')}
          </button>
          <button
            type="button"
            className="storage-btn"
            onClick={() => setMoveRow(checkedRows[0])}
            disabled={checkedRows.length !== 1}
            title={t('storage.stock.moveHint')}
          >
            {t('storage.stock.move')}
          </button>
          <button
            type="button"
            className="storage-btn storage-btn--primary"
            onClick={() => setPickRows(checkedRows)}
            disabled={checkedRows.length === 0}
          >
            {t('storage.stock.toShipment')}
          </button>
        </div>
      </div>

      {stock.loadError ? (
        <div className="storage-empty is-error">{t('storage.loadError')}</div>
      ) : stock.loading && stock.rows.length === 0 ? (
        <div className="storage-empty">{t('storage.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="storage-empty">{t('storage.stock.empty')}</div>
      ) : (
        <StockTable
          rows={filtered}
          requests={requests}
          checked={checked}
          onToggle={toggle}
          onToggleAll={toggleAll}
          onOpenDetail={setDetailRow}
        />
      )}

      {detailRow && <StockDetailModal row={detailRow} onClose={() => setDetailRow(null)} />}
      {moveRow && <StockMoveModal row={moveRow} onClose={handleMoveClose} />}
      {adjustRow && <StockAdjustModal row={adjustRow} onClose={handleAdjustClose} />}
      {pickRows && <PickToShipmentModal rows={pickRows} requests={requests} onClose={handlePickClose} />}
    </section>
  );
};

export default Stock;
