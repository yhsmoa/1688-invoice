'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';

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
  onSearchClick
}) => {
  const { t } = useTranslation();

  return (
    <div className="search-section">
      <div className="search-board">
        <div className="search-form-container">
          <select
            className="search-dropdown"
            value={searchType}
            onChange={onSearchTypeChange}
          >
            <option value="배송번호">{t('importProduct.searchType.deliveryNumber')}</option>
            <option value="일반검색">{t('importProduct.searchType.general')}</option>
          </select>
          <input
            type="text"
            placeholder={searchType === '배송번호' ? t('importProduct.searchPlaceholder.deliveryNumber') : t('importProduct.searchPlaceholder.general')}
            className="search-input"
            value={searchTerm}
            onChange={onSearchInputChange}
            onKeyPress={onSearchKeyPress}
          />
          <button className="search-button" onClick={onSearchClick}>
            {t('importProduct.search')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SearchSection;
