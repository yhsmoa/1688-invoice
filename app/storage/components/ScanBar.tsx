'use client';

import React, { forwardRef, useState } from 'react';

// ============================================================
// ScanBar — 상단 스캔 입력창 1개
//
//   USB 바코드 리더는 "값 + Enter" 로 입력한다 → Enter 에서 onScan 후 비운다.
//   ref 를 열어 두어 부모가 모달을 닫은 뒤 다시 포커스를 돌려줄 수 있게 한다.
// ============================================================

interface ScanBarProps {
  placeholder: string;
  disabled?: boolean;
  onScan: (value: string) => void;
}

const ScanBar = forwardRef<HTMLInputElement, ScanBarProps>(({ placeholder, disabled, onScan }, ref) => {
  const [value, setValue] = useState('');

  return (
    <input
      ref={ref}
      className="storage-scan-input"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = value.trim();
        setValue('');
        if (v) onScan(v);
      }}
    />
  );
});

ScanBar.displayName = 'ScanBar';

export default ScanBar;
