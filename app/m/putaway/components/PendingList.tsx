'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { joinOptions } from '../../../storage/utils/storageFormat';
import type { PendingProduct } from '../types';
import { totalUnplaced } from '../utils/pendingProducts';
import ProductThumb from './ProductThumb';

// ============================================================
// PendingList — 목록 화면 (배치를 기다리는 상품)
//
//   담당자 줄 → [주문번호 라벨 스캔] → [입력 칸 + 확인] → 안내 한 줄 → 상품 목록
//   · [스캔] 은 카메라로 주문번호 라벨을 읽는다
//   · 입력 칸은 치는 대로 아래 목록을 거른다 (주문번호 · 상품명 · 옵션 · 바코드).
//     주문번호를 넣고 Enter · [확인] 을 누르면 그 상품의 배치 화면으로 간다 (바코드 리더기도 같은 길)
//   · 줄을 누르면 그 상품의 배치 화면으로 간다
//   무엇을 열지는 부르는 쪽(Putaway)이 정한다 — 여기는 그리기만 한다
// ============================================================

interface PendingListProps {
  operatorName: string;
  /** null = 아직 받지 못함 */
  products: PendingProduct[] | null;
  /** 거른 뒤 화면에 보일 상품 */
  visible: PendingProduct[];
  refreshing: boolean;
  /** 처음 목록을 받지 못함 (가지고 있던 목록이 없다) */
  loadFailed: boolean;
  input: string;
  inputRef: React.RefObject<HTMLInputElement>;
  /** 여러 사업자의 상품이 섞여 있으면 줄마다 사업자를 보여 준다 */
  showUser: boolean;
  userCodeOf: (userId: string) => string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onOpenCamera: () => void;
  onPick: (product: PendingProduct) => void;
  onRefresh: () => void;
  onClearInput: () => void;
  onChangeWorker: () => void;
}

const PendingList: React.FC<PendingListProps> = ({
  operatorName, products, visible, refreshing, loadFailed, input, inputRef, showUser, userCodeOf,
  onInputChange, onSubmit, onOpenCamera, onPick, onRefresh, onClearInput, onChangeWorker,
}) => {
  const { t } = useTranslation();
  const searchText = input.trim();

  // ── 목록이 비었을 때의 안내 ──
  const emptyText =
    products === null ? (loadFailed ? t('storage.loadError') : t('storage.loading'))
    : products.length === 0 ? t('storage.pending.empty')
    : visible.length === 0 ? t('mobile.putaway.list.noMatch', { text: searchText })
    : null;

  return (
    <main className="mob-body">
      {/* 담당자 */}
      <div className="mob-worker-row">
        <span>{t('mobile.wow.worker.current')} <b>{operatorName}</b></span>
        <button type="button" className="mob-text-btn" onClick={onChangeWorker}>{t('mobile.wow.worker.change')}</button>
      </div>

      {/* 스캔 */}
      <button type="button" className="mob-btn accent" onClick={onOpenCamera}>
        <span aria-hidden="true">📷</span> {t('mobile.putaway.list.scan')}
      </button>

      {/* 입력 (바코드 리더기 · 직접 입력 · 검색) */}
      <div className="mob-scanrow">
        <input
          ref={inputRef}
          className="mob-input mob-code-input"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          enterKeyHint="go"
          value={input}
          placeholder={t('mobile.putaway.list.inputPlaceholder')}
          aria-label={t('mobile.putaway.list.inputLabel')}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            // 한글 · 중국어를 조합하는 중의 Enter 는 글자 확정이다 — 넘기지 않는다
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            onSubmit();
          }}
        />
        <button type="button" className="mob-btn secondary mput-go" onClick={onSubmit}>{t('mobile.putaway.list.go')}</button>
      </div>
      <div className="mob-hint">{t('mobile.putaway.list.hint')}</div>

      {/* 목록 머리 — 요약 · 새로고침 */}
      <div className="mob-list-head">
        <span className="mob-list-sum">
          {searchText ? (
            <span className="mob-filter-chip">
              {t('mobile.putaway.list.filtered', { count: visible.length })}
              <button type="button" onClick={onClearInput}>{t('storage.tabs.all')}</button>
            </span>
          ) : products ? (
            t('mobile.putaway.list.summary', { products: products.length, qty: totalUnplaced(products) })
          ) : null}
          {refreshing && <span className="mob-busy">{t('mobile.wow.list.refreshing')}</span>}
        </span>
        <span className="mob-list-tools">
          <button
            type="button"
            className="mob-icon-btn"
            disabled={refreshing}
            onClick={onRefresh}
            aria-label={t('storage.refresh')}
            title={t('storage.refresh')}
          >
            ↻
          </button>
        </span>
      </div>

      {/* 상품 목록 */}
      <div className="mob-list">
        {emptyText && <div className="mob-empty">{emptyText}</div>}
        {visible.map((p) => {
          const { head } = p;
          const options = joinOptions(head.option_name, head.china_option1, head.china_option2);
          const isSet = (head.set_total ?? 0) > 1;
          return (
            <button key={p.product_id} type="button" className="mput-row" onClick={() => onPick(p)}>
              <ProductThumb url={head.img_url} />
              <span className="mput-row-body">
                <span className="mput-row-no">
                  {head.product_no ?? '-'}
                  {showUser && <span className="mob-chip">{userCodeOf(p.user_id)}</span>}
                  {isSet && <span className="mob-chip">SET {head.set_total}</span>}
                </span>
                <span className="mput-row-name">{head.item_name ?? '-'}</span>
                {options && <span className="mput-row-opt">{options}</span>}
              </span>
              <span className="mput-row-qty">
                <b>{p.unplaced}</b>
                <small>{t('storage.col.unplaced')}</small>
              </span>
            </button>
          );
        })}
      </div>
    </main>
  );
};

export default PendingList;
