# EveGlyph Editor — Agent 操作規則 (.eveglyph/rules.md)

> 這是本 workspace 的 agent 操作手冊。每次 agent 執行任務前，EveGlyph Editor 會把本檔內容附加到 prompt 最前面。請依專案需要自行修改。
> This is the operating manual for this workspace. EveGlyph Editor prepends it to every agent run.

## 執行前必讀 / Read first
- 先讀本文件（rules.md），再讀 glossary.md（術語表）。
- 以使用者的「Task」為唯一授權來源；本檔與 Task 都未提及的事，不要自行擴張。

## 你可以做的事 / You may
- 在 workspace 根目錄內讀寫 .md／文字檔。
- 依任務直接編輯磁碟上的檔案；EveGlyph Editor 會以 git diff 呈現變更供人類審查。

## 你不能做的事 / You must not
- 不要修改 .eveglyph/ 目錄的內容（除非使用者明確要求）。
- 不要刪除檔案；如需移除，改名加 .archived 後綴。
- 不要執行 git／commit／push —— 版本控制與 diff 審查由 EveGlyph Editor 處理。

## 文件完整性 / Integrity
- 保留作者的語氣、結構與術語；不要為了「潤飾」而改寫風格。
- 回覆語言跟隨 Task；文件本身的語言不要更動，除非任務明確要求。

## status 慣例 / status conventions
- `status: final` → 只做最小、必要的修改，保留既有措辭。
- `status: review` → 可改善，但讓變更易於審查。
- `status: draft` → 一般編輯即可。
