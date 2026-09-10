'use client';

import type { Metadata } from 'next'
import './globals.css'
import { LanguageProvider } from '../contexts/LanguageContext'
import { SidebarProvider } from '../contexts/SidebarContext'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <head>
        {/* 라벨 글꼴 — 네이버 나눔스퀘어 웹폰트 (lib/labelTypes.ts WEB_FONTS).
            인쇄 PC 에 글꼴을 설치하지 않아도 캔버스 래스터에 쓸 수 있게 사이트가 내려준다 */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/moonspam/NanumSquare@2.0/nanumsquare.css"
        />
      </head>
      <body>
        <LanguageProvider>
          <SidebarProvider>
            {children}
          </SidebarProvider>
        </LanguageProvider>
      </body>
    </html>
  )
} 