/* Conversion rules from Transfer LaTeX from GPT by Xixia.
 * Match its trimming and multiline behavior exactly. */
function convertLatexSyntax(content) {
  return content
    .replace(/\\\(\s*(.*?)\s*\\\)/gs, (_, formula) => `$${formula.trim()}$`)
    .replace(/\\\[\s*(.*?)\s*\\\]/gs, (_, formula) => `$$${formula.trim()}$$`);
}

function selectionText(win) {
  const input = win.document.activeElement;
  if (typeof input?.value === "string" && typeof input.selectionStart === "number") {
    return input.value.slice(input.selectionStart, input.selectionEnd);
  }
  return win.getSelection()?.toString() || "";
}

function installClipboardWriter(plugin, clipboard) {
  if (!clipboard?.writeText) return () => {};
  plugin.clipboardHooks ||= new Map();
  let hook = plugin.clipboardHooks.get(clipboard);
  if (!hook) {
    const descriptor = Object.getOwnPropertyDescriptor(clipboard, "writeText");
    const original = clipboard.writeText;
    const wrapped = function(text, ...args) {
      const enabled = plugin.active && plugin.settings.copyLatexEnabled;
      return original.call(this, enabled && typeof text === "string" ? convertLatexSyntax(text) : text, ...args);
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

function installLatexCopy(plugin, win) {
  const enabled = () => plugin.active && plugin.settings.copyLatexEnabled;
  const onCopyStart = event => {
    if (!enabled()) return;
    plugin.currentCopyEvent = event;
    // CodeMirror's clipboard filter runs synchronously between capture and
    // bubble. Forget the event even if another handler stops propagation.
    queueMicrotask(() => {
      if (plugin.currentCopyEvent === event) plugin.currentCopyEvent = null;
    });
  };
  const onCopy = event => {
    if (!enabled() || !event.clipboardData) return;
    if (plugin.convertedCopyEvents.has(event)) return;
    const source = event.clipboardData.getData("text/plain") || selectionText(win);
    const converted = convertLatexSyntax(source);
    if (converted === source) return;
    event.clipboardData.setData("text/plain", converted);
    // Rich-text consumers must not pick up the unconverted HTML instead.
    event.clipboardData.clearData("text/html");
    event.preventDefault();
  };
  win.document.addEventListener("copy", onCopyStart, true);
  win.document.addEventListener("copy", onCopy);

  // Desktop Obsidian resets navigator.clipboard.writeText on window switches.
  // Hook its Electron backends instead. Browser/mobile use the navigator API.
  // Shared backends are wrapped once across windows, never once per window.
  let backends = [];
  if (typeof win.require === "function") {
    try {
      const electron = win.require("electron");
      backends = [...new Set([electron.clipboard, electron.remote?.clipboard])]
        .filter(clipboard => typeof clipboard?.writeText === "function");
    } catch (_) { /* Browser/mobile have no Electron module. */ }
  }
  if (!backends.length) backends = [win.navigator.clipboard];
  const restoreWriters = backends.map(clipboard => installClipboardWriter(plugin, clipboard));
  return () => {
    win.document.removeEventListener("copy", onCopyStart, true);
    win.document.removeEventListener("copy", onCopy);
    for (const restore of restoreWriters) restore();
  };
}

module.exports = { convertLatexSyntax, installLatexCopy, installClipboardWriter };
