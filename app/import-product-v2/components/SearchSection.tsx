'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';

/* V2 전용 SearchSection 컴포넌트 - 모든 className에 v2- 접두사 */

interface SearchSectionProps {
  searchType: string;
  searchTerm: string;
  onSearchTypeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onSearchInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSearchKeyPress: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSearchClick: () => void;
}

const SearchSection: React.FC<SearchSectionProps> = ({
  searchType,
  searchTerm,
  onSearchTypeChange,
  onSearchInputChange,
  onSearchKeyPress,
  onSearchClick,
}) => {
  const { t } = useTranslation();

  return (
    <div className="v2-search-section">
      <div className="v2-search-board">
        <div className="v2-search-form-container">
          <select
            className="v2-search-dropdown"
            value={searchType}
            onChange={onSearchTypeChange}
          >
            <option value="배송번호">{t('importProduct.searchType.deliveryNumber')}</option>
            <option value="일반검색">{t('importProduct.searchType.general')}</option>
          </select>
          <input
            type="text"
            placeholder={searchType === '배송번호' ? t('importProduct.searchPlaceholder.deliveryNumber') : t('importProduct.searchPlaceholder.general')}
            className="v2-search-input"
            value={searchTerm}
            onChange={onSearchInputChange}
            onKeyPress={onSearchKeyPress}
          />
          <button className="v2-search-button" onClick={onSearchClick}>
            {t('importProduct.search')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SearchSection;
