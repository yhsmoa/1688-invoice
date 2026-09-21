'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// DeliveryStatusTools — [배송상황 콘솔] [배송상황 csv]
//
// 배송상황 갱신 흐름:
//   1) [배송상황 콘솔] → 1688 크롤러 스크립트를 클립보드에 복사
//   2) 1688 주문목록 페이지 콘솔에 붙여넣기 → CSV 가 다운로드됨
//   3) [배송상황 csv] → 그 CSV 업로드 (/api/upload-delivery-status-csv)
//      → 완료 후 onUploaded() 로 배송 칸 재조회
//
// 스크립트는 public/scripts 에 두어, 새 버전이 나오면 파일만 교체한다.
// 클릭 시점에 fetch 하면 브라우저가 "사용자 클릭 직후" 가 아니라고 보고
// 복사를 막을 수 있어, 마운트 때 미리 받아 둔다.
// ============================================================

const CRAWLER_SCRIPT_URL = '/scripts/1688-delivery-crawler-v3.js';
const COPIED_FEEDBACK_MS = 2000;

interface DeliveryStatusToolsProps {
  /** 업로드 성공 후 호출 — 배송 상태 재조회 */
  onUploaded?: () => void;
}

// ── 스크립트 받기 ──
async function loadCrawlerScript(): Promise<string> {
  const res = await fetch(CRAWLER_SCRIPT_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ── 클립보드 복사 ──
//   navigator.clipboard 는 https(또는 localhost)에서만 동작한다.
//   LAN 주소(http://192.168.x.x:3000)로 접속한 PC 를 위해 execCommand 로 대체.
async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 권한 거부 등 → 아래 대체 방식
    }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  if (!ok) throw new Error('clipboard copy failed');
}

const DeliveryStatusTools: React.FC<DeliveryStatusToolsProps> = ({ onUploaded }) => {
  // ============================================================
  // 1) 배송상황 콘솔 — 스크립트 복사
  // ============================================================
  const [script, setScript] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 스크립트 미리 받아 두기 ──
  useEffect(() => {
    let cancelled = false;
    loadCrawlerScript()
      .then((text) => { if (!cancelled) setScript(text); })
      .catch((err) => console.error('배송상황 스크립트 로드 오류:', err));
    return () => {
      cancelled = true;
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const handleCopyScript = useCallback(async () => {
    try {
      // 미리 받기에 실패했으면 클릭 시점에 한 번 더 시도
      const text: string = script !== null ? script : await loadCrawlerScript();
      await copyToClipboard(text);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch (err) {
      console.error('배송상황 스크립트 복사 오류:', err);
      alert('스크립트 복사에 실패했습니다. 다시 시도해 주세요.');
    }
  }, [script]);

  // ============================================================
  // 2) 배송상황 csv — 업로드
  // ============================================================
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.name.toLowerCase().endsWith('.csv')) {
        alert('CSV 파일(.csv)만 업로드 가능합니다.');
        e.target.value = '';
        return;
      }

      setUploading(true);
      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch('/api/upload-delivery-status-csv', {
          method: 'POST',
          body: formData,
        });
        const result = await response.json();

        if (response.ok) {
          alert(`배송상황 CSV 업로드 완료\n저장: ${result.savedCount || 0}개`);
          onUploaded?.();
        } else {
          alert(result.error || '업로드 중 오류가 발생했습니다.');
        }
      } catch {
        alert('업로드 중 오류가 발생했습니다.');
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [onUploaded]
  );

  // ============================================================
  // 렌더
  // ============================================================
  return (
    <div className="os-v2-delivery-tools">
      <button
        type="button"
        className={`os-v2-delivery-tool-btn ${copied ? 'is-copied' : ''}`}
        onClick={handleCopyScript}
        title="1688 주문목록 페이지 콘솔에 붙여넣기할 스크립트를 복사합니다"
      >
        {copied ? '복사됨 ✓' : '배송상황 콘솔'}
      </button>
      <button
        type="button"
        className="os-v2-delivery-tool-btn"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? '업로드 중...' : '배송상황 csv'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  );
};

export default DeliveryStatusTools;
