'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';

interface LanguageContextType {
  language: string;
  changeLanguage: (lang: string) => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { i18n } = useTranslation();
  const [language, setLanguage] = useState<string>('ko');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // 로컬스토리지에서 언어 설정 불러오기
    const savedLanguage = localStorage.getItem('i18nextLng') || 'ko';
    setLanguage(savedLanguage);
    i18n.changeLanguage(savedLanguage);
    setMounted(true);
  }, [i18n]);

  const changeLanguage = (lang: string) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
    localStorage.setItem('i18nextLng', lang);
  };

  // Hydration 이슈 방지: 클라이언트 마운트 전까지 기본값으로 렌더링
  if (!mounted) {
    return (
      <LanguageContext.Provider value={{ language, changeLanguage }}>
        <div style={{ visibility: 'hidden' }}>{children}</div>
      </LanguageContext.Provider>
    );
  }

  return (
    <LanguageContext.Provider value={{ language, changeLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
