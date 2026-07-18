---
type: note
status: draft
tags: [typst, pdf-export, demo]
---

# Typst PDF 匯出 Demo

點右上角 **PDF** 按鈕，把這份文件即時編譯成真正的排版 PDF（Typst，WASM，完全在
瀏覽器裡跑，不上傳任何內容）。這份文件刻意混雜中英文、數學、清單、表格等，用來
驗證轉換器（`src/typstconvert.js`）跟編譯器（`src/typstexport.js`）在真實內容上
撐不撐得住。

## 文字樣式

一般段落，包含 **粗體**、_斜體_、`行內程式碼`，以及一個
[連結](https://evemisstechnology.com)。中英文混排是 EveGlyph Editor 的日常使用
情境，不是邊緣案例。

## 數學

行內公式 $E = mc^2$，區塊公式：

$$\frac{d}{dx}\left(x^2\right) = 2x$$

$$\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$$

`split` 環境（跟 `aligned` 語意相同）。KaTeX 本身從來不支援 `split` —
Typst 匯出那邊很早就發現這點，把它改寫成 `aligned` 再編譯；但預覽面板這邊
在 roadmap Phase 1 之前完全沒發現，一直靜默失敗到被診斷面板抓到為止。
Phase 2 的 Safe Rewrite 現在把同一個修法搬進了預覽面板本身（`src/math/
rewrite.js`），所以下面這條式子現在**應該會正常渲染**，上方只會出現一則
低調的「已自動正規化」提示，不再是診斷面板的錯誤/警告：

$$\begin{split} a &= b + c \\ &= d + e \end{split}$$

同樣的式子直接寫 `aligned`，效果完全一樣（沒有需要正規化，不會觸發提示）：

$$\begin{aligned} a &= b + c \\ &= d + e \end{aligned}$$

## 清單

- 項目一
- 項目二，含 **粗體**
  - 巢狀項目
- 項目三

1. 第一步：把 Markdown 轉成 Typst 語法
2. 第二步：把 Typst 語法丟給 WASM 編譯器
3. 第三步：拿到真正的 PDF bytes

## 引用

> Typst 不是 LaTeX 的皮膚，是重新設計過的排版語言 —— 編譯快很多，語法也簡單很多。

## 程式碼區塊

```js
import { markdownToTypst } from './typstconvert.js'
import { compileTypstToPdf } from './typstexport.js'

const pdfBytes = await compileTypstToPdf(markdownToTypst(source))
```

## 表格

| 階段 | 內容 | 狀態 |
| --- | --- | --- |
| Phase 1 | WASM 編譯器接線 | 完成 |
| Phase 2 | Markdown → Typst 轉換器 | 完成 |
| Phase 3 | UI 整合 + 這份 Demo | 完成 |

## Callout 區塊

::: definition {title="Typst"}
一個開源的排版系統，語法比 LaTeX 簡單，編譯速度快很多，這裡透過 WASM 在瀏覽器裡
直接跑編譯器本體。
:::

::: warning
這是一個 warning callout，沒有 title——標籤只會顯示型別本身。
:::

::: theorem
中文與英文混排的 theorem callout 測試 mixed-language rendering test。
:::

## AIMD 區塊

::: aimd
@BaseSpace: 符號即時運算驗證系統_v0.1
@State: Dynamic_Flow

> [D_G=1, λ=0.95] 任務：把 AIMD 區塊也轉成 Typst，而不是讓 `:::` 語法原樣漏出來。

[Logic_Node: 0xD442 | expr="2*(3+4) = 14"] 狀態: Verified | 相干度: 1.0 | 驗證器: formula

[Logic_Node: 0xE001 | expr="∇·E = ρ/ε₀"] 狀態: ? | 相干度: ? | 驗證器: lean4

<Coupling Node: ⋈>
Target: LBRAT.Phenomenal_Weight <---> UI.Rendering_Resolution
Action: 將 ρ 與 q 分離，實作前端模糊實在狀態。PDF 是靜態輸出，所以這裡直接把
Coupling Node 的內容印出來，不做摺疊。
</Coupling>
:::

---

以上。中文字型已經接上 Noto Serif TC（正體中文），callout 跟 AIMD 區塊也都轉成
真正的 Typst 排版，不再是原樣漏出的 `:::` 語法。
