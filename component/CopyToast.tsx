'use client';

import React from 'react';
import './CopyToast.css';

// ============================================================
// CopyToast — "복사했습니다" 같은 짧은 알림 (화면 아래 가운데, 어두운 알약)
//   표시·자동 숨김은 부르는 쪽 훅이 맡는다 (app/seller-inquiry/hooks/useCopyToast)
//   message 가 null 이면 그리지 않는다
// ============================================================

interface CopyToastProps {
  message: string | null;
}

const CopyToast: React.FC<CopyToastProps> = ({ message }) =>
  message ? (
    <div className="copy-toast" role="status" aria-live="polite">
      {message}
    </div>
  ) : null;

export default CopyToast;
