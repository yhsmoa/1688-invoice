'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../../contexts/LanguageContext';
import BarcodeCamera, { type BarcodeCameraLabels } from '../components/BarcodeCamera';
import { compressImage, ImageCompressError } from '../../../lib/compressImage';
import { proxyImageUrl, THUMB_WIDTH } from '../../../lib/imageProxy';
import {
  SELLER_INQUIRY_MAX_PHOTOS,
  type SellerInquiryDetail,
  type SellerInquiryPhotoRow,
} from '../../../lib/sellerInquiries';
import '../Mobile.css';

// ============================================================
// /m/seller-inquiry — 1688 판매자 문의 (모바일)
//
//   [촬영] → 운송장 바코드(code128) 스캔 → 접수(ft_seller_inquiries) 조회 → 부족 목록 표시
//   → [사진 추가] 로 여러 장 촬영·선택 → 브라우저에서 압축 → Storage 업로드 → 접수에 첨부
//   바코드를 못 읽으면 번호를 직접 입력해 [조회] 할 수 있다.
// ============================================================

const TAKEN_BY_KEY = 'mob-taken-by';
/** 운송장 번호 형식 — 영문·숫자·하이픈 6자 이상 (YT…, JT…, S…, 숫자만 등) */
const DELIVERY_CODE_RE = /^[A-Za-z0-9-]{6,}$/;

type Notice = { kind: 'ok' | 'error' | 'info'; text: string } | null;

export default function MobileSellerInquiryPage() {
  const { t } = useTranslation();
  const { language, changeLanguage } = useLanguage();

  const [takenBy, setTakenBy] = useState('');
  const [camOpen, setCamOpen] = useState(false);
  const [code, setCode] = useState('');
  const [inquiry, setInquiry] = useState<SellerInquiryDetail | null>(null);
  const [othersCount, setOthersCount] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 촬영자 이름은 기기에 기억 ──
  useEffect(() => {
    try { setTakenBy(window.localStorage.getItem(TAKEN_BY_KEY) ?? ''); } catch { /* 저장소 사용 불가 */ }
  }, []);
  const changeTakenBy = (v: string) => {
    setTakenBy(v);
    try { window.localStorage.setItem(TAKEN_BY_KEY, v); } catch { /* 무시 */ }
  };

  // ── 접수 조회 ──
  const lookup = useCallback(async (raw: string) => {
    const c = raw.trim();
    if (!DELIVERY_CODE_RE.test(c)) {
      setNotice({ kind: 'error', text: t('mobile.inquiry.badCode') });
      return;
    }
    setIsLookingUp(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/ft/seller-inquiries/by-delivery-code?delivery_code=${encodeURIComponent(c)}`, { cache: 'no-store' });
      const json = await res.json();
      if (res.status === 404 || !json.success) {
        setInquiry(null);
        setOthersCount(0);
        setNotice({ kind: 'error', text: res.status === 404 ? t('mobile.inquiry.notFound', { code: c }) : (json.error || t('mobile.inquiry.lookupError')) });
        return;
      }
      setInquiry(json.inquiry as SellerInquiryDetail);
      setOthersCount(Array.isArray(json.others) ? json.others.length : 0);
      setNotice({ kind: 'ok', text: t('mobile.inquiry.found', { count: (json.inquiry as SellerInquiryDetail).items.length }) });
    } catch (e) {
      console.error('seller-inquiry lookup 오류:', e);
      setInquiry(null);
      setNotice({ kind: 'error', text: t('mobile.inquiry.lookupError') });
    } finally {
      setIsLookingUp(false);
    }
  }, [t]);

  // ── 바코드 읽음 — 운송장 형식이면 받아들이고 조회 ──
  const handleCode = useCallback((text: string): boolean => {
    const s = text.trim();
    if (!DELIVERY_CODE_RE.test(s)) return false;
    setCode(s);
    setCamOpen(false);
    lookup(s);
    return true;
  }, [lookup]);

  // ── 사진 올리기 — 압축 → multipart POST ──
  const handleFiles = useCallback(async (list: FileList | null) => {
    if (!inquiry || !list || list.length === 0) return;
    const files = Array.from(list).slice(0, SELLER_INQUIRY_MAX_PHOTOS);
    if (list.length > SELLER_INQUIRY_MAX_PHOTOS) {
      setNotice({ kind: 'info', text: t('mobile.inquiry.tooMany', { max: SELLER_INQUIRY_MAX_PHOTOS }) });
    }
    setUploading({ done: 0, total: files.length });
    try {
      const form = new FormData();
      form.append('inquiry_id', inquiry.id);
      if (takenBy.trim()) form.append('taken_by', takenBy.trim());
      for (let i = 0; i < files.length; i++) {
        try {
          const { file } = await compressImage(files[i]);
          form.append('photo', file, file.name);
        } catch (e) {
          const msg = e instanceof ImageCompressError ? e.message : t('mobile.inquiry.compressFail', { name: files[i].name });
          setNotice({ kind: 'error', text: msg });
          setUploading(null);
          return;
        }
        setUploading({ done: i + 1, total: files.length });
      }
      const res = await fetch('/api/ft/seller-inquiries/photos', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || t('mobile.inquiry.uploadFail'));
      const added = json.photos as SellerInquiryPhotoRow[];
      setInquiry((prev) => (prev ? { ...prev, photos: [...prev.photos, ...added] } : prev));
      setNotice({ kind: 'ok', text: t('mobile.inquiry.uploaded', { count: added.length }) });
    } catch (e) {
      console.error('seller-inquiry 사진 업로드 오류:', e);
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : t('mobile.inquiry.uploadFail') });
    } finally {
      setUploading(null);
    }
  }, [inquiry, takenBy, t]);

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
    notMatched: t('mobile.cam.notMatched'),
  }), [t]);

  const statusClass = inquiry?.status === '문의중' ? 'is-status-inq' : inquiry?.status === '처리완료' ? 'is-status-done' : 'is-status';
  const shortTotal = inquiry ? inquiry.items.reduce((n, it) => n + it.short_qty, 0) : 0;
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(language === 'zh' ? 'zh-CN' : 'ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

  return (
    <div className="mob-page">
      <header className="mob-head">
        <Link href="/m" className="mob-back">‹ {t('mobile.home')}</Link>
        <div className="mob-head-title">{t('menu.sellerInquiry')}</div>
        <div className="mob-head-right">
          <select className="mob-lang" value={language} onChange={(e) => changeLanguage(e.target.value)} aria-label="language">
            <option value="ko">한국어</option>
            <option value="zh">中文</option>
          </select>
        </div>
      </header>

      <main className="mob-body">
        {/* 촬영자 */}
        <label className="mob-field">
          {t('mobile.inquiry.takenBy')}
          <input className="mob-input" value={takenBy} onChange={(e) => changeTakenBy(e.target.value)} placeholder={t('mobile.inquiry.takenByPlaceholder')} />
        </label>

        {/* 촬영 */}
        <button type="button" className="mob-btn accent" onClick={() => setCamOpen(true)}>
          📷 {t('mobile.inquiry.scan')}
        </button>

        {/* 직접 입력 */}
        <div className="mob-row">
          <input
            className="mob-input"
            value={code}
            inputMode="text"
            autoCapitalize="characters"
            placeholder={t('mobile.inquiry.codePlaceholder')}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') lookup(code); }}
          />
          <button type="button" className="mob-btn secondary" style={{ flex: '0 0 auto', padding: '0 18px' }} disabled={isLookingUp} onClick={() => lookup(code)}>
            {isLookingUp ? '…' : t('mobile.inquiry.lookup')}
          </button>
        </div>

        {notice && <div className={`mob-notice is-${notice.kind}`}>{notice.text}</div>}

        {/* 접수 카드 */}
        {inquiry && (
          <section className="mob-card">
            <div className="mob-card-head">
              <span className="mob-code">{inquiry.delivery_code}</span>
              <span className="mob-chip">{inquiry.team_code}</span>
              <span className={`mob-chip ${statusClass}`}>{t(`sellerInquiry.status.${inquiry.status}`)}</span>
            </div>
            <div className="mob-meta">
              {t('sellerInquiry.receivedAt')} {fmt(inquiry.received_at)}
              {inquiry.created_by ? ` · ${inquiry.created_by}` : ''}
              {othersCount > 0 ? ` · ${t('mobile.inquiry.others', { count: othersCount })}` : ''}
            </div>
            <div className="mob-meta">
              <b>{t('mobile.inquiry.shortSummary', { lines: inquiry.items.length, qty: shortTotal })}</b>
            </div>
            {inquiry.memo && <div className="mob-notice is-info">{inquiry.memo}</div>}

            <div className="mob-items">
              {inquiry.items.map((it) => (
                <div key={it.id} className="mob-item">
                  {it.img_url ? (
                    <img src={proxyImageUrl(it.img_url, THUMB_WIDTH)} alt="" loading="lazy" />
                  ) : (
                    <div className="mob-noimg">-</div>
                  )}
                  <div className="mob-item-main">
                    <span className="mob-item-no">{it.item_no}</span>
                    <span className="mob-item-opt">{[it.china_option1, it.china_option2].filter(Boolean).join(' / ')}</span>
                  </div>
                  <div className="mob-item-qty">
                    <b>-{it.short_qty}</b>
                    {it.arrived_qty} / {it.expected_qty}
                  </div>
                </div>
              ))}
            </div>

            {/* 사진 */}
            {inquiry.photos.length > 0 && (
              <div className="mob-photos">
                {inquiry.photos.map((p) => (
                  <a key={p.id} href={p.public_url} target="_blank" rel="noopener noreferrer">
                    <img src={p.public_url} alt="" loading="lazy" />
                  </a>
                ))}
              </div>
            )}
            {uploading && (
              <div className="mob-progress">{t('mobile.inquiry.uploading', { done: uploading.done, total: uploading.total })}</div>
            )}
            {inquiry.status !== '처리완료' && (
              <button type="button" className="mob-btn" disabled={!!uploading} onClick={() => fileInputRef.current?.click()}>
                📸 {t('mobile.inquiry.addPhotos')}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
            />
          </section>
        )}
      </main>

      <BarcodeCamera
        open={camOpen}
        hint={t('mobile.inquiry.camHint')}
        onCode={handleCode}
        onClose={() => setCamOpen(false)}
        labels={camLabels}
      />
    </div>
  );
}
