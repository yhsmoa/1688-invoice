'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WowWorkBox, WowWorkCard, WowWorkDeck } from '../../../storage/types';
import { playErrorSound } from '../../../storage/utils/storageFormat';
import { useWowDeck } from '../hooks/useWowDeck';
import { useDeckScroll } from '../hooks/useDeckScroll';
import { firstUnmarked, formatMonthDay, hasLocation, nextUnmarked, summarize } from '../utils/cardState';
import { boxLabel } from '../utils/orderCode';
import { workErrorText } from '../utils/errorText';
import { playOkSound, playShortSound } from '../utils/sound';
import { isWowWorkError, type WowWorkError } from '../utils/wowWorkApi';
import WorkCard from './WorkCard';
import EndCard from './EndCard';
import ShortSheet from './ShortSheet';
import MemoSheet from './MemoSheet';
import ConfirmSheet from './ConfirmSheet';
import SizeSheet from './SizeSheet';
import './DeckScreen.css';

// ============================================================
// DeckScreen — 카드 화면 (박스 하나)
//
//   머리(목록 · 발주번호-박스번호 · 📦 크기 · 새로고침) + 진행 막대 + 옆으로 넘기는 카드 + 아래 [메모] [부족] [찾음]
//   마지막 장은 정리 카드(EndCard) — 전부 표시하면 [작업완료]
//
//   · 들어올 때 한 번 open 을 보낸다 (신규 → 작업중). 실패해도 카드는 본다.
//     박스를 아예 열 수 없으면(없는 박스 · 이미 작업완료) 카드 조회가 같은 이유로 실패하므로 그 문구를 띄우고 목록으로 돌아간다
//   · 위치 카드      : [찾음] = 몫 전부 꺼냄 · [부족] = 숫자판으로 꺼낸 수량 입력 (0 = 여기엔 없음)
//                     몫보다 적게 꺼내면 나머지가 다른 위치 카드(또는 위치 없는 카드)로 다시 나온다
//   · 위치 없는 카드 : 재고가 없는 몫 = 부족. [부족 확인] 만 할 수 있다 ([찾음] 은 잠긴다)
//   · 표시(찾음 · 부족 · 수정 · 취소)를 저장하면 그때마다 카드를 새로 받는다 — 카드 구성이 바뀔 수 있어서다.
//     받는 동안 화면은 그대로 두고, 받은 뒤 보던 카드 자리를 지킨 다음 다음 미처리 카드로 넘어간다
//   · 메모는 그 카드만 고친다
//   · 담는 박스의 크기는 머리의 [📦 크기 ▾] · 정리 카드의 버튼으로 바꾼다 (SizeSheet). 바뀌면 박스 라벨을 다시 뽑아야 한다
//   · [작업완료] 는 부족이 있거나 하나도 꺼내지 못했으면 먼저 묻는다
//   · 저장에 실패하면 서버 문구 + 경고음 + 카드를 새로 받는다
//   · 저장 · 새로고침은 한 번에 하나만 (겹치면 늦게 온 응답이 방금 받은 카드를 덮는다)
// ============================================================

interface DeckScreenProps {
  box: WowWorkBox;
  operatorName: string;
  /** 목록으로 — message 가 있으면 목록에서 안내로 띄운다 */
  onExit: (message?: string) => void;
  /** 박스 크기가 바뀜 — 목록의 같은 박스도 맞춰 고치게 알린다 */
  onSizeChanged: (boxSize: string) => void;
  notify: (text: string) => void;
}

/** [작업완료] 전에 묻는 까닭 — short = 부족이 있다 · none = 하나도 꺼내지 못했다 */
type ConfirmKind = 'short' | 'none';

const DeckScreen: React.FC<DeckScreenProps> = ({ box, operatorName, onExit, onSizeChanged, notify }) => {
  const { t } = useTranslation();
  const { deck, loadSeq, reload, open, find, saveMemo, changeSize, complete } = useWowDeck(box.box_id, operatorName);
  const cards = useMemo(() => deck?.cards ?? [], [deck]);
  const summary = useMemo(() => summarize(cards), [cards]);
  /** 넘기는 장 수 = 카드 + 정리 카드 */
  const { deckRef, index, indexRef, goTo, onScroll } = useDeckScroll(cards.length + 1);

  const [busy, setBusy] = useState(false);
  const lockRef = useRef(false);
  const mountedRef = useRef(false);
  const startedRef = useRef(false);
  /** 창을 연 카드 (key) */
  const [shortKey, setShortKey] = useState<string | null>(null);
  const [memoKey, setMemoKey] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ConfirmKind | null>(null);
  const [sizeOpen, setSizeOpen] = useState(false);

  const label = boxLabel(box);
  /** 담는 박스의 크기 — 카드를 받은 뒤에는 서버가 준 값 */
  const boxSize = deck ? deck.box.box_size : box.box_size;
  const headMeta = [box.center, formatMonthDay(box.arrival_date)].filter(Boolean).join(' · ');
  const onEnd = !deck || index >= cards.length;
  const current: WowWorkCard | null = onEnd ? null : cards[index];
  const shortCard = shortKey ? cards.find((c) => c.key === shortKey) ?? null : null;
  const memoCard = memoKey ? cards.find((c) => c.key === memoKey) ?? null : null;

  // ============================================================
  // 한 번에 하나만 — 저장 · 새로고침이 겹치지 않게
  // ============================================================
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (lockRef.current) return undefined;
    lockRef.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      lockRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  // ============================================================
  // 카드 받기
  // ============================================================

  // ── 받기 (first = 처음 들어올 때). 처음에 못 받거나 더 작업할 수 없는 박스면 목록으로 ──
  const load = useCallback(async (first: boolean) => {
    try {
      await reload();
      if (first && mountedRef.current) playOkSound();
    } catch (e) {
      if (!mountedRef.current) return;
      playErrorSound();
      const text = workErrorText(e, t);
      if (first || (isWowWorkError(e) && e.boxGone)) onExit(text);
      else notify(text);
    }
  }, [reload, onExit, notify, t]);

  // ── 저장한 뒤 · 저장에 실패한 뒤 서버 상태로 다시 맞춤 — 더 작업할 수 없는 박스면 그 사유를 돌려준다 ──
  const resync = useCallback(async (): Promise<{ fresh: WowWorkDeck | null; gone: WowWorkError | null }> => {
    try {
      return { fresh: await reload(), gone: null };
    } catch (e) {
      return { fresh: null, gone: isWowWorkError(e) && e.boxGone ? e : null };
    }
  }, [reload]);

  // ── 들어올 때 한 번: open + 카드 받기 ──
  useEffect(() => {
    mountedRef.current = true;
    if (!startedRef.current) {
      startedRef.current = true;
      // 들어옴 표시는 실패해도 넘어간다 — [찾음] 을 누르면 서버가 작업 시작을 같이 적는다
      open().catch(() => undefined);
      run(() => load(true));
    }
    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // 보던 자리 지키기 (카드를 새로 받을 때마다)
  //   처음 받으면 첫 미처리 카드로.
  //   그 뒤에는 보던 카드(같은 key)로 — 없어졌으면 같은 번호 자리로.
  //   방금 표시한 카드를 아직 보고 있으면(advanceKeyRef) 이어서 다음 미처리 카드로 넘어간다
  // ============================================================
  /** 지금 보고 있는 카드의 key (null = 정리 카드) */
  const shownKeyRef = useRef<string | null>(null);
  const placedRef = useRef(false);
  /** 새로 받은 뒤 다음 미처리 카드로 넘어갈 출발 카드 (null = 넘어가지 않는다) */
  const advanceKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (loadSeq === 0) return;
    const advanceKey = advanceKeyRef.current;
    advanceKeyRef.current = null;
    if (!placedRef.current) {
      placedRef.current = true;
      goTo(firstUnmarked(cards), true);
      return;
    }
    const key = shownKeyRef.current;
    const found = key === null ? cards.length : cards.findIndex((c) => c.key === key);
    const at = found < 0 ? Math.min(indexRef.current, cards.length) : found;
    goTo(at, true);
    if (advanceKey !== null && advanceKey === key && found >= 0) goTo(nextUnmarked(cards, at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSeq]);

  useEffect(() => {
    shownKeyRef.current = cards[index]?.key ?? null;
  }, [cards, index]);

  // ============================================================
  // 찾음 · 부족 · 수정 · 취소
  // ============================================================

  // ── 저장 → 카드를 새로 받는다. advance = 받은 뒤 다음 미처리 카드로 넘어갈지 ──
  const saveFind = useCallback((card: WowWorkCard, foundQty: number | null, advance: boolean) => run(async (): Promise<void> => {
    // 1) 저장
    try {
      await find(card, foundQty);
    } catch (e) {
      const { fresh, gone } = await resync();
      if (!mountedRef.current) return;
      if (gone) {
        playErrorSound();
        onExit(workErrorText(gone, t));
        return;
      }
      // 연결이 끊겼지만 서버에는 저장된 경우 — 새로 받은 카드가 보낸 값과 같다
      const now = fresh?.cards.find((c) => c.key === card.key);
      if (isWowWorkError(e) && e.network && now && now.found_qty === foundQty) {
        notify(t('mobile.wow.savedAnyway'));
        return;
      }
      playErrorSound();
      notify(workErrorText(e, t));
      return;
    }

    // 2) 저장됨 → 새로 받기 (자리 지키기 · 다음 카드로 넘기기는 위의 "보던 자리 지키기" 가 한다)
    advanceKeyRef.current = advance ? card.key : null;
    const { fresh, gone } = await resync();
    if (fresh || !mountedRef.current) return;
    advanceKeyRef.current = null;
    playErrorSound();
    if (gone) onExit(workErrorText(gone, t));
    else notify(t('mobile.wow.deck.reloadFail'));
  }), [run, find, resync, onExit, notify, t]);

  // ── [찾음] = 이 위치에서 몫 전부 꺼냄 ──
  const handleFound = useCallback(() => {
    if (!current || !hasLocation(current) || lockRef.current) return;
    playOkSound();
    saveFind(current, current.plan_qty, true);
  }, [current, saveFind]);

  // ── [부족] — 위치 카드는 숫자판, 위치 없는 카드는 바로 부족 확인(꺼낸 수량 0) ──
  const handleShort = useCallback(() => {
    if (!current || lockRef.current) return;
    if (hasLocation(current)) {
      setShortKey(current.key);
      return;
    }
    playShortSound();
    saveFind(current, 0, true);
  }, [current, saveFind]);

  // ── 숫자판 확인 (꺼낸 수량) ──
  const handleShortConfirm = useCallback((foundQty: number) => {
    const card = shortCard;
    if (!card || lockRef.current) return;
    setShortKey(null);
    if (foundQty > 0 && foundQty >= card.plan_qty) playOkSound(); else playShortSound();
    saveFind(card, foundQty, true);
  }, [shortCard, saveFind]);

  // ============================================================
  // 메모 ('' = 지움) — 실패하면 적던 내용을 잃지 않게 창은 그대로 둔다
  // ============================================================
  const handleMemoSave = useCallback((memo: string) => run(async () => {
    const card = memoCard;
    if (!card) return;
    try {
      await saveMemo(card, memo);
      setMemoKey(null);
      playOkSound();
      notify(memo ? t('mobile.wow.memoSheet.saved') : t('mobile.wow.memoSheet.cleared'));
    } catch (e) {
      const { gone } = await resync();
      if (!mountedRef.current) return;
      playErrorSound();
      if (gone) onExit(workErrorText(gone, t));
      else notify(workErrorText(e, t));
    }
  }), [run, memoCard, saveMemo, resync, onExit, notify, t]);

  // ============================================================
  // 박스 크기 변경 — 누른 크기를 바로 저장한다. 바뀌지 않았으면(같은 크기) 창만 닫는다
  // ============================================================
  const handleSizePick = useCallback((size: string) => run(async () => {
    try {
      const result = await changeSize(size);
      setSizeOpen(false);
      onSizeChanged(result.size);
      if (!result.changed) return;
      playOkSound();
      notify(t('mobile.wow.size.changed', { prev: result.prev ?? t('mobile.wow.size.none'), size: result.size }));
    } catch (e) {
      const { gone } = await resync();
      if (!mountedRef.current) return;
      playErrorSound();
      if (gone) onExit(workErrorText(gone, t));
      else notify(workErrorText(e, t));
    }
  }), [run, changeSize, resync, onSizeChanged, onExit, notify, t]);

  // ============================================================
  // 작업완료
  // ============================================================
  const doComplete = useCallback(() => run(async () => {
    setConfirming(null);
    const doneText = t('mobile.wow.completed', { label });
    try {
      await complete();
      playOkSound();
      onExit(doneText);
    } catch (e) {
      const { gone } = await resync();
      if (!mountedRef.current) return;
      // 연결이 끊겼는데 다시 보니 이미 작업완료 = 방금 보낸 요청이 처리된 것
      if (gone && gone.alreadyPicked && isWowWorkError(e) && e.network) {
        playOkSound();
        onExit(doneText);
        return;
      }
      playErrorSound();
      if (gone) onExit(workErrorText(gone, t));
      else notify(workErrorText(e, t));
    }
  }), [run, complete, resync, onExit, notify, t, label]);

  // ── 먼저 묻는 경우: 하나도 꺼내지 못함(출고 없이 마감) · 부족이 있음(꺼낸 수량만 출고) ──
  const handleComplete = useCallback(() => {
    if (summary.takenQty === 0) setConfirming('none');
    else if (summary.short > 0) setConfirming('short');
    else doComplete();
  }, [summary.takenQty, summary.short, doComplete]);

  // ============================================================
  // 화면
  // ============================================================
  const marked = summary.total - summary.left;
  const allMarked = summary.total > 0 && summary.left === 0;
  const progressText = allMarked
    ? t('mobile.wow.deck.allMarked', { total: summary.total })
    : onEnd
      ? t('mobile.wow.deck.markedOf', { done: marked, total: summary.total })
      : `${index + 1} / ${summary.total} · ${t('mobile.wow.deck.marked', { count: marked })}`;
  const dim = current !== null && current.found_qty !== null ? ' is-dim' : '';
  /** 지금 카드가 위치 없는 카드(재고 없음)인가 */
  const noStockCard = current !== null && !hasLocation(current);

  return (
    <div className="mob-page mwow-deck-page">
      {/* 머리 */}
      <header className="mob-head">
        <button type="button" className="mob-back mwow-head-btn" onClick={() => onExit()}>
          ‹ {t('mobile.wow.deck.toList')}
        </button>
        <div className="mwow-deck-title">
          <b>{label}</b>
          <button
            type="button"
            className="mwow-size-btn"
            disabled={busy}
            onClick={() => setSizeOpen(true)}
            aria-label={t('mobile.wow.size.title')}
            title={t('mobile.wow.size.title')}
          >
            <span aria-hidden="true">📦</span> {boxSize ?? t('mobile.wow.size.none')} ▾
          </button>
          {headMeta && <small>{headMeta}</small>}
        </div>
        <button
          type="button"
          className="mob-back mwow-head-btn"
          disabled={busy}
          onClick={() => { run(() => load(false)); }}
          aria-label={t('mobile.wow.list.refresh')}
          title={t('mobile.wow.list.refresh')}
        >
          ↻
        </button>
      </header>

      {/* 진행 */}
      <div className="mwow-prog">
        <progress className={`mwow-prog-bar${allMarked ? ' is-full' : ''}`} max={Math.max(1, summary.total)} value={marked} />
        <span className={`mwow-prog-text${allMarked ? ' is-full' : ''}`}>{deck ? progressText : ''}</span>
      </div>

      {/* 카드 */}
      <div className="mwow-deck" ref={deckRef} onScroll={onScroll}>
        {!deck ? (
          <div className="mwow-cardw">
            <div className="mwow-card"><div className="mwow-deck-empty">{t('mobile.wow.deck.loading')}</div></div>
          </div>
        ) : (
          <>
            {cards.map((c) => (
              <WorkCard
                key={c.key}
                card={c}
                busy={busy}
                onEdit={() => setShortKey(c.key)}
                onCancel={() => { saveFind(c, null, false); }}
                onMemo={() => setMemoKey(c.key)}
              />
            ))}
            <EndCard
              cards={cards}
              summary={summary}
              boxLabel={label}
              boxSize={boxSize}
              busy={busy}
              onChangeSize={() => setSizeOpen(true)}
              onJump={(i) => goTo(i)}
              onGoLeft={() => goTo(firstUnmarked(cards))}
              onComplete={handleComplete}
              onBackToList={() => onExit()}
            />
          </>
        )}
      </div>

      {/* 아래 버튼 — [메모] [부족] [찾음]. 위치 없는 카드는 [부족 확인] 만 할 수 있다 */}
      <div className="mwow-bottom">
        <button
          type="button"
          className={`mwow-act is-memo${current?.memo ? ' has-memo' : ''}`}
          disabled={!current || busy}
          onClick={() => { if (current) setMemoKey(current.key); }}
        >
          {t('mobile.wow.deck.memo')}
        </button>
        <button
          type="button"
          className={`mwow-act is-short${noStockCard ? ' is-main' : ''}${dim}`}
          disabled={!current || busy}
          onClick={handleShort}
        >
          {noStockCard ? t('mobile.wow.deck.shortConfirm') : t('mobile.wow.deck.short')}
        </button>
        <button
          type="button"
          className={`mwow-act is-found${dim}`}
          disabled={!current || busy || noStockCard}
          onClick={handleFound}
        >
          ✓ {t('mobile.wow.deck.found')}
        </button>
      </div>

      {/* 창 */}
      {shortCard && (
        <ShortSheet
          key={shortCard.key}
          card={shortCard}
          onConfirm={handleShortConfirm}
          onClose={() => setShortKey(null)}
          notify={notify}
        />
      )}
      {memoCard && (
        <MemoSheet
          key={memoCard.key}
          card={memoCard}
          busy={busy}
          onSave={(memo) => { handleMemoSave(memo); }}
          onClose={() => setMemoKey(null)}
          notify={notify}
        />
      )}
      {confirming && (
        <ConfirmSheet
          title={confirming === 'none' ? t('mobile.wow.end.confirmNoneTitle') : t('mobile.wow.end.confirmTitle')}
          text={confirming === 'none'
            ? t('mobile.wow.end.confirmNoneText')
            : t('mobile.wow.end.confirmText', { short: summary.shortQty, found: summary.takenQty })}
          yesLabel={t('mobile.wow.end.complete')}
          noLabel={t('mobile.wow.end.confirmNo')}
          onYes={() => { doComplete(); }}
          onNo={() => setConfirming(null)}
        />
      )}
      {sizeOpen && (
        <SizeSheet
          label={label}
          current={boxSize}
          busy={busy}
          onPick={(size) => { handleSizePick(size); }}
          onClose={() => setSizeOpen(false)}
        />
      )}
    </div>
  );
};

export default DeckScreen;
