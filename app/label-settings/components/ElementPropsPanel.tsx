'use client';

import React, { useRef } from 'react';
import {
  PRODUCT_FIELDS,
  ACCOUNT_FIELDS,
  LABEL_FONTS,
  DEFAULT_FONT,
  ELEMENT_TYPE_LABEL,
  DEFAULT_LINE_GAP,
  DEFAULT_MIN_PT,
  isBindable,
  isTextBox,
  resolveElementText,
  type LabelData,
  type LabelElement,
  type LabelTemplate,
  type Rotation,
  type Symbology,
  type TextAlign,
  type TextVAlign,
  type TextOverflow,
} from '../../../lib/labelTypes';
import {
  measureElement,
  rasterElement,
  SYMBOLOGY_HINT,
  isFontAvailable,
} from '../../../lib/labelRender';
import { CARE_SYMBOLS } from '../../../lib/careSymbols';
import type { ElementPatch } from '../hooks/useTemplateDraft';

// ============================================================
// 선택 요소 속성 (우측 컬럼 하단)
//
// 세 덩어리로 나눈다
//   1) 내용   — 데이터 필드 바인딩 / 직접 입력({필드} 자리표시자 혼용)
//   2) 위치   — X · Y · 회전 · 잠금 · 숨김
//   3) 모양   — 요소 종류별 (글꼴·크기 / 바코드 규격 / QR 셀 …)
//
// 숫자 입력은 같은 항목을 연속으로 만지면 되돌리기 한 단계로 합쳐진다
// (onPatch 의 key). 그래서 key 를 항목마다 구분해서 넘긴다.
// ============================================================

const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const ALIGNS: { key: TextAlign; label: string }[] = [
  { key: 'left', label: '왼쪽' },
  { key: 'center', label: '가운데' },
  { key: 'right', label: '오른쪽' },
];
const SYMBOLOGIES: Symbology[] = ['128', '128M', 'EAN13', 'EAN8', 'UPCA', '39', '93'];

interface Props {
  el: LabelElement;
  template: LabelTemplate;
  data: LabelData;
  warning: string | null;
  onPatch: (id: string, patch: ElementPatch, opts?: { key?: string }) => void;
}

// ── 작은 입력 헬퍼 ────────────────────────────────────────
interface NumProps {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  /** 비우면 undefined 로 저장 (선택 항목) */
  optional?: boolean;
  span2?: boolean;
}

const Num: React.FC<NumProps> = ({
  label,
  value,
  onChange,
  step = 0.5,
  min,
  max,
  placeholder,
  optional,
  span2,
}) => (
  <label className={`ls-field ${span2 ? 'ls-col-2' : ''}`}>
    <span>{label}</span>
    <input
      type="number"
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') {
          onChange(optional ? undefined : min ?? 0);
          return;
        }
        onChange(Number(raw));
      }}
    />
  </label>
);

const Check: React.FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <label className="ls-field ls-check">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span>{label}</span>
  </label>
);

// ============================================================
const ElementPropsPanel: React.FC<Props> = ({ el, template, data, warning, onPatch }) => {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const patch = (p: ElementPatch, key?: string) => onPatch(el.id, p, { key });

  const box = measureElement(el, template, data);
  const bindable = isBindable(el);
  // 영역 텍스트의 줄 수·축소 결과 (래스터 캐시에서 바로 읽는다)
  const fit = el.type === 'text' ? rasterElement(el, template, data)?.text ?? null : null;
  const mode: 'field' | 'text' = bindable && el.field ? 'field' : 'text';

  /** 커서 위치에 `{필드}` 삽입 */
  const insertField = (fieldKey: string) => {
    if (!bindable) return;
    const token = `{${fieldKey}}`;
    const node = textRef.current;
    const cur = el.text ?? '';
    if (!node) {
      patch({ text: cur + token });
      return;
    }
    const start = node.selectionStart ?? cur.length;
    const end = node.selectionEnd ?? cur.length;
    const next = cur.slice(0, start) + token + cur.slice(end);
    patch({ text: next });
    requestAnimationFrame(() => {
      node.focus();
      const pos = start + token.length;
      node.setSelectionRange(pos, pos);
    });
  };

  return (
    <section className="ls-panel ls-props-panel">
      <div className="ls-panel-title">
        {ELEMENT_TYPE_LABEL[el.type]} 속성
        <span className="ls-size-readout">
          {box.w_mm.toFixed(1)} × {box.h_mm.toFixed(1)} mm
        </span>
      </div>

      {warning && <div className="ls-warn ls-warn-sm">{warning}</div>}

      <label className="ls-field">
        <span>요소 이름 (목록 표시용)</span>
        <input
          value={el.name ?? ''}
          placeholder="비우면 내용으로 표시"
          onChange={(e) => patch({ name: e.target.value || undefined }, `el:${el.id}:name`)}
        />
      </label>

      {/* ============================================ */}
      {/* 1) 내용                                      */}
      {/* ============================================ */}
      {bindable && (
        <>
          <div className="ls-sub-title">내용</div>

          <div className="ls-seg">
            <button
              className={mode === 'field' ? 'active' : ''}
              onClick={() => patch({ field: 'item_name' })}
            >
              데이터 필드
            </button>
            <button
              className={mode === 'text' ? 'active' : ''}
              onClick={() => patch({ field: undefined, text: el.text ?? '' })}
            >
              직접 입력
            </button>
          </div>

          {mode === 'field' ? (
            <label className="ls-field">
              <span>바인딩 필드</span>
              <select
                value={el.field ?? ''}
                onChange={(e) => patch({ field: e.target.value })}
              >
                <optgroup label="상품 데이터">
                  {PRODUCT_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="계정 정보 (선택된 사업자)">
                  {ACCOUNT_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
          ) : (
            <>
              <label className="ls-field">
                <span>문구 — {'{필드}'} 를 넣으면 실제 값으로 바뀝니다</span>
                <textarea
                  ref={textRef}
                  rows={el.type === 'text' ? 3 : 2}
                  value={el.text ?? ''}
                  placeholder={'예) 수량 {qty}개 / MADE IN CHINA'}
                  onChange={(e) => patch({ text: e.target.value }, `el:${el.id}:text`)}
                />
              </label>

              <label className="ls-field">
                <span>필드 삽입</span>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) insertField(e.target.value);
                    e.target.value = '';
                  }}
                >
                  <option value="">＋ 필드 고르기…</option>
                  <optgroup label="상품 데이터">
                    {PRODUCT_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label} — {`{${f.key}}`}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="계정 정보">
                    {ACCOUNT_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label} — {`{${f.key}}`}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>

              <div className="ls-resolved">
                <span>출력 결과</span>
                <code>{resolveElementText(el, data) || '(비어 있음)'}</code>
              </div>
            </>
          )}
        </>
      )}

      {/* ============================================ */}
      {/* 2) 위치                                      */}
      {/* ============================================ */}
      <div className="ls-sub-title">위치</div>
      <div className="ls-grid-2">
        <Num
          label="X (mm)"
          value={el.x_mm}
          min={0}
          onChange={(v) => patch({ x_mm: v ?? 0 }, `el:${el.id}:x`)}
        />
        <Num
          label="Y (mm)"
          value={el.y_mm}
          min={0}
          onChange={(v) => patch({ y_mm: v ?? 0 }, `el:${el.id}:y`)}
        />
        <label className="ls-field">
          <span>회전</span>
          <select
            value={el.rotate ?? 0}
            onChange={(e) => patch({ rotate: Number(e.target.value) as Rotation })}
          >
            {ROTATIONS.map((r) => (
              <option key={r} value={r}>
                {r}°
              </option>
            ))}
          </select>
        </label>
        <div className="ls-field ls-inline-checks">
          <Check
            label="잠금"
            checked={!!el.locked}
            onChange={(v) => patch({ locked: v || undefined })}
          />
          <Check
            label="숨김"
            checked={!!el.hidden}
            onChange={(v) => patch({ hidden: v || undefined })}
          />
        </div>
      </div>

      {/* ============================================ */}
      {/* 3) 모양 — 텍스트                              */}
      {/* ============================================ */}
      {el.type === 'text' && (
        <>
          <div className="ls-sub-title">글자</div>
          <div className="ls-grid-2">
            <label className="ls-field ls-col-2">
              <span>
                글꼴
                {el.font_family && !isFontAvailable(el.font_family) && (
                  <em className="ls-font-missing"> · 이 PC 에 없음</em>
                )}
              </span>
              <select
                value={el.font_family ?? DEFAULT_FONT}
                onChange={(e) => patch({ font_family: e.target.value })}
              >
                {LABEL_FONTS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                    {isFontAvailable(f.key) ? '' : ' (미설치)'}
                  </option>
                ))}
              </select>
            </label>

            <Num
              label="크기 (pt)"
              value={el.size_pt}
              step={0.5}
              min={2}
              onChange={(v) => patch({ size_pt: v ?? 8 }, `el:${el.id}:size`)}
            />

            <label className="ls-field">
              <span>정렬</span>
              <select
                value={el.align ?? 'left'}
                onChange={(e) => patch({ align: e.target.value as TextAlign })}
              >
                {ALIGNS.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="ls-field ls-inline-checks ls-col-2">
              <Check
                label="굵게"
                checked={!!el.bold}
                onChange={(v) => patch({ bold: v || undefined })}
              />
              <Check
                label="기울임"
                checked={!!el.italic}
                onChange={(v) => patch({ italic: v || undefined })}
              />
              <Check
                label="반전"
                checked={!!el.invert}
                onChange={(v) => patch({ invert: v || undefined })}
              />
            </div>

            <Num
              label="자간 (mm)"
              value={el.letter_spacing_mm}
              optional
              step={0.05}
              placeholder="0"
              onChange={(v) => patch({ letter_spacing_mm: v }, `el:${el.id}:ls`)}
            />
            <Num
              label="줄 간격 (배수)"
              value={el.line_gap ?? DEFAULT_LINE_GAP}
              step={0.05}
              min={0.8}
              onChange={(v) => patch({ line_gap: v ?? DEFAULT_LINE_GAP }, `el:${el.id}:gap`)}
            />
          </div>

          {/* ── 영역 (텍스트 상자) ── */}
          <div className="ls-sub-title">영역</div>
          <div className="ls-hint ls-mb8">
            폭·높이를 정하면 글이 그 안에서 줄바꿈됩니다. 캔버스의 모서리 핸들로도 끌 수
            있습니다. 높이를 비우면 한 줄 모드입니다.
          </div>
          <div className="ls-grid-2">
            <Num
              label="폭 (mm)"
              value={el.max_w_mm}
              optional
              placeholder="비우면 끝까지"
              min={1}
              onChange={(v) => patch({ max_w_mm: v }, `el:${el.id}:maxw`)}
            />
            <Num
              label="높이 (mm)"
              value={el.h_mm}
              optional
              placeholder="비우면 한 줄"
              min={0.5}
              onChange={(v) => patch({ h_mm: v }, `el:${el.id}:h`)}
            />

            {isTextBox(el) ? (
              <>
                <label className="ls-field">
                  <span>세로 정렬</span>
                  <select
                    value={el.v_align ?? 'top'}
                    onChange={(e) => patch({ v_align: e.target.value as TextVAlign })}
                  >
                    <option value="top">위</option>
                    <option value="middle">가운데</option>
                    <option value="bottom">아래</option>
                  </select>
                </label>
                <label className="ls-field">
                  <span>넘칠 때</span>
                  <select
                    value={el.overflow ?? 'shrink'}
                    onChange={(e) => patch({ overflow: e.target.value as TextOverflow })}
                  >
                    <option value="shrink">글자 자동 축소</option>
                    <option value="clip">잘라냄</option>
                  </select>
                </label>
                {(el.overflow ?? 'shrink') === 'shrink' && (
                  <Num
                    label="축소 하한 (pt)"
                    value={el.min_pt ?? DEFAULT_MIN_PT}
                    step={0.5}
                    min={1}
                    onChange={(v) => patch({ min_pt: v ?? DEFAULT_MIN_PT }, `el:${el.id}:minpt`)}
                  />
                )}
                <div className="ls-field">
                  <span>이 샘플로</span>
                  <div className="ls-fit-readout">
                    {fit ? (
                      <>
                        {fit.fitLines}줄 자리에 {fit.totalLines}줄
                        {fit.usedPt < el.size_pt && (
                          <em> · {el.size_pt}pt → {fit.usedPt}pt 축소</em>
                        )}
                        {fit.clippedLines > 0 && <strong> · {fit.clippedLines}줄 잘림</strong>}
                      </>
                    ) : (
                      '내용 없음'
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <Check
                  label="자동 줄바꿈"
                  checked={!!el.wrap}
                  onChange={(v) => patch({ wrap: v || undefined })}
                />
                {el.wrap && (
                  <Num
                    label="최대 줄 수"
                    value={el.max_lines}
                    optional
                    step={1}
                    min={1}
                    placeholder="제한 없음"
                    onChange={(v) => patch({ max_lines: v }, `el:${el.id}:lines`)}
                  />
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ── 모양 — 바코드 ── */}
      {el.type === 'barcode' && (
        <>
          <div className="ls-sub-title">바코드</div>
          <div className="ls-grid-2">
            <label className="ls-field ls-col-2">
              <span>심볼로지</span>
              <select
                value={el.symbology}
                onChange={(e) => patch({ symbology: e.target.value as Symbology })}
              >
                {SYMBOLOGIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <div className="ls-hint ls-col-2">{SYMBOLOGY_HINT[el.symbology]}</div>

            <label className="ls-field">
              <span>정렬</span>
              <select
                value={el.align ?? 'left'}
                onChange={(e) => patch({ align: e.target.value as TextAlign })}
              >
                {ALIGNS.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <Num
              label="정렬 영역 폭 (mm)"
              value={el.max_w_mm}
              optional
              placeholder="비우면 끝까지"
              min={1}
              onChange={(v) => patch({ max_w_mm: v }, `el:${el.id}:maxw`)}
            />
            <Num
              label="높이 (mm)"
              value={el.h_mm}
              min={2}
              onChange={(v) => patch({ h_mm: v ?? 10 }, `el:${el.id}:bh`)}
            />
            <Num
              label="좁은 바 (dots)"
              value={el.narrow}
              step={1}
              min={1}
              max={10}
              onChange={(v) => patch({ narrow: v ?? 2 }, `el:${el.id}:narrow`)}
            />
            <Num
              label="넓은 바 (dots)"
              value={el.wide}
              step={1}
              min={1}
              max={10}
              onChange={(v) => patch({ wide: v ?? 2 }, `el:${el.id}:wide`)}
            />
            <Check
              label="아래 숫자 표시"
              checked={!!el.human_readable}
              onChange={(v) => patch({ human_readable: v || undefined })}
            />
            {el.human_readable && (
              <Num
                label="숫자 크기 (pt)"
                value={el.text_pt ?? 7}
                step={0.5}
                min={4}
                onChange={(v) => patch({ text_pt: v ?? 7 }, `el:${el.id}:tpt`)}
              />
            )}
          </div>
        </>
      )}

      {/* ── 모양 — QR ── */}
      {el.type === 'qr' && (
        <>
          <div className="ls-sub-title">QR 코드</div>
          <div className="ls-grid-2">
            <Num
              label="셀 크기 (dots)"
              value={el.cell}
              step={1}
              min={1}
              max={10}
              onChange={(v) => patch({ cell: v ?? 4 }, `el:${el.id}:cell`)}
            />
            <label className="ls-field">
              <span>오류정정</span>
              <select
                value={el.ecc}
                onChange={(e) => patch({ ecc: e.target.value as 'L' | 'M' | 'Q' | 'H' })}
              >
                <option value="L">L — 7% 복원</option>
                <option value="M">M — 15% 복원</option>
                <option value="Q">Q — 25% 복원</option>
                <option value="H">H — 30% 복원</option>
              </select>
            </label>
            <label className="ls-field">
              <span>정렬</span>
              <select
                value={el.align ?? 'left'}
                onChange={(e) => patch({ align: e.target.value as TextAlign })}
              >
                {ALIGNS.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <Num
              label="정렬 영역 폭 (mm)"
              value={el.max_w_mm}
              optional
              placeholder="비우면 끝까지"
              min={1}
              onChange={(v) => patch({ max_w_mm: v }, `el:${el.id}:maxw`)}
            />
            <div className="ls-hint ls-col-2">
              셀 크기를 키우면 QR 전체가 커집니다. 스캐너가 잘 못 읽으면 셀을 1 올리세요.
            </div>
          </div>
        </>
      )}

      {/* ── 모양 — 이미지 / 세탁 기호 ── */}
      {el.type === 'image' && (
        <>
          <div className="ls-sub-title">이미지</div>
          <div className="ls-grid-2">
            <label className="ls-field ls-col-2">
              <span>세탁 기호 (내장)</span>
              <select
                value={el.symbol ?? ''}
                onChange={(e) => {
                  const key = e.target.value || undefined;
                  // 기호는 정사각형 — 선택 시 세로를 가로에 맞춘다
                  patch(key ? { symbol: key, src: undefined, h_mm: el.w_mm } : { symbol: undefined });
                }}
              >
                <option value="">(업로드 이미지 사용)</option>
                {CARE_SYMBOLS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="ls-field ls-col-2">
              <span>이미지 업로드 (PNG/SVG, 로고 등)</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const src = String(reader.result || '');
                    if (!src) return;
                    // 원본 비율로 세로를 맞춘다
                    const img = new Image();
                    img.onload = () => {
                      const ratio = img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : 1;
                      patch({
                        src,
                        symbol: undefined,
                        h_mm: Math.round(el.w_mm * ratio * 10) / 10,
                      });
                    };
                    img.onerror = () => patch({ src, symbol: undefined });
                    img.src = src;
                  };
                  reader.readAsDataURL(file);
                  e.target.value = '';
                }}
              />
            </label>

            <Num
              label="가로 (mm)"
              value={el.w_mm}
              min={1}
              onChange={(v) => {
                const w = v ?? 5;
                const keep = el.keep_ratio !== false && el.w_mm > 0;
                patch(
                  keep ? { w_mm: w, h_mm: Math.round((w * el.h_mm) / el.w_mm * 10) / 10 } : { w_mm: w },
                  `el:${el.id}:w`
                );
              }}
            />
            <Num
              label="세로 (mm)"
              value={el.h_mm}
              min={1}
              onChange={(v) => {
                const h = v ?? 5;
                const keep = el.keep_ratio !== false && el.h_mm > 0;
                patch(
                  keep ? { h_mm: h, w_mm: Math.round((h * el.w_mm) / el.h_mm * 10) / 10 } : { h_mm: h },
                  `el:${el.id}:h`
                );
              }}
            />
            <Check
              label="비율 유지"
              checked={el.keep_ratio !== false}
              onChange={(v) => patch({ keep_ratio: v ? undefined : false })}
            />
            <Num
              label="흑백 임계값 (0~255)"
              value={el.threshold ?? 128}
              step={8}
              min={0}
              max={255}
              onChange={(v) => patch({ threshold: v ?? 128 }, `el:${el.id}:thr`)}
            />
            <div className="ls-hint ls-col-2">
              감열 인쇄는 흑백 1비트입니다. 회색이 섞인 이미지는 임계값으로 검정 범위를 조절하세요.
            </div>
          </div>
        </>
      )}

      {/* ── 모양 — 박스 / 선 ── */}
      {(el.type === 'box' || el.type === 'line') && (
        <>
          <div className="ls-sub-title">{el.type === 'box' ? '박스' : '선'}</div>
          <div className="ls-grid-2">
            <Num
              label="가로 (mm)"
              value={el.w_mm}
              min={0.1}
              onChange={(v) => patch({ w_mm: v ?? 1 }, `el:${el.id}:w`)}
            />
            <Num
              label="세로 (mm)"
              value={el.h_mm}
              step={0.1}
              min={0.1}
              onChange={(v) => patch({ h_mm: v ?? 1 }, `el:${el.id}:h`)}
            />
            {el.type === 'box' && (
              <>
                <Num
                  label="선 두께 (mm)"
                  value={el.thickness_mm}
                  step={0.1}
                  min={0.1}
                  onChange={(v) => patch({ thickness_mm: v ?? 0.3 }, `el:${el.id}:th`)}
                />
                <Check
                  label="안쪽 채우기"
                  checked={!!el.filled}
                  onChange={(v) => patch({ filled: v || undefined })}
                />
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
};

export default ElementPropsPanel;
