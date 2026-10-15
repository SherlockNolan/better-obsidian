const { editorLivePreviewField } = require("obsidian");
const { Decoration, EditorView, ViewPlugin, WidgetType } = require("@codemirror/view");
const { syntaxTree } = require("@codemirror/language");
const { technicalTokens } = require("./technical-text");
const { inCodeBlock } = require("./html-paste");

const TOKEN_CLASS = "better-obsidian-technical-text";
const BODY_CLASS = "better-obsidian-smart-wrap";
const EXCLUDE = "pre, script, style, textarea, input, svg, math, mjx-container, .math, .math-inline, .math-block, .katex, .mermaid, .metadata-container, .frontmatter, [contenteditable], ." + TOKEN_CLASS;

class BreakOpportunity extends WidgetType {
  eq() { return true; }
  toDOM(view) {
    const element = view.dom.ownerDocument.createElement("wbr");
    element.className = "better-obsidian-word-break";
    element.setAttribute("aria-hidden", "true");
    return element;
  }
}

function editorExtension() {
  const breakWidget = new BreakOpportunity();
  function build(view) {
    if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;
    const decorations = [], visited = new Set();
    const tree = syntaxTree(view.state);
    for (const range of view.visibleRanges) {
      const first = view.state.doc.lineAt(range.from).number;
      const last = view.state.doc.lineAt(range.to).number;
      for (let n = first; n <= last; n++) {
        if (visited.has(n)) continue;
        visited.add(n);
        const line = view.state.doc.line(n);
        for (const token of technicalTokens(line.text)) {
          const from = line.from + token.from, to = line.from + token.to;
          let excluded = false, possibleCode = false;
          for (let node = tree.resolveInner(from, 1); node; node = node.parent) {
            if (/frontmatter|math|HTMLBlock|Comment/i.test(node.name)) { excluded = true; break; }
            if (/code|quote/i.test(node.name)) possibleCode = true;
          }
          if (excluded || (possibleCode && inCodeBlock(view.state, from))) continue;
          decorations.push(Decoration.mark({ class: TOKEN_CLASS }).range(from, to));
          for (const offset of token.breaks) decorations.push(
            Decoration.widget({ widget: breakWidget, side: 1 }).range(from + offset));
        }
      }
    }
    return Decoration.set(decorations, true);
  }
  return ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = build(view); }
    update(update) {
      if (update.docChanged || update.viewportChanged ||
          syntaxTree(update.state) !== syntaxTree(update.startState) ||
          update.state.field(editorLivePreviewField, false) !== update.startState.field(editorLivePreviewField, false)) {
        this.decorations = build(update.view);
      }
    }
  }, { decorations: plugin => plugin.decorations });
}

function prepareText(root) {
  const document = root.ownerDocument;
  if (!document || root.closest(EXCLUDE)) return;
  const walker = document.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) if (!node.parentElement?.closest(EXCLUDE)) nodes.push(node);
  for (const textNode of nodes) {
    const tokens = technicalTokens(textNode.data);
    if (!tokens.length) continue;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const token of tokens) {
      if (token.from > offset) fragment.append(document.createTextNode(textNode.data.slice(offset, token.from)));
      const span = document.createElement("span");
      span.className = TOKEN_CLASS;
      span.dataset.betterObsidianWrap = "true";
      let start = 0;
      for (const end of token.breaks) {
        span.append(document.createTextNode(token.text.slice(start, end)), document.createElement("wbr"));
        start = end;
      }
      span.append(document.createTextNode(token.text.slice(start)));
      fragment.append(span);
      offset = token.to;
    }
    if (offset < textNode.data.length) fragment.append(document.createTextNode(textNode.data.slice(offset)));
    textNode.replaceWith(fragment);
  }
}

function restoreText(root) {
  for (const span of root.querySelectorAll('[data-better-obsidian-wrap="true"]')) {
    span.replaceWith(span.ownerDocument.createTextNode(span.textContent));
  }
}

class SmartWrap {
  constructor(plugin) {
    this.plugin = plugin;
    this.extension = editorExtension();
    plugin.registerMarkdownPostProcessor(element => {
      if (plugin.active && plugin.settings.smartWrapEnabled) prepareText(element);
    }, 210);
  }

  attachWindow(win) {
    win.document.body.classList.toggle(BODY_CLASS, this.plugin.settings.smartWrapEnabled);
  }

  detachWindow(win) {
    win.document.body.classList.remove(BODY_CLASS);
    for (const root of win.document.querySelectorAll(".markdown-rendered")) restoreText(root);
  }

  apply() {
    for (const win of this.plugin.windowCleanups.keys()) {
      this.attachWindow(win);
      for (const root of win.document.querySelectorAll(".markdown-rendered:not(.cm-content)")) {
        if (this.plugin.settings.smartWrapEnabled) prepareText(root);
        else restoreText(root);
      }
    }
    this.plugin.refreshEditorExtensions();
    this.plugin.app.workspace.trigger("post-processor-change");
  }
}

module.exports = { SmartWrap, editorExtension, prepareText, restoreText };
