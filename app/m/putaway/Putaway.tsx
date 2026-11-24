'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useFtUsers } from '../../import-product-v2/hooks/useFtData';
import { useWorkers } from '../../shipment-v2/hooks/useWorkers';
import { playErrorSound } from '../../storage/utils/storageFormat';
import BarcodeCamera from '../components/BarcodeCamera';
import WorkerSelect from '../components/WorkerSelect';
import { useCamLabels } from '../hooks/useCamLabels';
import { useRememberedWorker } from '../hooks/useRememberedWorker';
import { useToast } from '../hooks/useToast';
import { playOkSound } from '../utils/sound';
import { usePendingProducts } from './hooks/usePendingProducts';
import type { PendingProduct, ScanRequest } from './types';
import {
  findByLabel, hasMixedUsers, isLabelShaped, labelCode, onePerUser, searchProducts,
} from './utils/pendingProducts';
import PendingList from './components/PendingList';
import PlaceScreen from './components/PlaceScreen';
import UserChooseSheet from './components/UserChooseSheet';
import '../Mobile.css';
import './Putaway.css';

// ============================================================
// /m/putaway — 재고 배치 (모바일)
//   PC 의 재고 › [작업중] (app/storage/pending) 을 폰으로 옮긴 화면. 서버는 PC 와 같은 API 를 쓴다
//     GET /api/ft/storage/pending · GET /api/ft/storage/suggest · POST /api/ft/storage/putaway
//
//   담당자 선택 → 목록(주문번호 라벨 스캔 · 입력 · 검색) → 배치(위치 · 수량) → 목록
//
//   화면은 주소를 바꾸지 않고 상태로 바꾼다.
//     · 담당자가 없거나 [변경] 을 눌렀으면  → 담당자 선택 (../components/WorkerSelect — 모바일 공용)
//     · 연 상품이 있으면                    → 배치       (components/PlaceScreen)
//     · 그 밖에는                           → 목록       (components/PendingList)
//   이 파일은 화면 전환 · 목록에서 상품 고르기 · 카메라만 맡는다. 배치는 PlaceScreen 이 맡는다.
//
//   주문번호 라벨을 읽으면 (카메라 · 바코드 리더기 · 직접 입력 모두 같은 길)
//     · 목록에 있으면 그 상품의 배치 화면으로
//     · 여러 사업자에 같은 주문번호가 있으면 사업자를 고르는 창 (components/UserChooseSheet)
//     · 없으면 목록을 새로 받아 한 번 더 찾고, 그래도 없으면 경고음 + 안내
// ============================================================

type View = 'wait' | 'worker' | 'list' | 'place';

/** 같은 주문번호가 여러 사업자에 있어 고르기를 기다리는 중 */
interface UserChoice {
  code: string;
  products: PendingProduct[];
}

export default function Putaway() {
  const { t } = useTranslation();
  const { language, changeLanguage } = useLanguage();
  const workers = useWorkers();
  const { operatorName, ready, choose } = useRememberedWorker(workers);
  const { users } = useFtUsers();
  const { products, refreshing, reload, patchUnplaced } = usePendingProducts();
  const { toastText, notify } = useToast();

  const [changingWorker, setChangingWorker] = useState(false);
  /** 배치 화면을 연 상품 (열 때의 값 — 화면에는 아래 openProduct 를 쓴다) */
  const [open, setOpen] = useState<PendingProduct | null>(null);
  const [input, setInput] = useState('');
  const [choice, setChoice] = useState<UserChoice | null>(null);
  const [scan, setScan] = useState<ScanRequest | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  /** 기다리는 동안(목록 새로 받기 · 카메라)에도 지금 값을 보기 위한 값 */
  const productsRef = useRef(products);
  productsRef.current = products;
  const scanRef = useRef(scan);
  scanRef.current = scan;

  const view: View =
    !ready ? 'wait'
    : !operatorName || changingWorker ? 'worker'
    : open ? 'place'
    : 'list';

  // ============================================================
  // 목록
  // ============================================================

  // ── 새로 받기 — 가지고 있던 목록이 있으면 실패를 안내로만 알리고 목록은 그대로 둔다 ──
  //   quiet = 실패해도 안내하지 않는다 (부른 쪽이 상황에 맞는 문구로 알린다)
  const refreshList = useCallback(async (quiet = false): Promise<PendingProduct[] | null> => {
    try {
      const data = await reload();
      setLoadFailed(false);
      return data;
    } catch (err) {
      console.error('배치 대기 목록 조회 오류:', err);
      if (!productsRef.current) setLoadFailed(true);
      else if (!quiet) notify(t('storage.loadError'));
      return null;
    }
  }, [reload, notify, t]);

  const reloadQuiet = useCallback(() => refreshList(true), [refreshList]);

  // ── 목록 화면에 들어올 때마다 새로 받는다 (배치 화면에서 돌아올 때 포함) ──
  useEffect(() => {
    if (view === 'list') refreshList();
  }, [view, refreshList]);

  // ── 검색 (입력 칸에 치는 대로 거른다) ──
  const visible = useMemo(() => (products ? searchProducts(products, input) : []), [products, input]);

  // ── 사업자 표시 — 여러 사업자의 상품이 섞여 있을 때만 쓴다 ──
  const mixedUsers = useMemo(() => !!products && hasMixedUsers(products), [products]);
  const userCodeOf = useCallback(
    (userId: string) => users.find((u) => u.id === userId)?.user_code ?? '?',
    [users]
  );

  // ============================================================
  // 상품 고르기
  // ============================================================
  const enterProduct = useCallback((product: PendingProduct) => {
    setInput('');
    setChoice(null);
    setOpen(product);
  }, []);

  // ── 입력 · 스캔 값 처리 ──
  const submitCode = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text) {
      notify(t('mobile.putaway.list.needInput'));
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      const code = labelCode(text);
      const shaped = isLabelShaped(text);
      let hits = findByLabel(productsRef.current ?? [], code);

      // 목록에 없는 주문번호 → 새로 받아 한 번 더 찾는다 (방금 입고된 상품)
      if (hits.length === 0 && shaped) {
        const fresh = await refreshList(true);
        if (!fresh) {
          playErrorSound();
          notify(t('storage.loadError'));
          return;
        }
        hits = findByLabel(fresh, code);
      }

      if (hits.length === 0) {
        // 주문번호 모양이 아닌데 걸러진 상품이 있다 = 검색어 → 자판만 내리고 목록에서 고르게 둔다
        if (!shaped && searchProducts(productsRef.current ?? [], text).length > 0) {
          inputRef.current?.blur();
          return;
        }
        playErrorSound();
        if (shaped) {
          // 다음 스캔 값이 이어 붙지 않게 입력 칸을 비운다
          setInput('');
          notify(t('mobile.putaway.list.notFound', { code }));
        } else {
          notify(t('mobile.putaway.list.noMatch', { text }));
        }
        return;
      }

      playOkSound();
      const perUser = onePerUser(hits);
      if (perUser.length === 1) {
        enterProduct(perUser[0]);
      } else {
        inputRef.current?.blur();
        setChoice({ code, products: perUser });
      }
    } finally {
      submittingRef.current = false;
    }
  }, [refreshList, enterProduct, notify, t]);

  // ── 배치 화면에서 돌아옴 ──
  const closePlace = useCallback((message?: string) => {
    setOpen(null);
    if (message) notify(message);
  }, [notify]);

  /** 배치 화면에 보여 줄 값 — 목록에 있으면 새로 받은 값, 없으면(방금 다 배치함) 열 때의 값 */
  const openProduct = useMemo(
    () => (open ? products?.find((p) => p.product_id === open.product_id) ?? open : null),
    [open, products]
  );

  // ============================================================
  // 카메라 — 한 개를 목록(주문번호 라벨)과 배치 화면(위치 라벨)이 같이 쓴다
  //   무엇을 받아들일지는 요청(ScanRequest)이 정한다
  // ============================================================

  // ── 주문번호 라벨 — 목록에 있는 주문번호이거나 주문번호 모양이면 받아들인다 ──
  const openLabelCamera = useCallback(() => {
    setScan({
      hint: t('mobile.putaway.list.camHint'),
      notMatched: t('mobile.putaway.list.camNotMatched'),
      onCode: (text) => {
        const known = findByLabel(productsRef.current ?? [], labelCode(text)).length > 0;
        if (!known && !isLabelShaped(text)) return false;
        submitCode(text);
        return true;
      },
    });
  }, [submitCode, t]);

  const handleCamCode = useCallback((text: string): boolean => {
    const request = scanRef.current;
    if (!request || !request.onCode(text)) return false;
    setScan(null);
    return true;
  }, []);

  const camLabels = useCamLabels(scan?.notMatched ?? '');

  // ============================================================
  // 화면
  // ============================================================
  return (
    <>
      {view === 'place' && openProduct ? (
        <PlaceScreen
          key={openProduct.product_id}
          product={openProduct}
          operatorName={operatorName}
          userCode={mixedUsers ? userCodeOf(openProduct.user_id) : null}
          onPlaced={(remaining) => patchUnplaced(openProduct.product_id, remaining)}
          onReload={reloadQuiet}
          onExit={closePlace}
          onScan={setScan}
          notify={notify}
        />
      ) : (
        <div className="mob-page">
          <header className="mob-head">
            <Link href="/m" className="mob-back">‹ {t('mobile.home')}</Link>
            <div className="mob-head-title">{t('menu.putawayWork')}</div>
            <div className="mob-head-right">
              <select className="mob-lang" value={language} onChange={(e) => changeLanguage(e.target.value)} aria-label="language">
                <option value="ko">한국어</option>
                <option value="zh">中文</option>
              </select>
            </div>
          </header>

          {view === 'worker' && (
            <WorkerSelect
              workers={workers}
              current={operatorName}
              onChoose={(name) => { choose(name); setChangingWorker(false); }}
            />
          )}

          {view === 'list' && (
            <PendingList
              operatorName={operatorName}
              products={products}
              visible={visible}
              refreshing={refreshing}
              loadFailed={loadFailed}
              input={input}
              inputRef={inputRef}
              showUser={mixedUsers}
              userCodeOf={userCodeOf}
              onInputChange={setInput}
              onSubmit={() => { submitCode(input); }}
              onOpenCamera={openLabelCamera}
              onPick={enterProduct}
              onRefresh={() => { refreshList(); }}
              onClearInput={() => setInput('')}
              onChangeWorker={() => setChangingWorker(true)}
            />
          )}
        </div>
      )}

      {/* 같은 주문번호가 여러 사업자에 있을 때 */}
      {choice && view === 'list' && (
        <UserChooseSheet
          code={choice.code}
          choices={choice.products}
          userCodeOf={userCodeOf}
          onPick={enterProduct}
          onClose={() => setChoice(null)}
        />
      )}

      {/* 카메라는 화면이 바뀌어도 그대로 둔다 — 목록과 배치 화면을 오가도 카메라 권한을 다시 묻지 않게 */}
      <BarcodeCamera
        open={scan !== null}
        hint={scan?.hint ?? ''}
        onCode={handleCamCode}
        onClose={() => setScan(null)}
        labels={camLabels}
      />

      {/* 잠깐 뜨는 안내 */}
      {toastText && <div className="mob-toast" role="status">{toastText}</div>}
    </>
  );
}
