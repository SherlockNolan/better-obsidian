const { loadPrism } = require("obsidian");
const codeScroll = require("./code-scroll");

const BODY_CLASSES = [
  "better-obsidian-code-enabled", "better-obsidian-code-wrap", "better-obsidian-code-line-numbers",
];

class CodeBlocks {
  constructor(plugin) {
    this.plugin = plugin;
    this.extensions = [];
  }

  async load() {
    const prism = await loadPrism();
    if (!this.plugin.active) return;
    this.extensions = codeScroll.createEditorExtensions(prism);
    this.plugin.registerMarkdownPostProcessor(async element => {
      if (!this.plugin.active || !this.plugin.settings.codeScrollEnabled) return;
      await loadPrism(); // Native Reading-view Prism runs asynchronously first.
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
}

module.exports = { CodeBlocks };
