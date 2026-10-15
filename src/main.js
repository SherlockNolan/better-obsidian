const { Plugin } = require("obsidian");
const { EditorView } = require("@codemirror/view");
const { CodeBlocks } = require("./code-blocks");
const { loadSettings, BetterObsidianSettings } = require("./settings");
const { convertLatexSyntax, installLatexCopy } = require("./latex-copy");
const { installPaste, installCodePaste } = require("./html-paste");
const { NavigationHistory } = require("./navigation-history");

module.exports = class BetterObsidian extends Plugin {
  async onload() {
    this.active = true;
    this.settings = await loadSettings(this);
    this.windowCleanups = new Map();
    this.convertedCopyEvents = new WeakSet();
    this.editorExtensions = [];
    this.navigationHistory = new NavigationHistory(this);
    await this.navigationHistory.load();
    this.codeBlocks = new CodeBlocks(this);
    await this.codeBlocks.load();
    if (!this.active) return;
    this.copyExtension = EditorView.clipboardOutputFilter.of(text => {
      // Apply the reference converter exactly once per copy. The filter also
      // runs for drag/cut, which should retain their native behavior.
      if (!this.settings.copyLatexEnabled || !this.currentCopyEvent) return text;
      this.convertedCopyEvents.add(this.currentCopyEvent);
      return convertLatexSyntax(text);
    });
    this.registerEditorExtension(this.editorExtensions);
    this.pasteExtension = installPaste(this);
    this.addSettingTab(new BetterObsidianSettings(this.app, this));

    this.attachWindow(window);
    this.app.workspace.iterateAllLeaves(leaf => this.attachWindow(leaf.view.containerEl.ownerDocument.defaultView));
    this.registerEvent(this.app.workspace.on("window-open", (_, win) => this.attachWindow(win)));
    this.registerEvent(this.app.workspace.on("window-close", (_, win) => this.detachWindow(win)));
    this.codeBlocks.apply();

    // Preserve the original plugin's explicit whole-note conversion command.
    this.addCommand({
      id: "convert-latex-to-mathjax",
      name: "转换当前笔记的 LaTeX 分隔符",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return;
        const source = await this.app.vault.read(file);
        const converted = convertLatexSyntax(source);
        if (converted !== source) await this.app.vault.modify(file, converted);
      },
    });
  }

  attachWindow(win) {
    if (!win || this.windowCleanups.has(win)) return;
    const copyCleanup = installLatexCopy(this, win);
    const pasteCleanup = installCodePaste(this, win);
    this.windowCleanups.set(win, () => { pasteCleanup(); copyCleanup(); });
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
    this.editorExtensions.splice(0, this.editorExtensions.length, this.copyExtension, this.pasteExtension,
      this.navigationHistory.extension,
      ...(this.settings.codeScrollEnabled ? this.codeBlocks.extensions : []));
    // Obsidian's supported mechanism for updating a mutable extension array.
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
