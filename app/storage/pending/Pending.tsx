'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStorage } from '../hooks/StorageContext';
import ScanBar from '../components/ScanBar';
import PendingTable from '../components/PendingTable';
import PutawayModal from '../components/PutawayModal';
import { normalizeProductNo, playErrorSound } from '../utils/storageFormat';
import './Pending.css';

// ============================================================
// [작업중] — 보관 상품 입고분을 위치에 배치
//
//   상단 스캔창에 주문번호 라벨 스캔 → product_no 정규화 → 그 상품의 배치 모달
//     · 작업중에 없으면 오류음 + 안내 (이미 재고에 있으면 "배치 완료" 로 구분)
//   표의 [배치] 버튼도 같은 모달
//   모달이 닫히면 스캔창으로 포커스를 돌려 다음 라벨을 바로 스캔
// ============================================================
const Pending: React.FC = () => {
  const { t } = useTranslation();
  const { userId, pending, stock } = useStorage();
  const scanRef = useRef<HTMLInputElement>(null);

  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [search, setSearch] = useState('');

  // ============================================================
  // 스캔
  // ============================================================
  const handleScan = useCallback((value: string) => {
    const code = normalizeProductNo(value);
    const hit = pending.rows.find((r) => r.product_no === code);
    if (hit) {
      setScanMessage(null);
      setActiveProductId(hit.product_id);
      return;
    }
    playErrorSound();
    const stocked = stock.rows.some((r) => r.product_no === code && r.qty > 0);
    setScanMessage({
      kind: 'error',
      text: stocked ? t('storage.scan.alreadyPlaced', { code }) : t('storage.scan.notFound', { code }),
    });
  }, [pending.rows, stock.rows, t]);

  const handleModalClose = useCallback((allPlaced: boolean) => {
    setActiveProductId(null);
    if (allPlaced) setScanMessage({ kind: 'ok', text: t('storage.scan.done') });
    // 모달 언마운트 뒤 포커스 (같은 tick 에서는 모달 입력창이 아직 잡고 있다)
    setTimeout(() => scanRef.current?.focus(), 0);
  }, [t]);

  // ── 검색 (상품명 · 옵션 · 주문번호 · 바코드) ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pending.rows;
    return pending.rows.filter((r) =>
      [r.product_no, r.item_name, r.option_name, r.china_option1, r.china_option2, r.barcode]
        .some((v) => v?.toLowerCase().includes(q))
    );
  }, [pending.rows, search]);

  // ============================================================
  // 렌더
  // ============================================================
  if (!userId) return <div className="storage-empty">{t('storage.needUser')}</div>;

  return (
    <section className="storage-pending">
      <div className="storage-toolbar">
        <ScanBar ref={scanRef} placeholder={t('storage.scan.placeholder')} onScan={handleScan} disabled={!!activeProductId} />
        <input
          className="storage-search"
          value={search}
          placeholder={t('storage.searchPlaceholder')}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {scanMessage && <div className={`storage-message is-${scanMessage.kind}`}>{scanMessage.text}</div>}

      {pending.loadError ? (
        <div className="storage-empty is-error">{t('storage.loadError')}</div>
      ) : pending.loading && pending.rows.length === 0 ? (
        <div className="storage-empty">{t('storage.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="storage-empty">{t('storage.pending.empty')}</div>
      ) : (
        <PendingTable rows={filtered} onPlace={setActiveProductId} />
      )}

      {activeProductId && <PutawayModal productId={activeProductId} onClose={handleModalClose} />}
    </section>
  );
};

export default Pending;
