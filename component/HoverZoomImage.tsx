'use client';

import React, { useCallback, useRef, useState } from 'react';
import './HoverZoomImage.css';

// ============================================================
// HoverZoomImage — 썸네일 + 마우스를 올리면 600×600 확대 미리보기
//
//   상품입고 V2 (ItemTableRow .v2-image-preview) 와 같은 모양이지만, 마우스 좌표를 화면 루트가
//   아니라 이 컴포넌트가 스스로 잡는다 (onMouseMove → 루트의 CSS 변수 --hz-x / --hz-y,
//   다시 그리지 않음). 미리보기는 hover 중에만 DOM 에 넣는다 — 목록 50행의 원본 이미지를
//   미리 내려받지 않게.
//
//   props:
//     src       썸네일 URL (프록시 썸네일 등)
//     fullSrc   확대에 쓸 원본 URL
//     size      썸네일 한 변(px) — 없으면 CSS 기본값
//     onClick   썸네일 클릭 (복사 등) — 이벤트를 그대로 넘긴다
// ============================================================

interface HoverZoomImageProps {
  src: string;
  fullSrc: string;
  alt?: string;
  size?: number;
  className?: string;
  title?: string;
  onClick?: (e: React.MouseEvent<HTMLSpanElement>) => void;
}

/** 썸네일 크기 CSS 변수 */
type SizeVars = React.CSSProperties & { '--hz-size'?: string };

const HoverZoomImage: React.FC<HoverZoomImageProps> = ({ src, fullSrc, alt = '', size, className, title, onClick }) => {
  const rootRef = useRef<HTMLSpanElement>(null);
  const [hovering, setHovering] = useState(false);

  // ── 마우스 좌표 → CSS 변수 (미리보기 위치) ──
  const track = useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty('--hz-x', `${e.clientX}px`);
    el.style.setProperty('--hz-y', `${e.clientY}px`);
  }, []);

  const sizeStyle: SizeVars | undefined = size ? { '--hz-size': `${size}px` } : undefined;

  return (
    <span
      ref={rootRef}
      className={`hz-root ${onClick ? 'is-clickable' : ''} ${className ?? ''}`}
      style={sizeStyle}
      title={title}
      onMouseEnter={(e) => { track(e); setHovering(true); }}
      onMouseMove={track}
      onMouseLeave={() => setHovering(false)}
      onClick={onClick}
    >
      <img className="hz-thumb" src={src} alt={alt} loading="lazy" />
      {hovering && (
        <span className="hz-preview" aria-hidden="true">
          <img src={fullSrc} alt="" />
        </span>
      )}
    </span>
  );
};

export default HoverZoomImage;
