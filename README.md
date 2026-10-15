# Better Obsidian

Local Obsidian plugin combining optional features. Open **Settings → Better Obsidian** to configure prose wrapping, navigation history, code blocks and clipboard/paste behavior. Smart prose wrapping, code enhancements, LaTeX conversion and list cleanup default to on; code wrapping and line numbers default to off. Changes take effect immediately.

## Smart wrapping for paths and URLs

**Settings → Better Obsidian → 正文排版 → 路径与 URL 智能断行** is enabled by default. Reading view and Live Preview gain display-only break opportunities at directory separators, URL query separators and boundaries in long technical identifiers (underscores, hyphens and camel-case boundaries). If a single component is wider than the whole line, it may break within that component. URL schemes, percent escapes and ordinary English words are preserved. Inline-code paths can wrap; fenced/indented code blocks, math and frontmatter keep their existing behavior. Source mode retains native Markdown layout.

Paragraph alignment remains controlled by the theme, including its two-sided justification switch. This feature adds no characters to the note: Reading view uses removable spans and `<wbr>`, while Live Preview uses editable CodeMirror marks and zero-length widgets. The Markdown source, copied plain text and link destinations stay unchanged. Existing rendered content and editor decorations update immediately when toggled; disabling or unloading removes the generated markup. Popout windows and processed PDF output use the same rules.

## Code blocks (`code-scroll`)

Preserves the former VSCode Code Scroll plugin's functionality:

- One horizontal scrollbar per overflowing Live Preview code block, synchronized across editable lines. Trackpad scrolling and Shift+mouse-wheel are supported.
- Obsidian's bundled Prism grammars provide the same token classification as Reading view, preserving native editing and the configured monospace font.
- Original-line wrappers support line numbers and PDF continuation markers without adding characters to the source or clipboard.
- Line numbers cover the full left inset in Live Preview. Reading-view numbers use native CSS sticky positioning in a shared-width grid, so horizontal scrolling does not depend on JavaScript scroll-event compensation.
- **Settings → Better Obsidian → 代码块** contains the enhancement switch, **代码块自动折行**, and **代码块行号**. Wrapping and numbering require the enhancement switch and default to off. With enhancements enabled, PDF export always wraps and wrapped continuations show return arrows.

Turning this feature off removes the editor decorations and reading wrappers, restores native editor wrapping and leaves clipboard/paste features available. Wrapping/numbering preferences are retained when enhancements are disabled. Code Styler can stay disabled.

The plugin owns horizontal-scroll layout, line-number gutters, wrapping, continuation markers and print layout in `styles.css`; these work without the VSCode theme or Style Settings. The theme owns syntax colors, code-frame appearance, fonts and aesthetic variables. Existing `vscode-code-*` DOM hooks and variables remain stable for theme integration.

On first load, existing `vscode-theme@@vscode-code-wrap` and `vscode-theme@@vscode-code-line-numbers` values are migrated from Style Settings into this plugin's `data.json`, then removed from Style Settings. Existing plugin preferences take precedence on later loads; unrelated theme/plugin settings are preserved.

## Convert LaTeX when copying

Uses the exact delimiter-conversion rules of **Transfer LaTeX from GPT** by Xixia:

- `\( ... \)` → `$...$`
- `\[ ... \]` → `$$...$$`
- Whitespace directly inside the delimiters is trimmed; formulas can span multiple lines. Existing dollar-delimited formulas stay unchanged.

Works with editor copy, Reading-view copy, text inputs and code-block copy buttons, including popout windows. Desktop copy buttons use the Electron clipboard backends so conversion survives Obsidian's window switches; shared backends are wrapped only once and restored on unload. It also converts external plain-text, Markdown and HTML formulas **when pasted into Obsidian**, after native HTML-to-Markdown conversion. The same toggle controls both directions. Internal rich-text copies are not converted again on paste. It does not monitor the system clipboard or change existing notes during copying. Disable the feature to copy/paste original delimiters.

The command **Better Obsidian: 转换当前笔记的 LaTeX 分隔符** preserves the former plugin's explicit whole-note conversion operation. Copying leaves notes intact; pasting changes only the inserted text. The command explicitly converts the current whole note. The standalone `transfer-latex-from-gpt` plugin is disabled after migration; its files are retained.

## Paste plain text into code blocks

Pasting into a code block uses the clipboard's original `text/plain` content, including indentation, empty lines, trailing spaces and LaTeX delimiters. HTML/Markdown conversion, list cleanup and automatic paste formatting are bypassed only for that paste. It works in Live Preview and Source mode, including empty, quoted and list-nested fenced blocks, and indented code. CodeMirror retains selection replacement, multiple cursors and a single undo step; CRLF is normalized to the document's newline convention. Easy Typing receives its plain-paste signal rather than formatting the inserted code. File/attachment pastes keep their native behavior.

This behavior is always active while Better Obsidian is enabled and is independent of the code-enhancement and clipboard-conversion switches. Normal prose keeps the existing HTML and LaTeX conversion behavior.

## Remove extra blank lines on HTML paste

**取消粘贴转换时新增的空行** removes blank separators Obsidian generates **only between sibling unordered/ordered list items** when **Convert pasted HTML to Markdown** is enabled. For example, `<ul><li><p>First</p></li><li><p>Second</p></li></ul>` pastes as `- First\n- Second`, without an empty line between the bullets. Ordinary paragraphs, headings, formulas and code-block boundaries retain their native spacing.

It also removes the extra indented blank line generated at a list's end when followed by an unindented empty line: `3. Last\n    \n\nAAAAA` becomes `3. Last\n\nAAAAA`. The unindented paragraph separator stays intact.

It keeps native HTML conversion and paste/undo handling. Plain text, Markdown copied within Obsidian, explicit `<br>`/empty paragraphs, and necessary list/quote/table boundaries keep their native behavior. Multiple paragraphs inside a single list item retain their separation. The setting takes effect immediately and never rewrites existing notes. Attachment pastes are left to Obsidian.

## Development

Source ownership:

- `src/main.js`: plugin lifecycle, window hooks and editor-extension registration.
- `src/settings.js`: defaults, settings UI and one-time Style Settings migration.
- `src/code-blocks.js`: code-feature activation, window classes and Reading-view processing.
- `src/code-scroll.js`: CodeMirror scrolling, Prism classification and source-line wrappers.
- `src/latex-copy.js`: copy conversion and clipboard backends.
- `src/html-paste.js`: paste conversion and generated list-spacing cleanup.
- `src/technical-text.js`: technical-token detection and preferred break boundaries.
- `src/smart-wrap.js`: Reading-view markup and Live Preview decorations for smart wrapping.
- `styles.css`: code-feature layout, gutters, wrap markers and print behavior.

The bundled `main.js` is the entry point Obsidian loads.

```sh
npm ci
npm run build
npm test
```

Obsidian and CodeMirror remain host-provided dependencies. Settings are stored in this plugin's `data.json`.
