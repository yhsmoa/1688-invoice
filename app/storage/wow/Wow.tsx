'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStorage } from '../hooks/StorageContext';
import ProductCell from '../components/ProductCell';
import WowPickModal from '../components/WowPickModal';
import type { WowLine } from '../types';
import { playErrorSound } from '../utils/storageFormat';
import './Wow.css';

// ============================================================
// [와우출고] — 로켓 발주서의 위해 창고 박스(발주번호-박스번호)에 담을 상품 · 수량
//
//   박스 카드: 상태 요청 → 담음([담기]) → 출고(쉽먼트 V2 에서 박스 통째로 출고)
//     · [담기 취소]: 출고 전에만 — 꺼냈던 위치로 되돌리고 다시 요청 상태
//     · 서류: 로켓이 올린 부착문서 · 동봉문서 (signed URL, 새 탭)
//   박스 미정: 배정만 되고 박스가 정해지지 않은 줄 — 예약은 되지만 담을 수 없다
//   목록 = 출고 전 줄이 남은 발주서 (다 출고된 발주서는 사라진다)
// ============================================================

type BoxStatus = 'requested' | 'picked' | 'shipped';

interface WowBox {
  id: string;
  lines: WowLine[];
  status: BoxStatus;
}

const statusOf = (l: WowLine): BoxStatus => (l.shipped ? 'shipped' : l.box_info_id ? 'picked' : 'requested');

const Wow: React.FC = () => {
  const { t } = useTranslation();
  const { tab, wow, worker, userCodeOf, reloadAll } = useStorage();
  const [pickBox, setPickBox] = useState<WowBox | null>(null);
  const [busyBox, setBusyBox] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // ── 박스별 묶음 (API 가 발주번호 · 박스번호 순으로 준다) + 박스 미정 줄 ──
  const { boxes, unboxed } = useMemo(() => {
    const map = new Map<string, WowBox>();
    const rest: WowLine[] = [];
    for (const l of wow.rows) {
      if (!l.box_id) { rest.push(l); continue; }
      const b = map.get(l.box_id) ?? { id: l.box_id, lines: [], status: statusOf(l) };
      b.lines.push(l);
      map.set(l.box_id, b);
    }
    return { boxes: Array.from(map.values()), unboxed: rest };
  }, [wow.rows]);

  // ============================================================
  // 담기 취소
  // ============================================================
  const handleUnpack = useCallback(async (box: WowBox) => {
    const head = box.lines[0];
    if (!worker) { setMessage({ kind: 'error', text: t('storage.needWorker') }); return; }
    if (!window.confirm(t('storage.wow.unpackConfirm', { box: `${head.order_number}-${head.box_no}` }))) return;
    setBusyBox(box.id);
    try {
      const res = await fetch('/api/ft/storage/wow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unpack', user_id: head.user_id, wow_box_id: box.id, operator_name: worker }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || t('storage.wow.error'));
      setMessage(null);
      reloadAll();
    } catch (err) {
      console.error('와우출고 담기 취소 오류:', err);
      playErrorSound();
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : t('storage.wow.error') });
    } finally {
      setBusyBox('');
    }
  }, [worker, reloadAll, t]);

  const handlePickClose = useCallback((changed: boolean) => {
    setPickBox(null);
    if (changed) setMessage({ kind: 'ok', text: t('storage.wow.done') });
  }, [t]);

  // ============================================================
  // 렌더
  // ============================================================
  if (wow.loadError) return <div className="storage-empty is-error">{t('storage.loadError')}</div>;
  if (wow.loading && wow.rows.length === 0) return <div className="storage-empty">{t('storage.loading')}</div>;
  if (wow.rows.length === 0) return <div className="storage-empty">{t('storage.wow.empty')}</div>;

  return (
    <section className="storage-wow">
      {message && <div className={`storage-message is-${message.kind}`}>{message.text}</div>}

      <div className="storage-wow-boxes">
        {boxes.map((b) => {
          const head = b.lines[0];
          return (
            <article key={b.id} className={`storage-wow-card is-${b.status}`}>
              <header className="storage-wow-head">
                {!tab && <span className="storage-wow-user">{userCodeOf(head.user_id)}</span>}
                <strong>{head.order_number}-{head.box_no}</strong>
                {head.center && <span>{head.center}</span>}
                {head.box_size && <span>{head.box_size}</span>}
                <span className={`storage-wow-status is-${b.status}`}>{t(`storage.wow.status.${b.status}`)}</span>
                {head.box_code && <span className="storage-location-code">{head.box_code}</span>}
              </header>

              <table className="storage-table storage-table--compact">
                <thead>
                  <tr>
                    <th>{t('storage.col.product')}</th>
                    <th className="col-num">{t('storage.wow.requested')}</th>
                    <th className="col-num">{t('storage.wow.picked')}</th>
                  </tr>
                </thead>
                <tbody>
                  {b.lines.map((l) => (
                    <tr key={l.item_id}>
                      <td><ProductCell info={l} /></td>
                      <td className="col-num is-strong">{l.qty}</td>
                      <td className={`col-num ${l.picked_qty !== null && l.picked_qty < l.qty ? 'storage-wow-short' : ''}`}>
                        {l.picked_qty ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <footer className="storage-wow-actions">
                {head.label_path && (
                  <a className="storage-link-btn" href={`/api/ft/storage/wow/docs?box_id=${b.id}&kind=label`} target="_blank" rel="noreferrer">
                    {t('storage.wow.label')}
                  </a>
                )}
                {head.manifest_path && (
                  <a className="storage-link-btn" href={`/api/ft/storage/wow/docs?box_id=${b.id}&kind=manifest`} target="_blank" rel="noreferrer">
                    {t('storage.wow.manifest')}
                  </a>
                )}
                {b.status === 'requested' && (
                  <button type="button" className="storage-btn storage-btn--primary" onClick={() => setPickBox(b)}>
                    {t('storage.wow.pick')}
                  </button>
                )}
                {b.status === 'picked' && (
                  <button type="button" className="storage-btn" onClick={() => handleUnpack(b)} disabled={busyBox === b.id}>
                    {t('storage.wow.unpack')}
                  </button>
                )}
              </footer>
            </article>
          );
        })}
      </div>

      {/* ── 박스 미정 ── */}
      {unboxed.length > 0 && (
        <div className="storage-wow-unboxed">
          <h3>{t('storage.wow.unboxed')} <span className="storage-hint">{t('storage.wow.unboxedHint')}</span></h3>
          <table className="storage-table storage-table--compact">
            <thead>
              <tr>
                <th className="col-location">{t('storage.wow.order')}</th>
                <th>{t('storage.col.product')}</th>
                <th className="col-num">{t('storage.wow.requested')}</th>
              </tr>
            </thead>
            <tbody>
              {unboxed.map((l) => (
                <tr key={l.item_id}>
                  <td className="col-location">{!tab && `${userCodeOf(l.user_id)} `}{l.order_number}</td>
                  <td><ProductCell info={l} /></td>
                  <td className="col-num is-strong">{l.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pickBox && <WowPickModal lines={pickBox.lines} onClose={handlePickClose} />}
    </section>
  );
};

export default Wow;
