---
type: article
status: final
tags: [welcome, eveglyph-md, getting-started]
---

# Welcome to EveGlyph Editor

You're looking at an **EveGlyph-MD** document. The block above (`type` / `status` /
`tags`) is *frontmatter* — a small, semantic classification layer. Open the **Preview**
tab (🔍 is search; the leftmost tab is Preview) to see it rendered as badges, and click
the status-bar chip to change the document's class.

> The north star: **you write clean Markdown · local agents edit on disk · every change
> lands as a reviewable git diff you Accept or Reject.**

## What renders here

Standard Markdown, plus a few extras:

- **Math** via KaTeX — inline like $e^{i\pi} + 1 = 0$, or display:

$$
\nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}
$$

- **Callout blocks** with `::: type … :::`:

::: note {title="Try the loop"}
Set **Settings ⚙ → AI Provider → Local Agent (CLI)**, point it at *this* `examples/`
folder, then ask an agent to edit a file. You'll review its work as a diff before
anything is kept.
:::

::: warning {title="Local-agent mode"}
A local CLI agent runs with **auto-approve** and can create, edit, and delete files in
the folder you open. Read **SECURITY.md** first, and only point it at folders you trust.
:::

## 多語系 / CJK

EveGlyph Editor 在編輯、預覽、agent 串流輸出時都以 UTF-8 處理，並會偵測並保留
Big5 / GBK / Shift-JIS 等既有編碼。這一段中文就是用來確認 **CJK 在預覽與 agent
輸出中不會變成亂碼**。

## Where things live

| You want to… | Go to |
| --- | --- |
| Search & replace in this file | `Ctrl+F` (in the editor) |
| Search across the workspace | the 🔍 tab |
| Change the document class | the status-bar chip, or Frontmatter menu |
| Configure an AI provider | Settings ⚙ |
| See the diagnostic stream | the ◷ Monitor tab |

Open **the-eveglyph-loop.md** next to try an agent edit.
