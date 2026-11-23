'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../../contexts/LanguageContext';
import type { WowWorkBox } from '../../storage/types';
import { playErrorSound } from '../../storage/utils/storageFormat';
import { useWorkers } from '../../shipment-v2/hooks/useWorkers';
import BarcodeCamera, { type BarcodeCameraLabels } from '../components/BarcodeCamera';
import { useRememberedWorker } from './hooks/useRememberedWorker';
import { useToast } from './hooks/useToast';
import { useWowBoxes } from './hooks/useWowBoxes';
import { isBoxMarked } from './utils/cardState';
import { workErrorText } from './utils/errorText';
import { boxLabel, filterOf, matchesFilter, parseOrderCode } from './utils/orderCode';
import { playOkSound } from './utils/sound';
import WorkerSelect from './components/WorkerSelect';
import BoxList from './components/BoxList';
import DeckScreen from './components/DeckScreen';
import '../Mobile.css';
import './WowWork.css';

// ============================================================
// /m/wow — 와우출고 작업 (모바일)
//
//   담당자 선택 → 목록(박스 라벨 입력 · 카메라) → 카드(찾음 · 부족 · 메모 · 박스 크기 변경) → [작업완료]
//   서버: /api/ft/storage/wow/work (app/api/ft/storage/wow/work/route.ts)
//
//   화면은 주소를 바꾸지 않고 상태로 바꾼다.
//     · 담당자가 없거나 [변경] 을 눌렀으면  → 담당자 선택 (components/WorkerSelect)
//     · 연 박스가 있으면                    → 카드       (components/DeckScreen)
//     · 그 밖에는                           → 목록       (components/BoxList)
//   이 파일은 화면 전환 · 목록에서 박스 고르기만 맡는다. 카드 화면의 일은 DeckScreen 이 맡는다.
// ============================================================

type View = 'wait' | 'worker' | 'list' | 'deck';

export default function WowWork() {
  const { t } = useTranslation();
  const { language, changeLanguage } = useLanguage();
  const workers = useWorkers();
  const { operatorName, ready, choose } = useRememberedWorker(workers);
  const { boxes, refreshing, reload, patchBox } = useWowBoxes();
  const { toastText, notify } = useToast();

  const [changingWorker, setChangingWorker] = useState(false);
  const [openBox, setOpenBox] = useState<WowWorkBox | null>(null);
  const [input, setInput] = useState('');
  const [camOpen, setCamOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** 기다리는 동안(목록 새로 받기)에도 지금 목록을 보기 위한 값 */
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;

  const view: View =
    !ready ? 'wait'
    : !operatorName || changingWorker ? 'worker'
    : openBox ? 'deck'
    : 'list';

  // ============================================================
  // 목록
  // ============================================================

  // ── 새로 받기 — 가지고 있던 목록이 있으면 실패를 안내로만 알리고 목록은 그대로 둔다 ──
  const refreshList = useCallback(async (): Promise<WowWorkBox[] | null> => {
    try {
      const data = await reload();
      setLoadError(null);
      return data;
    } catch (e) {
      const text = workErrorText(e, t);
      if (boxesRef.current) notify(t('mobile.wow.list.refreshFail', { message: text }));
      else setLoadError(text);
      return null;
    }
  }, [reload, notify, t]);

  // ── 목록 화면에 들어올 때마다 새로 받는다 (카드에서 돌아올 때 포함) ──
  useEffect(() => {
    if (view === 'list') refreshList();
  }, [view, refreshList]);

  // ── 거르기 ──
  const filter = filterOf(input);
  const visible = useMemo(() => {
    if (!boxes) return [];
    return filter ? boxes.filter((b) => matchesFilter(b.order_number, filter)) : boxes;
  }, [boxes, filter]);

  // ============================================================
  // 박스 고르기
  // ============================================================
  const enterBox = useCallback((box: WowWorkBox) => {
    setInput('');
    setOpenBox(box);
  }, []);

  // ── 박스 라벨(발주번호 + 박스번호)로 열기 — 목록에 없으면 새로 받아 한 번 더 찾는다 (방금 생긴 박스) ──
  const openByLabel = useCallback(async (orderNumber: string, boxNo: number) => {
    const pick = (list: WowWorkBox[] | null) =>
      list?.find((b) => b.order_number === orderNumber && b.box_no === boxNo);
    const hit = pick(boxesRef.current) ?? pick(await refreshList());
    if (!hit) {
      playErrorSound();
      notify(t('mobile.wow.list.boxMissing', { label: boxLabel({ order_number: orderNumber, box_no: boxNo }) }));
      return;
    }
    enterBox(hit);
  }, [refreshList, enterBox, notify, t]);

  // ── 입력 · 스캔 값 처리: 박스번호까지 있으면 바로 열고, 발주번호만이면 목록을 거른다 ──
  const submitCode = useCallback((raw: string) => {
    const value = raw.replace(/\s+/g, '');
    if (!value) {
      notify(t('mobile.wow.list.needInput'));
      return;
    }
    const list = boxesRef.current ?? [];
    const code = parseOrderCode(value, list.map((b) => b.order_number));
    if (!code) {
      playErrorSound();
      notify(t('mobile.wow.list.badCode', { value }));
      return;
    }
    if (code.boxNo !== null) {
      openByLabel(code.orderNumber, code.boxNo);
      return;
    }
    setInput(code.orderNumber);
    const hits = list.filter((b) => b.order_number === code.orderNumber).length;
    if (hits > 0) {
      playOkSound();
      notify(t('mobile.wow.list.orderHits', { order: code.orderNumber, count: hits }));
    } else {
      playErrorSound();
      notify(t('mobile.wow.list.orderMissing', { order: code.orderNumber }));
    }
  }, [openByLabel, notify, t]);

  // ── 카메라가 읽은 값 — 발주번호 · 박스 라벨 모양이면 받아들인다 ──
  const handleCamCode = useCallback((text: string): boolean => {
    const known = (boxesRef.current ?? []).map((b) => b.order_number);
    if (!parseOrderCode(text, known)) return false;
    setCamOpen(false);
    submitCode(text);
    return true;
  }, [submitCode]);

  // ── 다음 미처리 박스 (거른 목록 안에서) ──
  const openNextBox = useCallback(() => {
    const next = visible.find((b) => !isBoxMarked(b));
    if (!next) {
      notify(t('mobile.wow.list.noneLeft'));
      return;
    }
    enterBox(next);
  }, [visible, enterBox, notify, t]);

  // ── 카드 화면에서 돌아옴 ──
  const closeDeck = useCallback((message?: string) => {
    setOpenBox(null);
    if (message) notify(message);
  }, [notify]);

  // ── 카드 화면에서 박스 크기를 바꿈 — 연 박스와 목록의 같은 박스를 맞춰 고친다 ──
  const applyBoxSize = useCallback((boxSize: string) => {
    if (!openBox || openBox.box_size === boxSize) return;
    patchBox(openBox.box_id, { box_size: boxSize });
    setOpenBox({ ...openBox, box_size: boxSize });
  }, [openBox, patchBox]);

  // ============================================================
  // 카메라 문구 — 공용 문구(mobile.cam.*) + 이 화면의 "형식이 아님" 문구
  // ============================================================
  const camLabels: BarcodeCameraLabels = useMemo(() => ({
    close: t('mobile.cam.close'),
    preparing: t('mobile.cam.preparing'),
    align: t('mobile.cam.align'),
    photoReading: t('mobile.cam.photoReading'),
    photoFail: t('mobile.cam.photoFail'),
    camFailTitle: t('mobile.cam.failTitle'),
    photoScan: t('mobile.cam.photoScan'),
    closeManual: t('mobile.cam.closeManual'),
    permissionDenied: t('mobile.cam.permissionDenied'),
    noCamera: t('mobile.cam.noCamera'),
    cannotOpen: t('mobile.cam.cannotOpen'),
    moduleFail: t('mobile.cam.moduleFail'),
    continueHint: t('mobile.cam.continueHint'),
    notMatched: t('mobile.wow.list.camNotMatched'),
  }), [t]);

  // ============================================================
  // 화면
  // ============================================================
  return (
    <>
      {view === 'deck' && openBox ? (
        <DeckScreen
          key={openBox.box_id}
          box={openBox}
          operatorName={operatorName}
          onExit={closeDeck}
          onSizeChanged={applyBoxSize}
          notify={notify}
        />
      ) : (
        <div className="mob-page">
          <header className="mob-head">
            <Link href="/m" className="mob-back">‹ {t('mobile.home')}</Link>
            <div className="mob-head-title">{t('menu.wowWork')}</div>
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
            <BoxList
              operatorName={operatorName}
              boxes={boxes}
              visible={visible}
              filter={filter}
              refreshing={refreshing}
              loadError={loadError}
              input={input}
              onInputChange={setInput}
              onSubmit={() => submitCode(input)}
              onOpenCamera={() => setCamOpen(true)}
              onPickBox={enterBox}
              onNextBox={openNextBox}
              onRefresh={() => { refreshList(); }}
              onClearFilter={() => setInput('')}
              onChangeWorker={() => setChangingWorker(true)}
            />
          )}
        </div>
      )}

      {/* 카메라는 화면이 바뀌어도 그대로 둔다 — 카드에 다녀와도 카메라 권한을 다시 묻지 않게 */}
      <BarcodeCamera
        open={camOpen && view === 'list'}
        hint={t('mobile.wow.list.camHint')}
        onCode={handleCamCode}
        onClose={() => setCamOpen(false)}
        labels={camLabels}
      />

      {/* 잠깐 뜨는 안내 */}
      {toastText && <div className="mwow-toast" role="status">{toastText}</div>}
    </>
  );
}
