'use client';

import React, { useEffect, useState } from 'react';
import { proxyImageUrl, THUMB_WIDTH, THUMB_WIDTH_LARGE } from '../../../../lib/imageProxy';

// ============================================================
// ProductThumb — 상품 사진 (목록 줄 · 배치 화면 공용)
//   1688 사진은 바로 불러올 수 없어 image-proxy 를 거친 작은 사진을 쓴다.
//   사진이 없거나 불러오지 못하면 빈 네모를 보여 준다
// ============================================================

interface ProductThumbProps {
  url: string | null;
  /** 배치 화면의 큰 사진 */
  large?: boolean;
}

const ProductThumb: React.FC<ProductThumbProps> = ({ url, large }) => {
  const [failed, setFailed] = useState(false);

  // ── 사진 주소가 바뀌면 다시 불러 본다 ──
  useEffect(() => { setFailed(false); }, [url]);

  const className = `mput-thumb${large ? ' is-large' : ''}`;

  return url && !failed ? (
    <img
      className={className}
      src={proxyImageUrl(url, large ? THUMB_WIDTH_LARGE : THUMB_WIDTH)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className={`${className} is-empty`} aria-hidden="true">-</span>
  );
};

export default ProductThumb;
