var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/code-scroll.js
var require_code_scroll = __commonJS({
  "src/code-scroll.js"(exports2, module2) {
    var { editorLivePreviewField } = require("obsidian");
    var { StateField } = require("@codemirror/state");
    var { Decoration, EditorView: EditorView2, ViewPlugin, WidgetType } = require("@codemirror/view");
    var { syntaxTree, foldedRanges } = require("@codemirror/language");
    function livePreview(state) {
      return state.field(editorLivePreviewField, false) === true;
    }
    function codeBlocks(state) {
      if (!livePreview(state)) return [];
      const starts = /* @__PURE__ */ new Set();
      syntaxTree(state).iterate({
        enter(node) {
          if (node.name === "FencedCode" || node.name.includes("HyperMD-codeblock-begin")) {
            starts.add(state.doc.lineAt(node.from).number);
          }
        }
      });
      const blocks = [];
      for (const number of starts) {
        const opening = state.doc.line(number);
        const fence = opening.text.match(/(`{3,}|~{3,})/);
        if (!fence) continue;
        let closing = null;
        for (let i = number + 1; i <= state.doc.lines; i++) {
          const line = state.doc.line(i);
          const match = line.text.match(/^[\s>]*(`{3,}|~{3,})\s*$/);
          if (match && match[1][0] === fence[1][0] && match[1].length >= fence[1].length) {
            closing = line;
            break;
          }
        }
        if (!closing || closing.number === number + 1) continue;
        let folded = false;
        foldedRanges(state).between(opening.to, closing.to, () => {
          folded = true;
        });
        if (!folded) blocks.push({ from: opening.from, to: closing.to, first: number + 1, last: closing.number - 1 });
      }
      return blocks.sort((a, b) => a.from - b.from);
    }
    function editorExtension() {
      let controller;
      class Scrollbar extends WidgetType {
        constructor(block) {
          super();
          this.block = block;
        }
        eq(other) {
          return this.block.from === other.block.from && this.block.to === other.block.to;
        }
        toDOM(view) {
          const bar = document.createElement("div");
          bar.className = "vscode-code-scrollbar";
          bar.dataset.vscodeCodeBlock = String(this.block.from);
          bar.tabIndex = -1;
          bar.setAttribute("aria-hidden", "true");
          bar.setAttribute("role", "region");
          const track = document.createElement("div");
          track.className = "vscode-code-scroll-track";
          bar.appendChild(track);
          bar.addEventListener("scroll", () => {
            view.plugin(controller)?.scroll(this.block.from, bar.scrollLeft);
          });
          return bar;
        }
        get estimatedHeight() {
          return 0;
        }
      }
      function build(state) {
        const blocks = codeBlocks(state);
        const decorations = [];
        for (const block of blocks) {
          for (let i = block.first; i <= block.last; i++) {
            decorations.push(Decoration.line({ attributes: {
              class: "vscode-code-scroll-line",
              "data-vscode-code-block": String(block.from),
              "data-vscode-code-line-number": String(i - block.first + 1),
              style: `--vscode-code-number-width: ${Math.max(2, String(block.last - block.first + 1).length)}ch`
            } }).range(state.doc.line(i).from));
          }
          decorations.push(Decoration.widget({ widget: new Scrollbar(block), side: 1 }).range(block.to));
        }
        return { blocks, decorations: Decoration.set(decorations, true) };
      }
      const field = StateField.define({
        create: build,
        update(value, transaction) {
          if (transaction.docChanged || syntaxTree(transaction.state) !== syntaxTree(transaction.startState) || livePreview(transaction.state) !== livePreview(transaction.startState) || foldedRanges(transaction.state) !== foldedRanges(transaction.startState)) {
            return build(transaction.state);
          }
          return value;
        },
        provide: (field2) => EditorView2.decorations.from(field2, (value) => value.decorations)
      });
      controller = ViewPlugin.fromClass(class {
        constructor(view) {
          this.view = view;
          this.offsets = /* @__PURE__ */ new Map();
          this.widths = /* @__PURE__ */ new Map();
          this.scrollRanges = /* @__PURE__ */ new Map();
          this.revealCursor = false;
          this.canvas = document.createElement("canvas");
          this.context = this.canvas.getContext("2d");
          this.resizeObserver = new ResizeObserver(() => this.measure());
          this.resizeObserver.observe(view.dom);
          this.measure();
          this.fontListener = () => {
            this.widths.clear();
            this.measure();
          };
          document.fonts?.addEventListener("loadingdone", this.fontListener);
          this.appearanceObserver = new MutationObserver(this.fontListener);
          this.appearanceObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
          this.contentObserver = new MutationObserver(() => this.measure());
          this.contentObserver.observe(view.contentDOM, { childList: true, subtree: true });
          this.wheelListener = (event) => this.wheel(event);
          view.scrollDOM.addEventListener("wheel", this.wheelListener, { passive: false });
        }
        update(update) {
          if (update.docChanged) {
            this.offsets = new Map([...this.offsets].map(([from, offset]) => [update.changes.mapPos(from), offset]));
            this.widths.clear();
            this.scrollRanges.clear();
          }
          if (update.selectionSet) this.revealCursor = true;
          if (update.docChanged || update.viewportChanged || update.geometryChanged || update.selectionSet || update.startState.field(field) !== update.state.field(field)) this.measure();
        }
        scroll(from, offset) {
          this.offsets.set(from, offset);
          for (const line of this.view.contentDOM.querySelectorAll(".vscode-code-scroll-line")) {
            if (Number(line.dataset.vscodeCodeBlock) === from) {
              line.scrollLeft = offset;
              line.style.setProperty("--vscode-code-scroll-offset", `${line.scrollLeft}px`);
            }
          }
          for (const bar of this.view.contentDOM.querySelectorAll(".vscode-code-scrollbar")) {
            if (Number(bar.dataset.vscodeCodeBlock) === from) bar.scrollLeft = offset;
          }
          this.view.requestMeasure();
        }
        wheel(event) {
          if (event.defaultPrevented || event.ctrlKey || !livePreview(this.view.state) || this.view.dom.ownerDocument.body.classList.contains("better-obsidian-code-wrap")) return;
          const shifted = event.shiftKey && event.deltaX === 0;
          const delta = shifted ? event.deltaY : event.deltaX;
          if (!delta || !shifted && Math.abs(event.deltaX) < Math.abs(event.deltaY)) return;
          const blocks = this.view.state.field(field).blocks;
          const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
          const element = target?.closest(".vscode-code-scroll-line, .vscode-code-scrollbar");
          let block = element && this.view.contentDOM.contains(element) ? blocks.find((block2) => block2.from === Number(element.dataset.vscodeCodeBlock)) : null;
          if (!block) {
            const position = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (position != null) block = blocks.find((block2) => position >= block2.from && position <= block2.to);
          }
          if (!block && this.view.hasFocus) {
            const head = this.view.state.selection.main.head;
            block = blocks.find((block2) => head >= block2.from && head <= block2.to);
          }
          if (!block) return;
          const range = this.scrollRanges.get(block.from);
          if (!range || range.max <= 1) return;
          let pixels = delta;
          if (event.deltaMode === 1) {
            const style = getComputedStyle(element || this.view.contentDOM);
            pixels *= parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.65;
          } else if (event.deltaMode === 2) pixels *= range.viewport;
          const next = Math.max(0, Math.min(range.max, (this.offsets.get(block.from) || 0) + pixels));
          event.preventDefault();
          this.scroll(block.from, next);
        }
        measure() {
          this.view.requestMeasure({
            key: this,
            read: (view) => {
              const result = [];
              const lines = [...view.contentDOM.querySelectorAll(".vscode-code-scroll-line")];
              for (const block of view.state.field(field).blocks) {
                const visible = lines.filter((line) => Number(line.dataset.vscodeCodeBlock) === block.from);
                if (!visible.length) continue;
                const style = getComputedStyle(visible[0]);
                const wrapping = view.dom.ownerDocument.body.classList.contains("better-obsidian-code-wrap");
                const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                const tabSize = parseInt(style.tabSize, 10) || 4;
                const key = `${block.from}:${block.to}:${font}:${tabSize}:${style.letterSpacing}`;
                let width = this.widths.get(key);
                if (width == null && !wrapping) {
                  this.context.font = font;
                  const space = this.context.measureText(" ").width;
                  const spacing = parseFloat(style.letterSpacing) || 0;
                  width = 0;
                  for (let i = block.first; i <= block.last; i++) {
                    let length = 0;
                    for (const part of view.state.doc.line(i).text.split(/(\t)/)) {
                      if (part === "	") length = (Math.floor(length / (space * tabSize)) + 1) * space * tabSize;
                      else length += this.context.measureText(part).width + [...part].length * spacing;
                    }
                    width = Math.max(width, length);
                  }
                  width += parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2;
                  this.widths.set(key, width);
                }
                const viewport = visible[0].clientWidth;
                if (wrapping) width = viewport;
                const bar = [...view.contentDOM.querySelectorAll(".vscode-code-scrollbar")].find((bar2) => Number(bar2.dataset.vscodeCodeBlock) === block.from);
                let offset = Math.min(this.offsets.get(block.from) || 0, Math.max(0, width - viewport));
                if (this.revealCursor && !wrapping) {
                  const head = view.state.selection.main.head;
                  const cursorLine = view.state.doc.lineAt(head);
                  if (cursorLine.number >= block.first && cursorLine.number <= block.last) {
                    const coords = view.coordsAtPos(head);
                    const line = visible.find((line2) => view.posAtDOM(line2) === cursorLine.from);
                    if (coords && line) {
                      const rect = line.getBoundingClientRect();
                      const cursorX = coords.left - rect.left + line.scrollLeft;
                      if (cursorX > offset + viewport - 16) offset = Math.min(width - viewport, cursorX - viewport + 24);
                      if (cursorX < offset + 8) offset = Math.max(0, cursorX - 16);
                    }
                  }
                }
                result.push({ block, visible, bar, width, viewport, offset: Math.max(0, offset) });
              }
              return result;
            },
            write: (result) => {
              this.revealCursor = false;
              let heightChanged = false;
              for (const { block, visible, bar, width, viewport, offset } of result) {
                this.scrollRanges.set(block.from, { max: Math.max(0, width - viewport), viewport });
                for (const line of visible) {
                  line.style.setProperty("--vscode-code-scroll-width", `${width}px`);
                  line.scrollLeft = offset;
                  line.style.setProperty("--vscode-code-scroll-offset", `${line.scrollLeft}px`);
                }
                this.offsets.set(block.from, offset);
                if (bar) {
                  const overflowing = width > viewport + 1;
                  if (bar.classList.contains("is-overflowing") !== overflowing) heightChanged = true;
                  bar.classList.toggle("is-overflowing", overflowing);
                  bar.tabIndex = overflowing ? 0 : -1;
                  bar.setAttribute("aria-hidden", String(!overflowing));
                  bar.firstElementChild.style.width = `${width}px`;
                  bar.scrollLeft = offset;
                }
              }
              if (heightChanged) this.view.requestMeasure();
            }
          });
        }
        destroy() {
          this.view.scrollDOM.removeEventListener("wheel", this.wheelListener);
          this.resizeObserver.disconnect();
          this.appearanceObserver.disconnect();
          this.contentObserver.disconnect();
          document.fonts?.removeEventListener("loadingdone", this.fontListener);
        }
      });
      return [field, controller];
    }
    function prismHighlighting(prism) {
      let cache = /* @__PURE__ */ new Map();
      function build(state) {
        const decorations = [];
        const nextCache = /* @__PURE__ */ new Map();
        for (const block of codeBlocks(state)) {
          const opening = state.doc.lineAt(block.from).text;
          const fence = opening.match(/(`{3,}|~{3,})/);
          const info = opening.slice(fence.index + fence[0].length).trim().split(/\s+/)[0].toLowerCase();
          const language = /^[\w-]+$/.test(info) ? info : "plain";
          let container = opening.slice(0, fence.index);
          const quotes = (container.match(/>/g) || []).length;
          for (let i = 0; i < quotes; i++) container = container.replace(/^[\t ]*>[\t ]?/, "");
          const lines = [];
          let source = "";
          for (let i = block.first; i <= block.last; i++) {
            const line = state.doc.line(i);
            let text = line.text;
            for (let q = 0; q < quotes; q++) text = text.replace(/^[\t ]*>[\t ]?/, "");
            const indent = Math.min(container.length, text.match(/^[\t ]*/)[0].length);
            text = text.slice(indent);
            lines.push({ from: line.to - text.length, start: source.length, end: source.length + text.length });
            source += text + (i < block.last ? "\n" : "");
            decorations.push(Decoration.line({ attributes: {
              class: `vscode-prism-code language-${language}`
            } }).range(line.from));
          }
          const key = language + "\0" + source;
          let ranges = cache.get(key);
          if (!ranges) {
            let visit2 = function(value, offset) {
              if (typeof value === "string") return offset + value.length;
              if (Array.isArray(value)) {
                for (const child of value) offset = visit2(child, offset);
                return offset;
              }
              const classes = ["token", value.type, ...[].concat(value.alias || [])].join(" ");
              const range = { from: offset, to: offset, classes };
              ranges.push(range);
              range.to = visit2(value.content, offset);
              return range.to;
            };
            var visit = visit2;
            ranges = [];
            const grammar = prism.languages[language];
            if (grammar) visit2(prism.tokenize(source, grammar), 0);
          }
          nextCache.set(key, ranges);
          for (const token of ranges) {
            let low = 0, high = lines.length;
            while (low < high) {
              const mid = low + high >> 1;
              if (lines[mid].end <= token.from) low = mid + 1;
              else high = mid;
            }
            for (let i = low; i < lines.length && lines[i].start < token.to; i++) {
              const line = lines[i];
              const start = Math.max(token.from, line.start);
              const end = Math.min(token.to, line.end);
              if (end > start) decorations.push(Decoration.mark({ class: token.classes }).range(line.from + start - line.start, line.from + end - line.start));
            }
          }
        }
        cache = nextCache;
        return Decoration.set(decorations, true);
      }
      return StateField.define({
        create: build,
        update(value, transaction) {
          return transaction.docChanged || syntaxTree(transaction.state) !== syntaxTree(transaction.startState) || livePreview(transaction.state) !== livePreview(transaction.startState) || foldedRanges(transaction.state) !== foldedRanges(transaction.startState) ? build(transaction.state) : value;
        },
        provide: (field) => EditorView2.decorations.from(field)
      });
    }
    function syncCodeGutter(code) {
      const lines = code.querySelectorAll(":scope > .vscode-code-print-line");
      code.style.setProperty("--vscode-code-number-width", `${Math.max(2, String(lines.length).length)}ch`);
    }
    function prepareCodeLines(code) {
      if (code.querySelector(":scope > .vscode-code-print-line")) {
        syncCodeGutter(code);
        return;
      }
      const doc = code.ownerDocument;
      const walker = doc.createTreeWalker(
        code,
        4
        /* SHOW_TEXT */
      );
      const breaks = [];
      let node;
      while (node = walker.nextNode()) {
        let offset = -1;
        while ((offset = node.data.indexOf("\n", offset + 1)) !== -1) breaks.push({ node, offset });
      }
      const fragment = doc.createDocumentFragment();
      let number = 0;
      function appendLine() {
        const line = doc.createElement("span");
        line.className = "vscode-code-print-line";
        line.dataset.vscodeCodeLineNumber = String(++number);
        line.append(range.cloneContents());
        fragment.append(line);
      }
      const range = doc.createRange();
      range.setStart(code, 0);
      for (const { node: node2, offset } of breaks) {
        range.setEnd(node2, offset);
        appendLine();
        const newline = doc.createElement("span");
        newline.className = "vscode-code-line-break";
        newline.textContent = "\n";
        fragment.append(newline);
        range.setStart(node2, offset + 1);
      }
      range.setEnd(code, code.childNodes.length);
      if (range.toString().length || !breaks.length) {
        appendLine();
      }
      code.replaceChildren(fragment);
      syncCodeGutter(code);
    }
    function restoreCodeLines(code) {
      for (const line of code.querySelectorAll(":scope > .vscode-code-print-line, :scope > .vscode-code-line-break")) {
        line.replaceWith(...line.childNodes);
      }
      code.style.removeProperty("--vscode-code-number-width");
      code.style.removeProperty("--vscode-code-scroll-offset");
    }
    module2.exports = {
      createEditorExtensions: (prism) => [editorExtension(), prismHighlighting(prism)],
      prepareCodeLines,
      restoreCodeLines
    };
  }
});

// src/code-blocks.js
var require_code_blocks = __commonJS({
  "src/code-blocks.js"(exports2, module2) {
    var { loadPrism } = require("obsidian");
    var codeScroll = require_code_scroll();
    var BODY_CLASSES = [
      "better-obsidian-code-enabled",
      "better-obsidian-code-wrap",
      "better-obsidian-code-line-numbers"
    ];
    var CodeBlocks2 = class {
      constructor(plugin) {
        this.plugin = plugin;
        this.extensions = [];
      }
      async load() {
        const prism = await loadPrism();
        if (!this.plugin.active) return;
        this.extensions = codeScroll.createEditorExtensions(prism);
        this.plugin.registerMarkdownPostProcessor(async (element) => {
          if (!this.plugin.active || !this.plugin.settings.codeScrollEnabled) return;
          await loadPrism();
          if (!this.plugin.active || !this.plugin.settings.codeScrollEnabled) return;
          for (const code of element.querySelectorAll("pre > code")) codeScroll.prepareCodeLines(code);
        }, 200);
      }
      attachWindow(win) {
        const settings = this.plugin.settings;
        win.document.body.classList.remove("vscode-code-wrap", "vscode-code-line-numbers", "better-obsidian-code-scroll-disabled");
        win.document.body.classList.toggle(BODY_CLASSES[0], settings.codeScrollEnabled);
        win.document.body.classList.toggle(BODY_CLASSES[1], settings.codeScrollEnabled && settings.codeWrapEnabled);
        win.document.body.classList.toggle(BODY_CLASSES[2], settings.codeScrollEnabled && settings.codeLineNumbersEnabled);
      }
      detachWindow(win) {
        if (!win) return;
        for (const code of win.document.querySelectorAll(".markdown-rendered pre > code")) codeScroll.restoreCodeLines(code);
        win.document.body.classList.remove(...BODY_CLASSES);
      }
      apply() {
        for (const win of this.plugin.windowCleanups.keys()) {
          this.attachWindow(win);
          for (const code of win.document.querySelectorAll(".markdown-rendered pre > code")) {
            if (this.plugin.settings.codeScrollEnabled) codeScroll.prepareCodeLines(code);
            else codeScroll.restoreCodeLines(code);
          }
        }
        this.plugin.refreshEditorExtensions();
        this.plugin.app.workspace.trigger("post-processor-change");
      }
    };
    module2.exports = { CodeBlocks: CodeBlocks2 };
  }
});

// src/settings.js
var require_settings = __commonJS({
  "src/settings.js"(exports2, module2) {
    var { PluginSettingTab, Setting } = require("obsidian");
    var DEFAULT_SETTINGS = {
      codeScrollEnabled: true,
      codeWrapEnabled: false,
      codeLineNumbersEnabled: false,
      copyLatexEnabled: true,
      compactHtmlPasteEnabled: true,
      navigationHistoryEnabled: true,
      navigationHistoryPersist: true,
      navigationHistoryLimit: 100
    };
    var LEGACY_SETTINGS = {
      "vscode-theme@@vscode-code-wrap": "codeWrapEnabled",
      "vscode-theme@@vscode-code-line-numbers": "codeLineNumbersEnabled"
    };
    async function loadSettings2(plugin) {
      const saved = await plugin.loadData() || {};
      const settings = Object.assign({}, DEFAULT_SETTINGS, saved);
      const manager = plugin.app.plugins?.plugins["obsidian-style-settings"]?.settingsManager;
      const adapter = plugin.app.vault?.adapter;
      const path = `${plugin.app.vault?.configDir || ".obsidian"}/plugins/obsidian-style-settings/data.json`;
      let legacy = manager?.settings;
      if (!legacy && adapter?.exists && await adapter.exists(path)) legacy = JSON.parse(await adapter.read(path));
      let cleaned = false;
      for (const [oldKey, newKey] of Object.entries(LEGACY_SETTINGS)) {
        if (!Object.hasOwn(legacy || {}, oldKey)) continue;
        if (!Object.hasOwn(saved, newKey) && typeof legacy[oldKey] === "boolean") settings[newKey] = legacy[oldKey];
        cleaned = true;
      }
      if (cleaned || Object.keys(DEFAULT_SETTINGS).some((key) => !Object.hasOwn(saved, key))) await plugin.saveData(settings);
      if (cleaned) {
        for (const oldKey of Object.keys(LEGACY_SETTINGS)) delete legacy[oldKey];
        if (manager) {
          await manager.save();
          manager.removeClasses();
          manager.initClasses();
        } else {
          await adapter.write(path, JSON.stringify(legacy, null, 2));
        }
      }
      return settings;
    }
    var BetterObsidianSettings2 = class extends PluginSettingTab {
      constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
      }
      toggle(name, description, key) {
        return new Setting(this.containerEl).setName(name).setDesc(description).addToggle((toggle) => toggle.setValue(this.plugin.settings[key]).onChange((value) => this.plugin.setFeature(key, value)));
      }
      display() {
        this.containerEl.empty();
        new Setting(this.containerEl).setName("\u5BFC\u822A\u5386\u53F2").setHeading();
        this.toggle("\u7B14\u8BB0\u5185\u4F4D\u7F6E\u524D\u8FDB\uFF0F\u540E\u9000", "\u8BB0\u5F55\u6807\u9898\uFF0F\u5757\u94FE\u63A5\u3001\u5927\u7EB2\u3001\u641C\u7D22\u3001\u70B9\u51FB\u7F16\u8F91\u884C\u548C\u8F83\u5927\u7684\u5149\u6807\u6216\u6EDA\u52A8\u8DF3\u8F6C\u3002\u76F4\u63A5\u4F7F\u7528\u9876\u90E8\u7BAD\u5934\u53CA\u539F\u751F Navigate back\uFF0Fforward \u547D\u4EE4\u4E0E\u5FEB\u6377\u952E\uFF0C\u65E0\u9700\u5355\u72EC\u7ED1\u5B9A\u63D2\u4EF6\u547D\u4EE4\u3002\u6BCF\u4E2A\u6807\u7B7E\u9875\u5206\u522B\u8BB0\u5F55\uFF0C\u9ED8\u8BA4\u5F00\u542F\u3002", "navigationHistoryEnabled");
        this.toggle("\u91CD\u542F\u540E\u4FDD\u7559\u5BFC\u822A\u5386\u53F2", "\u4FDD\u5B58\u6BCF\u4E2A\u6807\u7B7E\u9875\u7684\u7B14\u8BB0\u8DEF\u5F84\u3001\u5149\u6807\u548C\u6EDA\u52A8\u4F4D\u7F6E\uFF0C\u4E0D\u4FDD\u5B58\u7B14\u8BB0\u6B63\u6587\u3002\u9ED8\u8BA4\u5F00\u542F\u3002", "navigationHistoryPersist");
        new Setting(this.containerEl).setName("\u6BCF\u4E2A\u65B9\u5411\u7684\u5386\u53F2\u6570\u91CF\u4E0A\u9650").setDesc("\u6BCF\u4E2A\u6807\u7B7E\u9875\u6700\u591A\u4FDD\u7559\u591A\u5C11\u4E2A\u5386\u53F2\u4F4D\u7F6E\uFF1B20\u2013500\uFF0C\u9ED8\u8BA4 100\u3002").addSlider((slider) => slider.setLimits(20, 500, 10).setValue(this.plugin.settings.navigationHistoryLimit).setDynamicTooltip().onChange((value) => this.plugin.setFeature("navigationHistoryLimit", value)));
        new Setting(this.containerEl).setName("\u4EE3\u7801\u5757").setHeading();
        this.toggle("\u4EE3\u7801\u5757\u589E\u5F3A\uFF08code-scroll\uFF09", "\u542F\u7528\u5B9E\u65F6\u9884\u89C8\u4EE3\u7801\u5757\u6A2A\u5411\u6EDA\u52A8\u3001\u4E0E\u9605\u8BFB\u89C6\u56FE\u4E00\u81F4\u7684\u9AD8\u4EAE\u53CA PDF \u6298\u884C\u6807\u8BB0\u3002\u4EE3\u7801\u914D\u8272\u4E0E\u5B57\u4F53\u7531\u5F53\u524D\u4E3B\u9898\u548C Obsidian \u5916\u89C2\u8BBE\u7F6E\u63D0\u4F9B\u3002\u9ED8\u8BA4\u5F00\u542F\u3002", "codeScrollEnabled");
        this.toggle("\u4EE3\u7801\u5757\u81EA\u52A8\u6298\u884C", "\u5728\u5B9E\u65F6\u9884\u89C8\u548C\u9605\u8BFB\u89C6\u56FE\u4E2D\u6298\u884C\uFF0C\u53EF\u65AD\u5F00\u957F\u8BCD\u548C\u8DEF\u5F84\uFF1B\u5173\u95ED\u65F6\u6A2A\u5411\u6EDA\u52A8\u3002PDF \u5BFC\u51FA\u59CB\u7EC8\u6298\u884C\u3002\u9700\u8981\u5F00\u542F\u4EE3\u7801\u5757\u589E\u5F3A\uFF0C\u9ED8\u8BA4\u5173\u95ED\u3002", "codeWrapEnabled");
        this.toggle("\u4EE3\u7801\u5757\u884C\u53F7", "\u5728\u5B9E\u65F6\u9884\u89C8\u3001\u9605\u8BFB\u89C6\u56FE\u53CA PDF \u4E2D\u663E\u793A\u884C\u53F7\uFF0C\u6BCF\u4E2A\u4EE3\u7801\u5757\u4ECE 1 \u5F00\u59CB\uFF1B\u7A7A\u884C\u8BA1\u6570\uFF0C\u6298\u884C\u7EED\u884C\u4E0D\u91CD\u590D\u7F16\u53F7\u3002\u9700\u8981\u5F00\u542F\u4EE3\u7801\u5757\u589E\u5F3A\uFF0C\u9ED8\u8BA4\u5173\u95ED\u3002", "codeLineNumbersEnabled");
        new Setting(this.containerEl).setName("\u526A\u8D34\u677F\u4E0E\u7C98\u8D34").setHeading();
        this.toggle("\u590D\u5236\u65F6\u8F6C\u6362 LaTeX", "\u590D\u5236\u6216\u7C98\u8D34\u5916\u90E8\u5185\u5BB9\u65F6\uFF0C\u5C06 \\(\u2026\\) \u8F6C\u4E3A $\u2026$\u3001\\[\u2026\\] \u8F6C\u4E3A $$\u2026$$\u3002\u652F\u6301\u7F16\u8F91\u533A\u3001\u9605\u8BFB\u89C6\u56FE\u3001\u4EE3\u7801\u5757\u590D\u5236\u6309\u94AE\u53CA\u5916\u90E8\u7EAF\u6587\u672C\uFF0FHTML \u7C98\u8D34\u3002\u9ED8\u8BA4\u5F00\u542F\u3002", "copyLatexEnabled");
        this.toggle("\u53D6\u6D88\u7C98\u8D34\u8F6C\u6362\u65F6\u65B0\u589E\u7684\u7A7A\u884C", "\u5F00\u542F Obsidian \u7684\u201C\u7C98\u8D34\u65F6\u5C06 HTML \u8F6C\u6362\u4E3A Markdown\u201D\u65F6\uFF0C\u53BB\u6389\u5217\u8868\u9879\u4E4B\u95F4\u53CA\u5217\u8868\u672B\u5C3E\u81EA\u52A8\u65B0\u589E\u7684\u7F29\u8FDB\u7A7A\u884C\uFF0C\u4FDD\u7559\u5217\u8868\u540E\u65E0\u7F29\u8FDB\u7684\u6BB5\u843D\u5206\u9694\u7A7A\u884C\u3002\u666E\u901A\u6BB5\u843D\u548C\u540C\u4E00\u5217\u8868\u9879\u5185\u7684\u6BB5\u843D\u95F4\u8DDD\u4FDD\u6301\u539F\u751F\u884C\u4E3A\u3002\u9ED8\u8BA4\u5F00\u542F\u3002", "compactHtmlPasteEnabled");
      }
    };
    module2.exports = { DEFAULT_SETTINGS, loadSettings: loadSettings2, BetterObsidianSettings: BetterObsidianSettings2 };
  }
});

// src/latex-copy.js
var require_latex_copy = __commonJS({
  "src/latex-copy.js"(exports2, module2) {
    function convertLatexSyntax2(content) {
      return content.replace(/\\\(\s*(.*?)\s*\\\)/gs, (_, formula) => `$${formula.trim()}$`).replace(/\\\[\s*(.*?)\s*\\\]/gs, (_, formula) => `$$${formula.trim()}$$`);
    }
    function selectionText(win) {
      const input = win.document.activeElement;
      if (typeof input?.value === "string" && typeof input.selectionStart === "number") {
        return input.value.slice(input.selectionStart, input.selectionEnd);
      }
      return win.getSelection()?.toString() || "";
    }
    function installClipboardWriter(plugin, clipboard) {
      if (!clipboard?.writeText) return () => {
      };
      plugin.clipboardHooks ||= /* @__PURE__ */ new Map();
      let hook = plugin.clipboardHooks.get(clipboard);
      if (!hook) {
        const descriptor = Object.getOwnPropertyDescriptor(clipboard, "writeText");
        const original = clipboard.writeText;
        const wrapped = function(text, ...args) {
          const enabled = plugin.active && plugin.settings.copyLatexEnabled;
          return original.call(this, enabled && typeof text === "string" ? convertLatexSyntax2(text) : text, ...args);
        };
        Object.defineProperty(clipboard, "writeText", { configurable: true, writable: true, value: wrapped });
        hook = { descriptor, wrapped, users: 0 };
        plugin.clipboardHooks.set(clipboard, hook);
      }
      hook.users++;
      return () => {
        if (--hook.users) return;
        if (clipboard.writeText === hook.wrapped) {
          if (hook.descriptor) Object.defineProperty(clipboard, "writeText", hook.descriptor);
          else delete clipboard.writeText;
        }
        plugin.clipboardHooks.delete(clipboard);
      };
    }
    function installLatexCopy2(plugin, win) {
      const enabled = () => plugin.active && plugin.settings.copyLatexEnabled;
      const onCopyStart = (event) => {
        if (!enabled()) return;
        plugin.currentCopyEvent = event;
        queueMicrotask(() => {
          if (plugin.currentCopyEvent === event) plugin.currentCopyEvent = null;
        });
      };
      const onCopy = (event) => {
        if (!enabled() || !event.clipboardData) return;
        if (plugin.convertedCopyEvents.has(event)) return;
        const source = event.clipboardData.getData("text/plain") || selectionText(win);
        const converted = convertLatexSyntax2(source);
        if (converted === source) return;
        event.clipboardData.setData("text/plain", converted);
        event.clipboardData.clearData("text/html");
        event.preventDefault();
      };
      win.document.addEventListener("copy", onCopyStart, true);
      win.document.addEventListener("copy", onCopy);
      let backends = [];
      if (typeof win.require === "function") {
        try {
          const electron = win.require("electron");
          backends = [.../* @__PURE__ */ new Set([electron.clipboard, electron.remote?.clipboard])].filter((clipboard) => typeof clipboard?.writeText === "function");
        } catch (_) {
        }
      }
      if (!backends.length) backends = [win.navigator.clipboard];
      const restoreWriters = backends.map((clipboard) => installClipboardWriter(plugin, clipboard));
      return () => {
        win.document.removeEventListener("copy", onCopyStart, true);
        win.document.removeEventListener("copy", onCopy);
        for (const restore of restoreWriters) restore();
      };
    }
    module2.exports = { convertLatexSyntax: convertLatexSyntax2, installLatexCopy: installLatexCopy2, installClipboardWriter };
  }
});

// src/html-paste.js
var require_html_paste = __commonJS({
  "src/html-paste.js"(exports2, module2) {
    var { htmlToMarkdown, sanitizeHTMLToDom } = require("obsidian");
    var { EditorState } = require("@codemirror/state");
    var { EditorView: EditorView2 } = require("@codemirror/view");
    var { syntaxTree } = require("@codemirror/language");
    var { convertLatexSyntax: convertLatexSyntax2 } = require_latex_copy();
    var BLOCK_ELEMENTS = "p, h1, h2, h3, h4, h5, h6, pre, ul, ol, table, blockquote, hr";
    function inCodeBlock(state, at) {
      const line = state.doc.lineAt(at);
      for (let node = syntaxTree(state).resolveInner(at, 1); node; node = node.parent) {
        if (node.name === "CodeBlock" || node.name.includes("hmd-indented-code")) return true;
        if (node.name === "FencedCode") {
          const opening = state.doc.lineAt(node.from);
          const closing = state.doc.lineAt(node.to);
          return line.number > opening.number && (line.number < closing.number || !/^[\s>]*(`{3,}|~{3,})\s*$/.test(closing.text));
        }
        if (node.name.includes("HyperMD-codeblock") && !/-(begin|end)/.test(node.name)) return true;
      }
      let fence = null;
      for (let n = 1; n <= line.number; n++) {
        const text = state.doc.line(n).text;
        const quote = text.match(/^(?:[\t ]*>[\t ]?)+/)?.[0] || "";
        const depth = (quote.match(/>/g) || []).length;
        const source = text.slice(quote.length);
        if (fence && depth < fence.depth) fence = null;
        if (fence) {
          const closing = source.match(/^[\t ]*(`{3,}|~{3,})[\t ]*$/);
          if (closing && closing[1][0] === fence.marker[0] && closing[1].length >= fence.marker.length) {
            if (n === line.number) return false;
            fence = null;
          }
        } else {
          const match = source.match(/^[\t ]{0,3}(?:(?:[-+*]|\d+[.)])[\t ]+)?(`{3,}|~{3,})(.*)$/);
          if (match && (match[1][0] !== "`" || !match[2].includes("`"))) {
            if (n === line.number) return false;
            fence = { marker: match[1], depth };
          }
        }
      }
      if (fence) return true;
      return false;
    }
    function pasteCodeText(plugin, event, view) {
      const data = event.clipboardData;
      if (!plugin.active || event.defaultPrevented || !view || view.state.readOnly || !data || data.files.length || !Array.from(data.types).includes("text/plain")) return false;
      if (!view.state.selection.ranges.every((range) => inCodeBlock(view.state, range.from) && inCodeBlock(view.state, range.to))) return false;
      plugin.pasteContext = null;
      event.preventDefault();
      event.stopPropagation();
      plugin.app.plugins?.plugins["easy-typing-obsidian"]?.markPaste?.(true);
      view.dispatch({ ...view.state.replaceSelection(data.getData("text/plain")), userEvent: "input.paste", filter: false });
      return true;
    }
    function installCodePaste2(plugin, win) {
      const listener = (event) => {
        const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
        if (target?.closest(".cm-content")) pasteCodeText(plugin, event, EditorView2.findFromDOM(target));
      };
      win.document.addEventListener("paste", listener, true);
      return () => win.document.removeEventListener("paste", listener, true);
    }
    function contentUnits(root) {
      const units = [];
      function visit(node) {
        if (node.nodeType === 3) {
          if (node.textContent.trim()) units.push(node);
          return;
        }
        if (node.nodeType !== 1) return;
        if (node.matches(BLOCK_ELEMENTS) || !node.querySelector(BLOCK_ELEMENTS + ", div")) {
          if (node.textContent.trim() || node.matches("p, hr, br") || node.querySelector("br, img")) units.push(node);
          return;
        }
        for (const child of node.childNodes) visit(child);
      }
      for (const child of root.childNodes) visit(child);
      return units;
    }
    function canCompact(unit) {
      if (unit.nodeType !== 1 || !unit.textContent.trim()) return false;
      return !unit.matches("ul, ol, table, blockquote, hr, br");
    }
    function boundaryCandidates(fragment) {
      const candidates = /* @__PURE__ */ new Map();
      function itemTail(item) {
        if (!item.querySelector(BLOCK_ELEMENTS)) return item.textContent.trim() ? item : null;
        const tail = contentUnits(item).at(-1);
        if (!tail || tail.nodeType !== 1) return null;
        if (tail.matches("ul, ol")) {
          const lastItem = [...tail.children].filter((child) => child.tagName === "LI").at(-1);
          return lastItem ? itemTail(lastItem) : null;
        }
        return canCompact(tail) ? tail : null;
      }
      for (const list of fragment.querySelectorAll("ul, ol")) {
        const items = Array.from(list.children).filter((item) => item.tagName === "LI");
        for (let index = 0; index < items.length - 1; index++) {
          const left = itemTail(items[index]);
          if (left && items[index + 1].textContent.trim()) candidates.set(left, { element: left, tail: false });
        }
        const tail = items.length ? itemTail(items.at(-1)) : null;
        if (tail && !candidates.has(tail)) candidates.set(tail, { element: tail, tail: true });
      }
      return [...candidates.values()];
    }
    function markBoundary({ element, tail }, markers) {
      if (element.tagName === "PRE") {
        const code = element.querySelector("code") || element;
        const children = [...code.childNodes];
        code.textContent = code.textContent.replace(/(\s*)$/, (tail ? markers.tailCode : markers.code) + "$1");
        return () => code.replaceChildren(...children);
      }
      const marker = element.ownerDocument.createTextNode(tail ? markers.tailText : markers.text);
      element.appendChild(marker);
      return () => marker.remove();
    }
    function compactHtmlDeletions(html) {
      const fragment = sanitizeHTMLToDom(html);
      const original = htmlToMarkdown(fragment);
      let marker = "BETTEROBSIDIANLISTBOUNDARY";
      while (html.includes(marker) || original.includes(marker)) marker += "X";
      const markers = {
        text: marker + "TEXT",
        code: marker + "CODE",
        tailText: marker + "TAILTEXT",
        tailCode: marker + "TAILCODE"
      };
      const candidates = boundaryCandidates(fragment);
      if (!candidates.length) return null;
      const stripMarkers = (text) => Object.values(markers).reduce((result, value) => result.split(value).join(""), text);
      const deletions = [];
      function collect(marked) {
        if (stripMarkers(marked) !== original) return false;
        const codePrefix = "[ \\t]*(?:\\n[ \\t>]*)+(?:`{3,}|~{3,})[ \\t]*\\n";
        for (const [value, prefix, tail] of [
          [markers.text, "\\n", false],
          [markers.code, codePrefix, false],
          [markers.tailText, "\\n", true],
          [markers.tailCode, codePrefix, true]
        ]) {
          const gap = tail ? "((?:[ \\t]+\\n)+)(?=\\n)" : "([ \\t>]*\\n)";
          const boundary = new RegExp(value + "(" + prefix + ")" + gap, "g");
          for (const match of marked.matchAll(boundary)) {
            const from = stripMarkers(marked.slice(0, match.index)).length + match[1].length;
            deletions.push({ from, to: from + match[2].length });
          }
        }
        return true;
      }
      function collectCandidates(elements) {
        const undoMarkers = elements.map((element) => markBoundary(element, markers));
        const marked = htmlToMarkdown(fragment);
        for (const undo of undoMarkers) undo();
        if (collect(marked) || elements.length === 1) return;
        const middle = Math.floor(elements.length / 2);
        collectCandidates(elements.slice(0, middle));
        collectCandidates(elements.slice(middle));
      }
      collectCandidates(candidates);
      const unique = [...new Map(deletions.map((range) => [range.from + ":" + range.to, range])).values()].sort((left, right) => left.from - right.from);
      return unique.length ? { original, deletions: unique } : null;
    }
    function installPaste2(plugin) {
      plugin.registerEvent(plugin.app.workspace.on("editor-paste", (event, editor) => {
        plugin.pasteContext = null;
        if (event.defaultPrevented) return;
        if (pasteCodeText(plugin, event, editor?.cm)) return;
        const data = event.clipboardData;
        if (!data || data.files.length) return;
        const html = data?.getData("text/html");
        const internalCopy = html?.includes("<!-- obsidian -->") && data.getData("text/plain");
        const convertLatex = plugin.settings.copyLatexEnabled && !internalCopy;
        const list = plugin.settings.compactHtmlPasteEnabled && html && !internalCopy && !data.getData("text/markdown") && plugin.app.vault.getConfig("autoConvertHtml") ? compactHtmlDeletions(html) : null;
        if (!list && !convertLatex) return;
        const context = { list, convertLatex };
        plugin.pasteContext = context;
        queueMicrotask(() => {
          if (plugin.pasteContext === context) plugin.pasteContext = null;
        });
      }));
      return EditorState.transactionFilter.of((transaction) => {
        const context = plugin.pasteContext;
        if (!plugin.active || !context || !transaction.isUserEvent("input.paste")) return transaction;
        const changes = [];
        transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
          const source = inserted.toString();
          let converted = source;
          if (plugin.settings.compactHtmlPasteEnabled && context.list?.original === source) {
            for (const deletion of [...context.list.deletions].reverse()) {
              converted = converted.slice(0, deletion.from) + converted.slice(deletion.to);
            }
          }
          if (plugin.settings.copyLatexEnabled && context.convertLatex) converted = convertLatexSyntax2(converted);
          if (converted !== source) changes.push({ from: fromB, to: toB, insert: converted });
        });
        return changes.length ? [transaction, { changes, sequential: true }] : transaction;
      });
    }
    module2.exports = { installPaste: installPaste2, installCodePaste: installCodePaste2, compactHtmlDeletions, inCodeBlock };
  }
});

// src/navigation-history.js
var require_navigation_history = __commonJS({
  "src/navigation-history.js"(exports2, module2) {
    var { EditorView: EditorView2 } = require("@codemirror/view");
    var SEARCH_INPUT = ".document-search-input, .cm-search input, .prompt-input, .search-input-container input";
    var POSITION_CLICK = ".cm-content, .internal-link, .cm-hmd-internal-link, .tree-item-self, .search-result-file-match, .search-result-file-title";
    function markdown(leaf) {
      return leaf?.view?.getViewType() === "markdown" && !!leaf.view.file;
    }
    function position(state) {
      const result = {};
      if (Number.isFinite(state?.scroll)) result.scroll = Math.max(0, state.scroll);
      if (state?.cursor) {
        const point = (value) => value && Number.isInteger(value.line) && value.line >= 0 && Number.isInteger(value.ch) && value.ch >= 0 ? { line: value.line, ch: value.ch } : null;
        const from = point(state.cursor.from), to = point(state.cursor.to);
        if (from && to) result.cursor = { from, to };
      }
      return result;
    }
    function samePosition(a, b) {
      if (!a || !b || a.state?.state?.file !== b.state?.state?.file || a.state?.type !== b.state?.type) return false;
      if (a.state?.state?.mode !== b.state?.state?.mode || a.state?.state?.source !== b.state?.state?.source) return false;
      const x = position(a.eState), y = position(b.eState);
      return JSON.stringify(x.cursor) === JSON.stringify(y.cursor) && Math.abs((x.scroll || 0) - (y.scroll || 0)) < 0.01;
    }
    var NavigationHistory2 = class {
      constructor(plugin) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.leaves = /* @__PURE__ */ new Map();
        this.windows = /* @__PURE__ */ new Map();
        this.running = true;
        this.saved = {};
        this.saveQueue = Promise.resolve();
        this.extension = EditorView2.updateListener.of((update) => this.onEditorUpdate(update));
        this.path = `${this.app.vault.configDir}/plugins/${plugin.manifest.id}/navigation-history.json`;
      }
      get enabled() {
        return this.running && this.plugin.active && this.plugin.settings.navigationHistoryEnabled;
      }
      get limit() {
        return Math.max(20, Math.min(500, Number(this.plugin.settings.navigationHistoryLimit) || 100));
      }
      async load() {
        const adapter = this.app.vault.adapter;
        try {
          if (await adapter.exists(this.path)) {
            const data = JSON.parse(await adapter.read(this.path));
            if (data.version === 1 && data.leaves && typeof data.leaves === "object") this.saved = data.leaves;
          }
        } catch (error) {
          console.warn("Better Obsidian: could not read navigation history", error);
        }
        this.app.workspace.onLayoutReady(() => {
          if (this.running) this.syncLeaves();
        });
        this.plugin.registerEvent(this.app.workspace.on("layout-change", () => this.syncLeaves()));
        this.plugin.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncLeaves()));
        this.plugin.registerEvent(this.app.workspace.on("file-open", () => this.syncLeaves()));
        this.plugin.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.onRename(file.path, oldPath)));
        this.plugin.registerEvent(this.app.vault.on("delete", (file) => this.onDelete(file.path)));
      }
      wrap(object, key, make, cleanups) {
        const original = object[key];
        if (typeof original !== "function") return;
        const wrapped = make(original);
        object[key] = wrapped;
        cleanups.push(() => {
          if (object[key] === wrapped) object[key] = original;
        });
      }
      capture(leaf) {
        if (!markdown(leaf)) return null;
        const entry = leaf.getHistoryState();
        return { ...entry, state: { ...entry.state, state: { ...entry.state.state } }, eState: position(entry.eState) };
      }
      syncLeaves() {
        if (!this.running) return;
        const live = /* @__PURE__ */ new Set();
        this.app.workspace.iterateAllLeaves((leaf) => {
          live.add(leaf);
          if (leaf.history && !this.leaves.has(leaf)) this.attachLeaf(leaf);
          const tracker = this.leaves.get(leaf);
          if (!tracker) return;
          if (tracker.view !== leaf.view) {
            tracker.viewCleanups.splice(0).reverse().forEach((cleanup) => cleanup());
            tracker.view = leaf.view;
            this.attachView(leaf, tracker);
          }
          if (!tracker.pending && !tracker.navigating) tracker.snapshot = this.capture(leaf);
        });
        for (const [leaf, tracker] of this.leaves) if (!live.has(leaf)) {
          this.detachLeaf(tracker);
          this.leaves.delete(leaf);
        }
      }
      attachLeaf(leaf) {
        const tracker = { leaf, cleanups: [], viewCleanups: [], navigating: 0, pending: null, timer: null, snapshot: null };
        this.leaves.set(leaf, tracker);
        const manager = this;
        this.wrap(leaf, "getHistoryState", (original) => function(...args) {
          const entry = original.apply(this, args);
          if (manager.enabled && markdown(this)) {
            const mode = this.view.currentMode;
            const state = {};
            mode?.getEphemeralState?.(state);
            state.scroll = mode?.getScroll?.();
            entry.eState = position(state);
          }
          return entry;
        }, tracker.cleanups);
        this.wrap(leaf, "recordHistory", (original) => function(entry) {
          if (!manager.enabled || entry?.state?.type !== "markdown") return original.call(this, entry);
          if (!samePosition(this.history.backHistory.at(-1), entry)) this.history.pushState(entry);
        }, tracker.cleanups);
        this.wrap(leaf.history, "pushState", (original) => function(entry) {
          const result = original.call(this, entry);
          if (manager.enabled) {
            this.backHistory.splice(0, Math.max(0, this.backHistory.length - manager.limit));
            manager.scheduleSave();
          }
          return result;
        }, tracker.cleanups);
        this.wrap(leaf.history, "go", (original) => async function(amount) {
          if (!manager.enabled) return original.call(this, amount);
          manager.finish(tracker);
          if (tracker.navigating || leaf.working) return;
          const stack = amount < 0 ? this.backHistory : this.forwardHistory;
          const target = stack[Math.max(0, stack.length - Math.abs(amount))];
          tracker.navigating++;
          tracker.search = null;
          try {
            const result = await original.call(this, amount);
            await new Promise((resolve) => setTimeout(resolve, 120));
            if (manager.running && target?.state?.type === "markdown" && markdown(leaf) && leaf.view.file.path === target.state.state.file) leaf.view.setEphemeralState(position(target.eState));
            return result;
          } finally {
            tracker.snapshot = manager.capture(leaf);
            tracker.navigating--;
            manager.scheduleSave();
          }
        }, tracker.cleanups);
        const saved = this.saved[leaf.id];
        if (this.enabled && this.plugin.settings.navigationHistoryPersist && saved && !leaf.history.backHistory.length && !leaf.history.forwardHistory.length) {
          leaf.history.backHistory = this.validEntries(saved.back);
          leaf.history.forwardHistory = this.validEntries(saved.forward);
          leaf.trigger("history-change");
        }
      }
      attachView(leaf, tracker) {
        if (!markdown(leaf)) return;
        const manager = this;
        this.wrap(leaf.view, "setEphemeralState", (original) => function(state) {
          const jump = state && ["subpath", "line", "startLoc", "cursor", "scroll"].some((key) => Object.hasOwn(state, key));
          if (manager.enabled && jump && !tracker.navigating && !leaf.working) manager.begin(tracker, "jump");
          const result = original.call(this, state);
          if (jump) manager.settle(tracker, 80);
          return result;
        }, tracker.viewCleanups);
        tracker.snapshot = this.capture(leaf);
      }
      trackerFor(target) {
        const root = target?.closest?.(".workspace-leaf");
        for (const [leaf2, tracker] of this.leaves) if (root === leaf2.containerEl && markdown(leaf2)) return tracker;
        const leaf = this.app.workspace.getMostRecentLeaf?.();
        return markdown(leaf) ? this.leaves.get(leaf) : null;
      }
      begin(tracker, kind, before = this.capture(tracker?.leaf)) {
        if (!this.enabled || !tracker || tracker.navigating || tracker.leaf.working || !before) return;
        if (tracker.search && kind !== "scroll") before = tracker.search;
        tracker.pending ||= { before, kind };
      }
      settle(tracker, delay = 80) {
        if (!tracker?.pending) return;
        clearTimeout(tracker.timer);
        tracker.timer = setTimeout(() => this.finish(tracker), delay);
      }
      finish(tracker) {
        if (!tracker) return;
        clearTimeout(tracker.timer);
        tracker.timer = null;
        const pending = tracker.pending;
        tracker.pending = null;
        const after = this.capture(tracker.leaf);
        if (this.enabled && !tracker.navigating && pending && after) {
          const before = pending.before;
          if (before.state.state.file === after.state.state.file && !samePosition(before, after) && (pending.kind !== "scroll" || Math.abs((before.eState.scroll || 0) - (after.eState.scroll || 0)) >= 3)) {
            const history = tracker.leaf.history;
            if (!samePosition(history.backHistory.at(-1), before)) history.pushState(before);
            else {
              history.forwardHistory.length = 0;
              tracker.leaf.trigger("history-change");
              this.scheduleSave();
            }
            tracker.search = null;
          }
        }
        tracker.snapshot = after;
      }
      onEditorUpdate(update) {
        if (!this.enabled) return;
        const tracker = this.trackerFor(update.view.dom);
        if (!tracker || tracker.leaf.view.currentMode?.cm !== update.view || tracker.navigating || tracker.leaf.working) return;
        if (update.docChanged) {
          tracker.pending = null;
          clearTimeout(tracker.timer);
          tracker.snapshot = this.capture(tracker.leaf);
          return;
        }
        if (!update.selectionSet) return;
        const before = tracker.snapshot || this.capture(tracker.leaf);
        if (before) {
          const point = (offset) => {
            const line = update.startState.doc.lineAt(offset);
            return { line: line.number - 1, ch: offset - line.from };
          };
          const selection = update.startState.selection.main;
          before.eState.cursor = { from: point(selection.anchor), to: point(selection.head) };
          const lineDelta = Math.abs(update.state.doc.lineAt(update.state.selection.main.head).number - update.startState.doc.lineAt(selection.head).number);
          if (tracker.search || lineDelta >= 3) this.begin(tracker, "jump", before);
        }
        this.settle(tracker);
        tracker.snapshot = this.capture(tracker.leaf);
      }
      attachWindow(win) {
        if (!win || this.windows.has(win)) return;
        const cleanups = [];
        const on = (name, callback) => {
          win.document.addEventListener(name, callback, true);
          cleanups.push(() => win.document.removeEventListener(name, callback, true));
        };
        on("pointerdown", (event) => {
          if (event.button !== 0 || !event.target?.closest?.(POSITION_CLICK)) return;
          const tracker = this.trackerFor(event.target);
          this.begin(tracker, "click");
        });
        on("pointerup", (event) => this.settle(this.trackerFor(event.target)));
        on("click", (event) => {
          if (!event.target?.closest?.(POSITION_CLICK)) return;
          const tracker = this.trackerFor(event.target);
          this.begin(tracker, "click", tracker?.snapshot);
          this.settle(tracker);
        });
        on("wheel", (event) => {
          if (!event.deltaY || !event.target?.closest?.(".cm-scroller, .markdown-preview-view")) return;
          const tracker = this.trackerFor(event.target);
          this.begin(tracker, "scroll");
          this.settle(tracker, 250);
        });
        on("touchstart", (event) => {
          if (event.target?.closest?.(".cm-scroller, .markdown-preview-view")) this.begin(this.trackerFor(event.target), "scroll");
        });
        on("scroll", (event) => {
          const tracker = this.trackerFor(event.target);
          if (!tracker || tracker.navigating || !this.enabled) return;
          this.settle(tracker, tracker.pending?.kind === "scroll" ? 250 : 80);
          if (!tracker.pending) tracker.snapshot = this.capture(tracker.leaf);
        });
        on("focusin", (event) => {
          if (!event.target?.closest?.(SEARCH_INPUT)) return;
          const tracker = this.trackerFor(event.target);
          if (this.enabled && tracker && !tracker.navigating) tracker.search ||= this.capture(tracker.leaf);
        });
        on("focusout", (event) => {
          if (!event.target?.closest?.(SEARCH_INPUT)) return;
          const tracker = this.trackerFor(event.target);
          if (tracker) {
            clearTimeout(tracker.searchTimer);
            tracker.searchTimer = setTimeout(() => {
              tracker.search = null;
            }, 300);
          }
        });
        this.windows.set(win, cleanups);
      }
      detachWindow(win) {
        this.windows.get(win)?.reverse().forEach((cleanup) => cleanup());
        this.windows.delete(win);
      }
      validEntries(entries) {
        if (!Array.isArray(entries)) return [];
        return entries.filter((entry) => entry?.state?.type === "markdown" && typeof entry.state.state?.file === "string" && this.app.vault.getFileByPath(entry.state.state.file)).slice(-this.limit).map((entry) => ({
          title: entry.title,
          icon: entry.icon,
          state: { type: "markdown", state: {
            file: entry.state.state.file,
            mode: entry.state.state.mode === "preview" ? "preview" : "source",
            source: !!entry.state.state.source
          } },
          eState: position(entry.eState)
        }));
      }
      scheduleSave() {
        if (!this.running || !this.plugin.settings.navigationHistoryPersist) return;
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.save(), 500);
      }
      save() {
        clearTimeout(this.saveTimer);
        if (!this.plugin.settings.navigationHistoryPersist) return this.saveQueue;
        const leaves = {};
        for (const [leaf] of this.leaves) leaves[leaf.id] = {
          back: this.validEntries(leaf.history.backHistory),
          forward: this.validEntries(leaf.history.forwardHistory)
        };
        const data = JSON.stringify({ version: 1, leaves });
        this.saveQueue = this.saveQueue.catch(() => {
        }).then(() => this.app.vault.adapter.write(this.path, data)).catch((error) => console.warn("Better Obsidian: could not save navigation history", error));
        return this.saveQueue;
      }
      onRename(path, oldPath) {
        for (const [leaf, tracker] of this.leaves) {
          const entries = [...leaf.history.backHistory, ...leaf.history.forwardHistory, tracker.snapshot, tracker.pending?.before];
          for (const entry of entries) {
            const state = entry?.state?.state;
            if (typeof state?.file !== "string") continue;
            if (state.file === oldPath || state.file.startsWith(`${oldPath}/`)) state.file = path + state.file.slice(oldPath.length);
          }
        }
        this.scheduleSave();
      }
      onDelete(path) {
        for (const [leaf] of this.leaves) {
          for (const key of ["backHistory", "forwardHistory"]) leaf.history[key] = leaf.history[key].filter((entry) => {
            const file = entry?.state?.state?.file;
            return file !== path && !file?.startsWith(`${path}/`);
          });
          leaf.trigger("history-change");
        }
        this.scheduleSave();
      }
      apply() {
        for (const [leaf, tracker] of this.leaves) {
          clearTimeout(tracker.timer);
          clearTimeout(tracker.searchTimer);
          tracker.pending = tracker.search = null;
          tracker.snapshot = this.capture(leaf);
          if (this.enabled) for (const key of ["backHistory", "forwardHistory"]) {
            leaf.history[key].splice(0, Math.max(0, leaf.history[key].length - this.limit));
          }
          leaf.trigger("history-change");
        }
        this.scheduleSave();
      }
      detachLeaf(tracker) {
        clearTimeout(tracker.timer);
        clearTimeout(tracker.searchTimer);
        tracker.viewCleanups.reverse().forEach((cleanup) => cleanup());
        tracker.cleanups.reverse().forEach((cleanup) => cleanup());
      }
      unload() {
        this.save();
        this.running = false;
        clearTimeout(this.saveTimer);
        for (const win of this.windows.keys()) this.detachWindow(win);
        for (const tracker of this.leaves.values()) this.detachLeaf(tracker);
        this.leaves.clear();
      }
    };
    module2.exports = { NavigationHistory: NavigationHistory2, samePosition, position };
  }
});

// src/main.js
var { Plugin } = require("obsidian");
var { EditorView } = require("@codemirror/view");
var { CodeBlocks } = require_code_blocks();
var { loadSettings, BetterObsidianSettings } = require_settings();
var { convertLatexSyntax, installLatexCopy } = require_latex_copy();
var { installPaste, installCodePaste } = require_html_paste();
var { NavigationHistory } = require_navigation_history();
module.exports = class BetterObsidian extends Plugin {
  async onload() {
    this.active = true;
    this.settings = await loadSettings(this);
    this.windowCleanups = /* @__PURE__ */ new Map();
    this.convertedCopyEvents = /* @__PURE__ */ new WeakSet();
    this.editorExtensions = [];
    this.navigationHistory = new NavigationHistory(this);
    await this.navigationHistory.load();
    this.codeBlocks = new CodeBlocks(this);
    await this.codeBlocks.load();
    if (!this.active) return;
    this.copyExtension = EditorView.clipboardOutputFilter.of((text) => {
      if (!this.settings.copyLatexEnabled || !this.currentCopyEvent) return text;
      this.convertedCopyEvents.add(this.currentCopyEvent);
      return convertLatexSyntax(text);
    });
    this.registerEditorExtension(this.editorExtensions);
    this.pasteExtension = installPaste(this);
    this.addSettingTab(new BetterObsidianSettings(this.app, this));
    this.attachWindow(window);
    this.app.workspace.iterateAllLeaves((leaf) => this.attachWindow(leaf.view.containerEl.ownerDocument.defaultView));
    this.registerEvent(this.app.workspace.on("window-open", (_, win) => this.attachWindow(win)));
    this.registerEvent(this.app.workspace.on("window-close", (_, win) => this.detachWindow(win)));
    this.codeBlocks.apply();
    this.addCommand({
      id: "convert-latex-to-mathjax",
      name: "\u8F6C\u6362\u5F53\u524D\u7B14\u8BB0\u7684 LaTeX \u5206\u9694\u7B26",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return;
        const source = await this.app.vault.read(file);
        const converted = convertLatexSyntax(source);
        if (converted !== source) await this.app.vault.modify(file, converted);
      }
    });
  }
  attachWindow(win) {
    if (!win || this.windowCleanups.has(win)) return;
    const copyCleanup = installLatexCopy(this, win);
    const pasteCleanup = installCodePaste(this, win);
    this.windowCleanups.set(win, () => {
      pasteCleanup();
      copyCleanup();
    });
    this.codeBlocks.attachWindow(win);
    this.navigationHistory.attachWindow(win);
  }
  detachWindow(win) {
    this.windowCleanups.get(win)?.();
    this.windowCleanups.delete(win);
    this.codeBlocks.detachWindow(win);
    this.navigationHistory.detachWindow(win);
  }
  refreshEditorExtensions() {
    this.editorExtensions.splice(
      0,
      this.editorExtensions.length,
      this.copyExtension,
      this.pasteExtension,
      this.navigationHistory.extension,
      ...this.settings.codeScrollEnabled ? this.codeBlocks.extensions : []
    );
    this.app.workspace.updateOptions();
  }
  async setFeature(key, value) {
    this.settings[key] = value;
    await this.saveData(this.settings);
    if (["codeScrollEnabled", "codeWrapEnabled", "codeLineNumbersEnabled"].includes(key)) this.codeBlocks.apply();
    if (key.startsWith("navigationHistory")) this.navigationHistory.apply();
  }
  onunload() {
    this.navigationHistory?.unload();
    this.active = false;
    this.currentCopyEvent = null;
    this.pasteContext = null;
    for (const win of this.windowCleanups?.keys() || []) {
      this.detachWindow(win);
    }
  }
};
