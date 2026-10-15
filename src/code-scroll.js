const { editorLivePreviewField } = require("obsidian");
const { StateField } = require("@codemirror/state");
const { Decoration, EditorView, ViewPlugin, WidgetType } = require("@codemirror/view");
const { syntaxTree, foldedRanges } = require("@codemirror/language");

function livePreview(state) {
  return state.field(editorLivePreviewField, false) === true;
}

function codeBlocks(state) {
  if (!livePreview(state)) return [];
  const starts = new Set();
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "FencedCode" || node.name.includes("HyperMD-codeblock-begin")) {
        starts.add(state.doc.lineAt(node.from).number);
      }
    },
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
    foldedRanges(state).between(opening.to, closing.to, () => { folded = true; });
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
      // bar.setAttribute("aria-label", "代码块横向滚动");
      const track = document.createElement("div");
      track.className = "vscode-code-scroll-track";
      bar.appendChild(track);
      bar.addEventListener("scroll", () => {
        view.plugin(controller)?.scroll(this.block.from, bar.scrollLeft);
      });
      return bar;
    }
    get estimatedHeight() { return 0; }
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
          style: `--vscode-code-number-width: ${Math.max(2, String(block.last - block.first + 1).length)}ch`,
        } }).range(state.doc.line(i).from));
      }
      // An inline widget belongs to the closing-fence line itself. Its bottom
      // padding holds the scrollbar inside Obsidian's rounded block background.
      decorations.push(Decoration.widget({ widget: new Scrollbar(block), side: 1 }).range(block.to));
    }
    return { blocks, decorations: Decoration.set(decorations, true) };
  }

  const field = StateField.define({
    create: build,
    update(value, transaction) {
      if (transaction.docChanged || syntaxTree(transaction.state) !== syntaxTree(transaction.startState)
        || livePreview(transaction.state) !== livePreview(transaction.startState)
        || foldedRanges(transaction.state) !== foldedRanges(transaction.startState)) {
        return build(transaction.state);
      }
      return value;
    },
    provide: field => EditorView.decorations.from(field, value => value.decorations),
  });

  controller = ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.offsets = new Map();
      this.widths = new Map();
      this.scrollRanges = new Map();
      this.revealCursor = false;
      this.canvas = document.createElement("canvas");
      this.context = this.canvas.getContext("2d");
      this.resizeObserver = new ResizeObserver(() => this.measure());
      this.resizeObserver.observe(view.dom);
      this.measure();
      // Font loading and changes to Obsidian's appearance settings need remeasurement.
      this.fontListener = () => { this.widths.clear(); this.measure(); };
      document.fonts?.addEventListener("loadingdone", this.fontListener);
      this.appearanceObserver = new MutationObserver(this.fontListener);
      this.appearanceObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
      // Virtualized lines/widgets can be drawn after a viewport measurement.
      // Restore the shared offset once their actual text DOM has been added.
      this.contentObserver = new MutationObserver(() => this.measure());
      this.contentObserver.observe(view.contentDOM, { childList: true, subtree: true });
      this.wheelListener = event => this.wheel(event);
      // Listen on the scroller so code text, background and scrollbar widgets
      // all receive trackpad gestures, including widgets ignored by CodeMirror.
      view.scrollDOM.addEventListener("wheel", this.wheelListener, { passive: false });
    }
    update(update) {
      if (update.docChanged) {
        this.offsets = new Map([...this.offsets].map(([from, offset]) => [update.changes.mapPos(from), offset]));
        this.widths.clear();
        this.scrollRanges.clear();
      }
      if (update.selectionSet) this.revealCursor = true;
      if (update.docChanged || update.viewportChanged || update.geometryChanged || update.selectionSet
        || update.startState.field(field) !== update.state.field(field)) this.measure();
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
      // CodeMirror draws selection and caret layers outside the editable lines.
      this.view.requestMeasure();
    }
    wheel(event) {
      if (event.defaultPrevented || event.ctrlKey || !livePreview(this.view.state)
        || this.view.dom.ownerDocument.body.classList.contains("better-obsidian-code-wrap")) return;
      const shifted = event.shiftKey && event.deltaX === 0;
      const delta = shifted ? event.deltaY : event.deltaX;
      // Let vertical gestures scroll the note; Ctrl+wheel may be pinch zoom.
      if (!delta || (!shifted && Math.abs(event.deltaX) < Math.abs(event.deltaY))) return;

      const blocks = this.view.state.field(field).blocks;
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      const element = target?.closest(".vscode-code-scroll-line, .vscode-code-scrollbar");
      let block = element && this.view.contentDOM.contains(element)
        ? blocks.find(block => block.from === Number(element.dataset.vscodeCodeBlock)) : null;
      if (!block) {
        const position = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position != null) block = blocks.find(block => position >= block.from && position <= block.to);
      }
      // Also support the active code block when the pointer is on editor padding.
      if (!block && this.view.hasFocus) {
        const head = this.view.state.selection.main.head;
        block = blocks.find(block => head >= block.from && head <= block.to);
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
        read: view => {
          const result = [];
          const lines = [...view.contentDOM.querySelectorAll(".vscode-code-scroll-line")];
          for (const block of view.state.field(field).blocks) {
            const visible = lines.filter(line => Number(line.dataset.vscodeCodeBlock) === block.from);
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
              // Measure every document line, including lines outside the viewport.
              for (let i = block.first; i <= block.last; i++) {
                let length = 0;
                for (const part of view.state.doc.line(i).text.split(/(\t)/)) {
                  if (part === "\t") length = (Math.floor(length / (space * tabSize)) + 1) * space * tabSize;
                  else length += this.context.measureText(part).width + [...part].length * spacing;
                }
                width = Math.max(width, length);
              }
              width += parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2;
              this.widths.set(key, width);
            }
            const viewport = visible[0].clientWidth;
            if (wrapping) width = viewport;
            const bar = [...view.contentDOM.querySelectorAll(".vscode-code-scrollbar")]
              .find(bar => Number(bar.dataset.vscodeCodeBlock) === block.from);
            let offset = Math.min(this.offsets.get(block.from) || 0, Math.max(0, width - viewport));
            if (this.revealCursor && !wrapping) {
              const head = view.state.selection.main.head;
              const cursorLine = view.state.doc.lineAt(head);
              if (cursorLine.number >= block.first && cursorLine.number <= block.last) {
                const coords = view.coordsAtPos(head);
                const line = visible.find(line => view.posAtDOM(line) === cursorLine.from);
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
        write: result => {
          this.revealCursor = false;
          let heightChanged = false;
          for (const { block, visible, bar, width, viewport, offset } of result) {
            this.scrollRanges.set(block.from, { max: Math.max(0, width - viewport), viewport });
            for (const line of visible) {
              // Generated content supplies a shared scroll range without modifying CodeMirror's text DOM.
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
        },
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

/* Native Reading view uses Prism. Apply its token ranges as editable
 * CodeMirror marks too, rather than trying to equate two different grammars. */
function prismHighlighting(prism) {
  let cache = new Map();
  function build(state) {
    const decorations = [];
    const nextCache = new Map();
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
          class: `vscode-prism-code language-${language}`,
        } }).range(line.from));
      }
      const key = language + "\0" + source;
      let ranges = cache.get(key);
      if (!ranges) {
        ranges = [];
        const grammar = prism.languages[language];
        function visit(value, offset) {
          if (typeof value === "string") return offset + value.length;
          if (Array.isArray(value)) {
            for (const child of value) offset = visit(child, offset);
            return offset;
          }
          const classes = ["token", value.type, ...[].concat(value.alias || [])].join(" ");
          const range = { from: offset, to: offset, classes };
          ranges.push(range);
          range.to = visit(value.content, offset);
          return range.to;
        }
        if (grammar) visit(prism.tokenize(source, grammar), 0);
      }
      nextCache.set(key, ranges);
      for (const token of ranges) {
        // Split multiline ranges at line boundaries, excluding Markdown's
        // blockquote/list prefixes while preserving original editor positions.
        let low = 0, high = lines.length;
        while (low < high) {
          const mid = (low + high) >> 1;
          if (lines[mid].end <= token.from) low = mid + 1;
          else high = mid;
        }
        for (let i = low; i < lines.length && lines[i].start < token.to; i++) {
          const line = lines[i];
          const start = Math.max(token.from, line.start);
          const end = Math.min(token.to, line.end);
          if (end > start) decorations.push(Decoration.mark({ class: token.classes })
            .range(line.from + start - line.start, line.from + end - line.start));
        }
      }
    }
    cache = nextCache;
    return Decoration.set(decorations, true);
  }
  return StateField.define({
    create: build,
    update(value, transaction) {
      return transaction.docChanged
        || syntaxTree(transaction.state) !== syntaxTree(transaction.startState)
        || livePreview(transaction.state) !== livePreview(transaction.startState)
        || foldedRanges(transaction.state) !== foldedRanges(transaction.startState)
        ? build(transaction.state) : value;
    },
    provide: field => EditorView.decorations.from(field),
  });
}

/* Preserve native Prism markup and exact source text. Individual source-line
 * boxes let CSS paint continuation arrows at any print width, without measuring
 * the screen or inserting markers/newlines into the original code. */
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
  const walker = doc.createTreeWalker(code, 4 /* SHOW_TEXT */);
  const breaks = [];
  let node;
  while ((node = walker.nextNode())) {
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
  for (const { node, offset } of breaks) {
    range.setEnd(node, offset);
    appendLine();
    const newline = doc.createElement("span");
    newline.className = "vscode-code-line-break";
    newline.textContent = "\n";
    fragment.append(newline);
    range.setStart(node, offset + 1);
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

module.exports = {
  createEditorExtensions: prism => [editorExtension(), prismHighlighting(prism)],
  prepareCodeLines,
  restoreCodeLines,
};
