'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type * as ZX from '@zxing/library';
import './BarcodeCamera.css';

// ============================================================
// BarcodeCamera — 휴대폰 카메라 바코드 스캔 (immongRK_scan mobileInbound 의 방식 그대로)
//
//   1) 안드로이드 크롬: 내장 BarcodeDetector (빠름). code_128 을 지원한다고 답해야 믿는다
//      (WebKit 은 API 만 있고 1D 를 못 읽는 경우가 있다)
//   2) 아이폰(사파리·크롬 모두 WebKit) 등: ZXing — 안내 네모 안만 잘라 작게 해독 (TRY_HARDER 끔)
//      내장 인식기가 있어도 detect 가 5번 연속 실패하면 ZXing 으로 넘어간다
//   3) 실시간 카메라(getUserMedia)가 없는 브라우저(카카오톡 인앱 등): OS 카메라 앱으로 사진 1장 → 해독
//   4) 카메라 스트림은 닫은 뒤에도 3분간 유지 (다음 스캔에 권한을 다시 묻지 않게) — 화면을 벗어나면 즉시 해제
//
//   둘 다 HTTPS + 카메라 권한 필요. onCode 가 true 를 돌려주면 스캔을 멈추고 닫는다.
// ============================================================

const CAM_FORMATS = ['code_128', 'code_39', 'ean_13', 'qr_code', 'itf'];
/** 뒷카메라 + 높은 해상도 — 1D(code128) 는 저해상도 프레임에서 잘 안 읽힌다 */
const CAM_VIDEO: MediaTrackConstraints = { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
const NATIVE_INTERVAL_MS = 300;
const ZXING_INTERVAL_MS = 100;
const NATIVE_FAIL_LIMIT = 5;
const IDLE_RELEASE_MS = 3 * 60 * 1000;

// ── 내장 BarcodeDetector 최소 타입 (lib.dom 에 없음) ──
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: ImageBitmapSource): Promise<DetectedBarcode[]> }
interface BarcodeDetectorCtor {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}
const nativeDetector = (): BarcodeDetectorCtor | undefined =>
  (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

type ZXingModule = typeof ZX;
let zxingModule: ZXingModule | null = null;
let zxingLoading: Promise<ZXingModule> | null = null;
/** ZXing 은 필요할 때만 내려받는다 (번들에서 분리) */
function loadZXing(failMessage: string): Promise<ZXingModule> {
  if (zxingModule) return Promise.resolve(zxingModule);
  if (zxingLoading) return zxingLoading;
  zxingLoading = import('@zxing/library')
    .then((m) => { zxingModule = m; return m; })
    .catch(() => { zxingLoading = null; throw new Error(failMessage); });
  return zxingLoading;
}

export interface BarcodeCameraLabels {
  close: string;
  preparing: string;
  align: string;
  photoReading: string;
  photoFail: string;
  camFailTitle: string;
  photoScan: string;
  closeManual: string;
  permissionDenied: string;
  noCamera: string;
  cannotOpen: string;
  moduleFail: string;
  continueHint: string;
  /** 읽었지만 이 화면에서 쓰는 형식이 아닐 때 — {{value}} 치환 */
  notMatched: string;
}

interface BarcodeCameraProps {
  open: boolean;
  /** 안내 문구 (예: 운송장 바코드를 맞춰 주세요) */
  hint: string;
  /** 읽은 값 — true 면 받아들이고 닫는다, false 면 계속 찾는다 */
  onCode: (text: string) => boolean;
  onClose: () => void;
  labels: BarcodeCameraLabels;
}

const BarcodeCamera: React.FC<BarcodeCameraProps> = ({ open, hint, onCode, onClose, labels }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const [showing, setShowing] = useState(false);
  const [hintText, setHintText] = useState(hint);
  const [failMsg, setFailMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // ── 읽은 값 처리 — 받아들이면 스캔을 멈춘다 ──
  const handleCode = useCallback((raw: string): boolean => {
    const s = String(raw ?? '').trim();
    if (!s) return false;
    const ok = onCodeRef.current(s);
    if (ok) stopCam();
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 스트림 재사용 — 살아 있으면 그대로 (권한을 다시 묻지 않는다) ──
  const getCamStream = useCallback(async (): Promise<MediaStream> => {
    const cur = streamRef.current;
    if (cur && cur.getVideoTracks().some((t) => t.readyState === 'live')) return cur;
    const st = await navigator.mediaDevices.getUserMedia({ video: CAM_VIDEO, audio: false });
    streamRef.current = st;
    return st;
  }, []);

  const releaseCam = useCallback(() => {
    if (idleTimerRef.current) { window.clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
    const st = streamRef.current;
    if (st) { try { st.getTracks().forEach((t) => t.stop()); } catch { /* 무시 */ } streamRef.current = null; }
    const v = videoRef.current;
    if (v && v.srcObject) { try { (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop()); } catch { /* 무시 */ } v.srcObject = null; }
  }, []);

  /** 스캔 창 닫기 — 해독은 멈추고 화면은 숨기되 카메라는 3분간 유지 */
  const stopCam = useCallback(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    const v = videoRef.current;
    if (v) { try { v.pause(); } catch { /* 무시 */ } }
    setShowing(false);
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(releaseCam, IDLE_RELEASE_MS);
  }, [releaseCam]);

  const showCamFail = useCallback((msg: string) => setFailMsg(msg), []);

  const camFailed = useCallback((e: unknown) => {
    const err = e as { name?: string; message?: string } | null;
    const m = (err && err.message) || String(e ?? '');
    const key = m + (err && err.name ? err.name : '');
    const why =
      /NotAllowed|Permission|denied/i.test(key) ? labels.permissionDenied
      : /NotFound|no camera|Requested device/i.test(key) ? labels.noCamera
      : m === labels.moduleFail ? m
      : `${labels.cannotOpen} (${m})`;
    showCamFail(`${why} ${labels.continueHint}`);
  }, [labels, showCamFail]);

  // ── 사진 찍어서 읽기 — OS 카메라 앱 → 사진 1장 → BarcodeDetector 또는 ZXing ──
  const openPhotoScan = useCallback(() => photoInputRef.current?.click(), []);

  const decodePhoto = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setToast(labels.photoReading);
    let url: string | null = null;
    try {
      url = URL.createObjectURL(file);
      let text: string | null = null;
      const Det = nativeDetector();
      if (Det) {
        try {
          const bmp = await createImageBitmap(file, { resizeWidth: 1600, resizeQuality: 'high' }).catch(() => createImageBitmap(file));
          const codes = await new Det({ formats: CAM_FORMATS }).detect(bmp);
          if (codes && codes.length) text = codes[0].rawValue;
        } catch { /* ZXing 으로 */ }
      }
      if (!text) {
        const Z = await loadZXing(labels.moduleFail);
        const hints = new Map();
        hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.ITF]);
        hints.set(Z.DecodeHintType.TRY_HARDER, true);
        const r = await new Z.BrowserMultiFormatReader(hints).decodeFromImageUrl(url);
        text = r ? r.getText() : null;
      }
      if (!text) throw new Error('no barcode');
      if (!handleCode(text)) setToast(labels.notMatched.replace('{{value}}', text));
      else setToast(null);
    } catch (e) {
      console.error('사진 바코드 해독 실패:', e);
      setToast(null);
      showCamFail(labels.photoFail);
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }, [handleCode, labels, showCamFail]);

  // ── ZXing 실시간 — 안내 네모 안만 잘라 작게 해독 ──
  const openCamZXing = useCallback(async (v: HTMLVideoElement) => {
    try {
      setShowing(true);
      setHintText(labels.preparing);
      const Z = await loadZXing(labels.moduleFail);
      const hints = new Map();
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.ITF]);
      // TRY_HARDER 는 끈다 — 아이폰에서 프레임당 해독 시간이 두 배 넘게 늘어 체감이 느려진다
      const reader = new Z.MultiFormatReader();
      reader.setHints(hints);
      const st = await getCamStream();
      if (v.srcObject !== st) v.srcObject = st;
      await v.play();
      // 연속 초점 (지원하는 기기만 — 아이폰 사파리는 무시해도 해가 없다)
      try {
        const tr = st.getVideoTracks()[0];
        const caps = (tr.getCapabilities ? tr.getCapabilities() : {}) as { focusMode?: string[] };
        if (caps.focusMode && caps.focusMode.includes('continuous')) {
          await tr.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] });
        }
      } catch { /* 무시 */ }
      setHintText(labels.align);
      const canvas = document.createElement('canvas');
      const g = canvas.getContext('2d', { willReadFrequently: true });
      if (!g) throw new Error('canvas');
      let frame = 0;
      let busy = false;
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        if (busy || !v.videoWidth) return;
        busy = true;
        try {
          const vw = v.videoWidth, vh = v.videoHeight, full = (++frame % 8 === 0);
          // 안내 네모(.guide: left 8% · right 8% · top 40% · height 20%)와 같은 영역 — 화면은 object-fit: cover 라 조금 넉넉히
          const sx = full ? 0 : Math.round(vw * 0.06), sw = full ? vw : Math.round(vw * 0.88);
          const sy = full ? 0 : Math.round(vh * 0.34), sh = full ? vh : Math.round(vh * 0.32);
          const scale = Math.min(1, 800 / sw);
          canvas.width = Math.round(sw * scale);
          canvas.height = Math.round(sh * scale);
          g.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
          let r: ZX.Result | null = null;
          try { r = reader.decodeWithState(bmp); } catch { /* 이 프레임엔 바코드 없음 */ }
          if (r && handleCode(r.getText())) return;
        } catch { /* 무시 */ } finally { busy = false; }
      }, ZXING_INTERVAL_MS);
    } catch (e) {
      stopCam();
      camFailed(e);
    }
  }, [camFailed, getCamStream, handleCode, labels, stopCam]);

  // ── 열기 — 내장 인식기 → ZXing → 사진 ──
  const openCam = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { openPhotoScan(); return; }
    try {
      const Det = nativeDetector();
      let nativeOk = false;
      if (Det) {
        try { const fm = await Det.getSupportedFormats(); nativeOk = Array.isArray(fm) && fm.includes('code_128'); } catch { nativeOk = false; }
      }
      if (Det && nativeOk) {
        const st = await getCamStream();
        if (v.srcObject !== st) v.srcObject = st;
        setShowing(true);
        setHintText(hint);
        await v.play();
        const det = new Det({ formats: CAM_FORMATS });
        let fails = 0;
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = window.setInterval(async () => {
          try {
            const codes = await det.detect(v);
            fails = 0;
            for (const c of codes) { if (handleCode(c.rawValue)) return; }
          } catch {
            // detect 가 계속 실패 → ZXing 으로 넘어간다
            if (++fails >= NATIVE_FAIL_LIMIT) {
              if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
              openCamZXing(v);
            }
          }
        }, NATIVE_INTERVAL_MS);
        return;
      }
      await openCamZXing(v);
    } catch (e) {
      stopCam();
      camFailed(e);
    }
  }, [camFailed, getCamStream, handleCode, hint, openCamZXing, openPhotoScan, stopCam]);

  // ── open 에 따라 열고 닫기 ──
  useEffect(() => {
    if (open) { setFailMsg(null); openCam(); }
    else stopCam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── 화면을 벗어나면 카메라 즉시 해제 · 언마운트 시 정리 ──
  useEffect(() => {
    const onVis = () => { if (document.hidden) releaseCam(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', releaseCam);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', releaseCam);
      if (timerRef.current) window.clearInterval(timerRef.current);
      releaseCam();
    };
  }, [releaseCam]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const close = () => { stopCam(); onClose(); };

  return (
    <>
      {/* 실시간 카메라 */}
      <div className={`bc-cam ${showing ? 'show' : ''}`}>
        <video ref={videoRef} playsInline muted autoPlay />
        <div className="bc-guide" aria-hidden="true" />
        <div className="bc-top">
          <span>{hintText}</span>
          <button type="button" onClick={close}>{labels.close}</button>
        </div>
      </div>

      {/* 사진 찍어서 읽기 — 실시간 카메라가 안 되는 폰 */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => { decodePhoto(e.target.files?.[0]); e.target.value = ''; }}
      />

      {/* 카메라를 열 수 없을 때 */}
      {failMsg && (
        <div className="bc-fail" onClick={(e) => { if (e.target === e.currentTarget) setFailMsg(null); }}>
          <div className="bc-sheet" role="dialog" aria-label={labels.camFailTitle}>
            <h2>{labels.camFailTitle}</h2>
            <p>{failMsg}</p>
            <div className="bc-fail-btns">
              <button type="button" className="bc-btn primary" onClick={() => { setFailMsg(null); openPhotoScan(); }}>📷 {labels.photoScan}</button>
              <button type="button" className="bc-btn ghost" onClick={() => { setFailMsg(null); onClose(); }}>{labels.closeManual}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="bc-toast show">{toast}</div>}
    </>
  );
};

export default BarcodeCamera;
