# OCME MVP — EveGlyph integration example

開源中文數學百科的最小垂直切片，示範「畢達哥拉斯定理」如何同時提供：

- Canonical Mathematical Knowledge Object（`mko.json`）
- 原生 MathML 人類閱讀介面
- MCP AI 取用工具
- Python 有限計算伴隨
- FELRA 有限驗證規格
- 數學—程式非同一性聲明

核心界線：

$$
\text{數學}\neq\text{程式}\neq\text{有限計算證據}\neq\text{形式證明}
$$

## 網站

```bash
npm start
```

開啟 `http://127.0.0.1:4173`。網站端不需安裝第三方套件。

## 計算伴隨

```bash
npm run verify
```

它會在 $1\ldots200$ 的有限整數域中列舉畢氏三元組。這不是定理的普遍證明。

## MCP

```bash
npm install
npm run mcp
```

工具：`search_math_objects`、`get_math_object`、`get_computational_companion`、`get_verification_status`。

## FELRA

```bash
felra run felra/project.yaml --output artifacts/felra
```

本目錄是獨立 MVP 範例，不改動 EveGlyph 核心執行路徑。
