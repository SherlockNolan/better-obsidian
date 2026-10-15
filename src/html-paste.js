const { htmlToMarkdown, sanitizeHTMLToDom } = require("obsidian");
const { EditorState } = require("@codemirror/state");
const { EditorView } = require("@codemirror/view");
const { syntaxTree } = require("@codemirror/language");
const { convertLatexSyntax } = require("./latex-copy");

const BLOCK_ELEMENTS = "p, h1, h2, h3, h4, h5, h6, pre, ul, ol, table, blockquote, hr";

function inCodeBlock(state, at) {
  const line = state.doc.lineAt(at);
  for (let node = syntaxTree(state).resolveInner(at, 1); node; node = node.parent) {
    if (node.name === "CodeBlock" || node.name.includes("hmd-indented-code")) return true;
    if (node.name === "FencedCode") {
      const opening = state.doc.lineAt(node.from);
      // The fence itself is Markdown syntax, not the code-paste destination.
      const closing = state.doc.lineAt(node.to);
      return line.number > opening.number && (line.number < closing.number ||
        !/^[\s>]*(`{3,}|~{3,})\s*$/.test(closing.text));
    }
    if (node.name.includes("HyperMD-codeblock") && !/-(begin|end)/.test(node.name)) return true;
  }
  // HyperMD has no token on empty code rows and represents quoted fenced code
  // as inline-code tokens. Check container-prefixed fence lines in those cases.
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
  if (!plugin.active || event.defaultPrevented || !view || view.state.readOnly || !data || data.files.length ||
      !Array.from(data.types).includes("text/plain")) return false;
  if (!view.state.selection.ranges.every(range => inCodeBlock(view.state, range.from) &&
      inCodeBlock(view.state, range.to))) return false;
  plugin.pasteContext = null;
  // Do not run HTML/Markdown conversion, list cleanup, LaTeX conversion or
  // indentation heuristics. One native CodeMirror transaction preserves undo,
  // multiple cursors, selection mapping and the document's newline convention.
  event.preventDefault();
  event.stopPropagation();
  // Easy Typing also formats paste in an update listener (after CM filters).
  // Use its existing plain-paste signal, just like Ctrl+Shift+V, for this paste.
  plugin.app.plugins?.plugins["easy-typing-obsidian"]?.markPaste?.(true);
  view.dispatch({ ...view.state.replaceSelection(data.getData("text/plain")), userEvent: "input.paste", filter: false });
  return true;
}

function installCodePaste(plugin, win) {
  const listener = event => {
    const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    if (target?.closest(".cm-content")) pasteCodeText(plugin, event, EditorView.findFromDOM(target));
  };
  // Capture before Obsidian and other editor-paste listeners convert rich HTML.
  win.document.addEventListener("paste", listener, true);
  return () => win.document.removeEventListener("paste", listener, true);
}

// Wrapper divs are transparent. Treat code, lists and tables as whole units so
// the HTML converter's separators can be distinguished from their contents.
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
  const candidates = new Map();
  function itemTail(item) {
    // Append outside inline formatting so **text** and `code` remain intact.
    if (!item.querySelector(BLOCK_ELEMENTS)) return item.textContent.trim() ? item : null;
    const tail = contentUnits(item).at(-1);
    if (!tail || tail.nodeType !== 1) return null;
    if (tail.matches("ul, ol")) {
      const lastItem = [...tail.children].filter(child => child.tagName === "LI").at(-1);
      return lastItem ? itemTail(lastItem) : null;
    }
    return canCompact(tail) ? tail : null;
  }
  // Compact sibling items and the generated indented blank at a list's end.
  // Ordinary paragraph separators and paragraphs within one item stay intact.
  for (const list of fragment.querySelectorAll("ul, ol")) {
    const items = Array.from(list.children).filter(item => item.tagName === "LI");
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
    // Insert before trailing whitespace so native fence generation is intact.
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
    text: marker + "TEXT", code: marker + "CODE",
    tailText: marker + "TAILTEXT", tailCode: marker + "TAILCODE",
  };
  const candidates = boundaryCandidates(fragment);
  if (!candidates.length) return null;
  const stripMarkers = text => Object.values(markers).reduce((result, value) => result.split(value).join(""), text);
  const deletions = [];

  function collect(marked) {
    // Markers must not change native formatting, whitespace trimming or syntax.
    if (stripMarkers(marked) !== original) return false;
    const codePrefix = "[ \\t]*(?:\\n[ \\t>]*)+(?:`{3,}|~{3,})[ \\t]*\\n";
    for (const [value, prefix, tail] of [
      [markers.text, "\\n", false], [markers.code, codePrefix, false],
      [markers.tailText, "\\n", true], [markers.tailCode, codePrefix, true],
    ]) {
      // At a list's end remove only indented blank lines immediately followed
      // by an unindented empty line. Keep that empty line as the paragraph gap.
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
    const undoMarkers = elements.map(element => markBoundary(element, markers));
    const marked = htmlToMarkdown(fragment);
    for (const undo of undoMarkers) undo();
    if (collect(marked) || elements.length === 1) return;
    // A trailing <br> or inline-code edge can make one marker unsafe. Do not
    // let that boundary disable compaction throughout the whole pasted HTML.
    const middle = Math.floor(elements.length / 2);
    collectCandidates(elements.slice(0, middle));
    collectCandidates(elements.slice(middle));
  }
  collectCandidates(candidates);
  const unique = [...new Map(deletions.map(range => [range.from + ":" + range.to, range])).values()]
    .sort((left, right) => left.from - right.from);
  return unique.length ? { original, deletions: unique } : null;
}

function installPaste(plugin) {
  plugin.registerEvent(plugin.app.workspace.on("editor-paste", (event, editor) => {
    plugin.pasteContext = null;
    if (event.defaultPrevented) return;
    if (pasteCodeText(plugin, event, editor?.cm)) return;
    const data = event.clipboardData;
    if (!data || data.files.length) return;
    const html = data?.getData("text/html");
    const internalCopy = html?.includes("<!-- obsidian -->") && data.getData("text/plain");
    const convertLatex = plugin.settings.copyLatexEnabled && !internalCopy;
    const list = plugin.settings.compactHtmlPasteEnabled && html && !internalCopy &&
      !data.getData("text/markdown") && plugin.app.vault.getConfig("autoConvertHtml")
      ? compactHtmlDeletions(html) : null;
    if (!list && !convertLatex) return;
    const context = { list, convertLatex };
    plugin.pasteContext = context;
    queueMicrotask(() => {
      if (plugin.pasteContext === context) plugin.pasteContext = null;
    });
  }));

  return EditorState.transactionFilter.of(transaction => {
    const context = plugin.pasteContext;
    if (!plugin.active || !context ||
        !transaction.isUserEvent("input.paste")) return transaction;
    const changes = [];
    transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      const source = inserted.toString();
      let converted = source;
      if (plugin.settings.compactHtmlPasteEnabled && context.list?.original === source) {
        for (const deletion of [...context.list.deletions].reverse()) {
          converted = converted.slice(0, deletion.from) + converted.slice(deletion.to);
        }
      }
      if (plugin.settings.copyLatexEnabled && context.convertLatex) converted = convertLatexSyntax(converted);
      if (converted !== source) changes.push({ from: fromB, to: toB, insert: converted });
    });
    // A sequential change maps the native selection and remains part of the
    // same paste/undo transaction; existing text is never touched.
    return changes.length ? [transaction, { changes, sequential: true }] : transaction;
  });
}

module.exports = { installPaste, installCodePaste, compactHtmlDeletions, inCodeBlock };
