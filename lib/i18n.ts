import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import ko from '../locales/ko.json';
import zh from '../locales/zh.json';

// 브라우저 환경에서만 LanguageDetector 사용
if (typeof window !== 'undefined') {
  i18n.use(LanguageDetector);
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      ko: { translation: ko },
      zh: { translation: zh }
    },
    fallbackLng: 'ko',
    lng: 'zh', // 기본 언어 — 중국어 (LanguageContext 가 저장된 선택으로 덮는다). 누락 키는 fallbackLng(ko)
    debug: false,
    interpolation: {
      escapeValue: false
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage']
    },
    react: {
      useSuspense: false // hydration 오류 방지
    }
  });

export default i18n;
