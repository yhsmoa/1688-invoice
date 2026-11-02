'use client';

import React from 'react';
import { resolveSizeBadge } from '../../../lib/sizeCode';
import StockChip from '../../../component/StockChip';
import type { StorageProductInfo } from '../types';
import { joinOptions } from '../utils/storageFormat';

// ============================================================
// ProductCell — 사진 · 배지 · 상품명/옵션 · 중국어 옵션 (작업중 / 재고 / 모달 공용)
//   보관 화면의 상품은 전부 보관이지만, 포장 타입(A/B/C/P/X)을 함께 보여야
//   쉽먼트 때 어떤 박스로 보낼지 알 수 있다 → 배지 + [S] 칩을 같이 표시
// ============================================================

interface ProductCellProps {
  info: StorageProductInfo;
  /** 모달용 큰 사진 */
  large?: boolean;
}

const ProductCell: React.FC<ProductCellProps> = ({ info, large }) => {
  const badge = resolveSizeBadge(info.shipment_type, info.coupang_shipment_size);
  const isSet = (info.set_total ?? 0) > 1;

  return (
    <div className={`storage-product ${large ? 'is-large' : ''}`}>
      {info.img_url ? (
        // 1688 원본 이미지 — next/image 원격 도메인 설정 없이 그대로 표시 (다른 V2 화면과 동일)
        // eslint-disable-next-line @next/next/no-img-element
        <img className="storage-product-img" src={info.img_url} alt="" loading="lazy" />
      ) : (
        <div className="storage-product-img is-empty" />
      )}
      <div className="storage-product-text">
        <div className="storage-product-badges">
          {badge && <span className={`size-badge ${badge.colorClass}`}>{badge.code}</span>}
          <StockChip item={{ arrival_route: 'STOCK' }} />
          {isSet && <span className="storage-set-badge">SET {info.set_total}</span>}
          <span className="storage-product-no">{info.product_no}</span>
        </div>
        <div className="storage-product-name">{info.item_name}</div>
        <div className="storage-product-option">{joinOptions(info.option_name)}</div>
        <div className="storage-product-option is-cn">{joinOptions(info.china_option1, info.china_option2)}</div>
      </div>
    </div>
  );
};

export default ProductCell;
