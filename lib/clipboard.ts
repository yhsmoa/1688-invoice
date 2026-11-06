import { proxyImageUrl } from './imageProxy';

// ============================================================
// 클립보드 복사 — 브라우저 전용 (클릭 핸들러 안에서 부른다)
//
//   copyText(text)  : 글자 복사. HTTPS(보안 컨텍스트)면 navigator.clipboard,
//                     LAN http 접속처럼 막힌 환경이면 textarea + execCommand('copy') 로 대신한다.
//                     둘 다 실패하면 Error 를 던진다.
//   copyImage(url)  : 이미지 자체를 PNG 로 복사 → 'image'.
//                     같은 출처 프록시(/api/image-proxy)로 받아야 canvas 가 오염되지 않는다.
//                     ClipboardItem 이 없거나(구형·http) 어느 단계든 실패하면 URL 글자를 복사 → 'text'.
//
//   쓰는 곳: /seller-inquiry (배송번호 · 중국옵션 · 사진)
// ============================================================

// ============================================================
// 글자
// ============================================================
function copyTextByExecCommand(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  // 화면 밖에 두되 선택은 가능해야 한다 (display:none 이면 복사가 안 된다)
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '0';
  document.body.appendChild(ta);
  try {
    ta.select();
    if (!document.execCommand('copy')) throw new Error('execCommand copy failed');
  } finally {
    document.body.removeChild(ta);
  }
}

export async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 권한·포커스 문제 → 아래 대체 방식
    }
  }
  copyTextByExecCommand(text);
}

// ============================================================
// 이미지
// ============================================================
async function decodeToCanvasPng(blob: Blob): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  } else {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

async function fetchAsPng(url: string): Promise<Blob> {
  const res = await fetch(proxyImageUrl(url));
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  return decodeToCanvasPng(await res.blob());
}

export async function copyImage(url: string): Promise<'image' | 'text'> {
  const canWriteImage =
    window.isSecureContext && typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';
  if (canWriteImage) {
    try {
      // Promise 를 그대로 넘긴다 — Safari 는 클릭 직후 동기적으로 write 를 불러야 허용한다
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': fetchAsPng(url) })]);
      return 'image';
    } catch (e) {
      console.error('이미지 복사 실패 — URL 로 대신 복사:', e);
    }
  }
  await copyText(url);
  return 'text';
}
