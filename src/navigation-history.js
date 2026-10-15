const { EditorView } = require("@codemirror/view");

const SEARCH_INPUT = ".document-search-input, .cm-search input, .prompt-input, .search-input-container input";
const POSITION_CLICK = ".cm-content, .internal-link, .cm-hmd-internal-link, .tree-item-self, .search-result-file-match, .search-result-file-title";

function markdown(leaf) {
  return leaf?.view?.getViewType() === "markdown" && !!leaf.view.file;
}

function position(state) {
  const result = {};
  if (Number.isFinite(state?.scroll)) result.scroll = Math.max(0, state.scroll);
  if (state?.cursor) {
    const point = value => value && Number.isInteger(value.line) && value.line >= 0 &&
      Number.isInteger(value.ch) && value.ch >= 0 ? { line: value.line, ch: value.ch } : null;
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

// Native history stores ViewState + EphemeralState. Keeping that shape means
// commands, toolbar buttons, mouse navigation and history menus all use one stack.
class NavigationHistory {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.leaves = new Map();
    this.windows = new Map();
    this.running = true;
    this.saved = {};
    this.saveQueue = Promise.resolve();
    this.extension = EditorView.updateListener.of(update => this.onEditorUpdate(update));
    this.path = `${this.app.vault.configDir}/plugins/${plugin.manifest.id}/navigation-history.json`;
  }

  get enabled() { return this.running && this.plugin.active && this.plugin.settings.navigationHistoryEnabled; }
  get limit() { return Math.max(20, Math.min(500, Number(this.plugin.settings.navigationHistoryLimit) || 100)); }

  async load() {
    const adapter = this.app.vault.adapter;
    try {
      if (await adapter.exists(this.path)) {
        const data = JSON.parse(await adapter.read(this.path));
        if (data.version === 1 && data.leaves && typeof data.leaves === "object") this.saved = data.leaves;
      }
    } catch (error) { console.warn("Better Obsidian: could not read navigation history", error); }
    this.app.workspace.onLayoutReady(() => { if (this.running) this.syncLeaves(); });
    this.plugin.registerEvent(this.app.workspace.on("layout-change", () => this.syncLeaves()));
    this.plugin.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncLeaves()));
    this.plugin.registerEvent(this.app.workspace.on("file-open", () => this.syncLeaves()));
    this.plugin.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.onRename(file.path, oldPath)));
    this.plugin.registerEvent(this.app.vault.on("delete", file => this.onDelete(file.path)));
  }

  wrap(object, key, make, cleanups) {
    const original = object[key];
    if (typeof original !== "function") return;
    const wrapped = make(original);
    object[key] = wrapped;
    cleanups.push(() => { if (object[key] === wrapped) object[key] = original; });
  }

  capture(leaf) {
    if (!markdown(leaf)) return null;
    const entry = leaf.getHistoryState();
    return { ...entry, state: { ...entry.state, state: { ...entry.state.state } }, eState: position(entry.eState) };
  }

  syncLeaves() {
    if (!this.running) return;
    const live = new Set();
    this.app.workspace.iterateAllLeaves(leaf => {
      live.add(leaf);
      // Patch the native history once per leaf, including leaves whose view changes.
      if (leaf.history && !this.leaves.has(leaf)) this.attachLeaf(leaf);
      const tracker = this.leaves.get(leaf);
      if (!tracker) return;
      if (tracker.view !== leaf.view) {
        tracker.viewCleanups.splice(0).reverse().forEach(cleanup => cleanup());
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
    this.wrap(leaf, "getHistoryState", original => function(...args) {
      const entry = original.apply(this, args);
      if (manager.enabled && markdown(this)) {
        // MarkdownView.scroll can lag behind manual scrolling. Read the current
        // mode directly, in Obsidian's logical scroll units (not pixels).
        const mode = this.view.currentMode;
        const state = {};
        mode?.getEphemeralState?.(state);
        state.scroll = mode?.getScroll?.();
        entry.eState = position(state);
      }
      return entry;
    }, tracker.cleanups);
    this.wrap(leaf, "recordHistory", original => function(entry) {
      if (!manager.enabled || entry?.state?.type !== "markdown") return original.call(this, entry);
      if (!samePosition(this.history.backHistory.at(-1), entry)) this.history.pushState(entry);
    }, tracker.cleanups);
    this.wrap(leaf.history, "pushState", original => function(entry) {
      const result = original.call(this, entry);
      if (manager.enabled) {
        this.backHistory.splice(0, Math.max(0, this.backHistory.length - manager.limit));
        manager.scheduleSave();
      }
      return result;
    }, tracker.cleanups);
    this.wrap(leaf.history, "go", original => async function(amount) {
      if (!manager.enabled) return original.call(this, amount);
      // Flush a just-completed jump before the first back click; no 80ms race.
      manager.finish(tracker);
      if (tracker.navigating || leaf.working) return;
      const stack = amount < 0 ? this.backHistory : this.forwardHistory;
      const target = stack[Math.max(0, stack.length - Math.abs(amount))];
      tracker.navigating++;
      tracker.search = null;
      try {
        const result = await original.call(this, amount);
        // Other position-memory plugins can restore stale coordinates after a
        // file-open event. Reapply the explicit history target after settling.
        await new Promise(resolve => setTimeout(resolve, 120));
        if (manager.running && target?.state?.type === "markdown" && markdown(leaf) &&
            leaf.view.file.path === target.state.state.file) leaf.view.setEphemeralState(position(target.eState));
        return result;
      } finally {
        tracker.snapshot = manager.capture(leaf);
        tracker.navigating--;
        manager.scheduleSave();
      }
    }, tracker.cleanups);
    const saved = this.saved[leaf.id];
    if (this.enabled && this.plugin.settings.navigationHistoryPersist && saved &&
        !leaf.history.backHistory.length && !leaf.history.forwardHistory.length) {
      leaf.history.backHistory = this.validEntries(saved.back);
      leaf.history.forwardHistory = this.validEntries(saved.forward);
      leaf.trigger("history-change");
    }
  }

  attachView(leaf, tracker) {
    if (!markdown(leaf)) return;
    const manager = this;
    this.wrap(leaf.view, "setEphemeralState", original => function(state) {
      const jump = state && ["subpath", "line", "startLoc", "cursor", "scroll"].some(key => Object.hasOwn(state, key));
      if (manager.enabled && jump && !tracker.navigating && !leaf.working) manager.begin(tracker, "jump");
      const result = original.call(this, state);
      if (jump) manager.settle(tracker, 80);
      return result;
    }, tracker.viewCleanups);
    tracker.snapshot = this.capture(leaf);
  }

  trackerFor(target) {
    const root = target?.closest?.(".workspace-leaf");
    for (const [leaf, tracker] of this.leaves) if (root === leaf.containerEl && markdown(leaf)) return tracker;
    const leaf = this.app.workspace.getMostRecentLeaf?.();
    return markdown(leaf) ? this.leaves.get(leaf) : null;
  }

  begin(tracker, kind, before = this.capture(tracker?.leaf)) {
    if (!this.enabled || !tracker || tracker.navigating || tracker.leaf.working || !before) return;
    // A search should have one origin, rather than one entry per incremental match.
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
      // File changes already enter the native stack through recordHistory.
      if (before.state.state.file === after.state.state.file && !samePosition(before, after) &&
          (pending.kind !== "scroll" || Math.abs((before.eState.scroll || 0) - (after.eState.scroll || 0)) >= 3)) {
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
      // Typing, paste and undo are edits, not navigation. Do not record them.
      tracker.pending = null;
      clearTimeout(tracker.timer);
      tracker.snapshot = this.capture(tracker.leaf);
      return;
    }
    if (!update.selectionSet) return;
    const before = tracker.snapshot || this.capture(tracker.leaf);
    if (before) {
      const point = offset => {
        const line = update.startState.doc.lineAt(offset);
        return { line: line.number - 1, ch: offset - line.from };
      };
      const selection = update.startState.selection.main;
      before.eState.cursor = { from: point(selection.anchor), to: point(selection.head) };
      const lineDelta = Math.abs(update.state.doc.lineAt(update.state.selection.main.head).number -
        update.startState.doc.lineAt(selection.head).number);
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
    on("pointerdown", event => {
      if (event.button !== 0 || !event.target?.closest?.(POSITION_CLICK)) return;
      const tracker = this.trackerFor(event.target);
      this.begin(tracker, "click");
    });
    on("pointerup", event => this.settle(this.trackerFor(event.target)));
    on("click", event => {
      if (!event.target?.closest?.(POSITION_CLICK)) return;
      const tracker = this.trackerFor(event.target);
      this.begin(tracker, "click", tracker?.snapshot);
      this.settle(tracker);
    });
    on("wheel", event => {
      if (!event.deltaY || !event.target?.closest?.(".cm-scroller, .markdown-preview-view")) return;
      const tracker = this.trackerFor(event.target);
      this.begin(tracker, "scroll");
      this.settle(tracker, 250);
    });
    on("touchstart", event => {
      if (event.target?.closest?.(".cm-scroller, .markdown-preview-view")) this.begin(this.trackerFor(event.target), "scroll");
    });
    on("scroll", event => {
      const tracker = this.trackerFor(event.target);
      if (!tracker || tracker.navigating || !this.enabled) return;
      this.settle(tracker, tracker.pending?.kind === "scroll" ? 250 : 80);
      if (!tracker.pending) tracker.snapshot = this.capture(tracker.leaf);
    });
    on("focusin", event => {
      if (!event.target?.closest?.(SEARCH_INPUT)) return;
      const tracker = this.trackerFor(event.target);
      if (this.enabled && tracker && !tracker.navigating) tracker.search ||= this.capture(tracker.leaf);
    });
    on("focusout", event => {
      if (!event.target?.closest?.(SEARCH_INPUT)) return;
      const tracker = this.trackerFor(event.target);
      if (tracker) {
        clearTimeout(tracker.searchTimer);
        tracker.searchTimer = setTimeout(() => { tracker.search = null; }, 300);
      }
    });
    this.windows.set(win, cleanups);
  }

  detachWindow(win) {
    this.windows.get(win)?.reverse().forEach(cleanup => cleanup());
    this.windows.delete(win);
  }

  validEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.filter(entry => entry?.state?.type === "markdown" &&
      typeof entry.state.state?.file === "string" && this.app.vault.getFileByPath(entry.state.state.file))
      .slice(-this.limit).map(entry => ({ title: entry.title, icon: entry.icon,
        state: { type: "markdown", state: { file: entry.state.state.file,
          mode: entry.state.state.mode === "preview" ? "preview" : "source", source: !!entry.state.state.source } },
        eState: position(entry.eState) }));
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
      back: this.validEntries(leaf.history.backHistory), forward: this.validEntries(leaf.history.forwardHistory),
    };
    const data = JSON.stringify({ version: 1, leaves });
    this.saveQueue = this.saveQueue.catch(() => {}).then(() => this.app.vault.adapter.write(this.path, data))
      .catch(error => console.warn("Better Obsidian: could not save navigation history", error));
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
      for (const key of ["backHistory", "forwardHistory"]) leaf.history[key] = leaf.history[key].filter(entry => {
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
    tracker.viewCleanups.reverse().forEach(cleanup => cleanup());
    tracker.cleanups.reverse().forEach(cleanup => cleanup());
  }

  unload() {
    this.save();
    this.running = false;
    clearTimeout(this.saveTimer);
    for (const win of this.windows.keys()) this.detachWindow(win);
    for (const tracker of this.leaves.values()) this.detachLeaf(tracker);
    this.leaves.clear();
  }
}

module.exports = { NavigationHistory, samePosition, position };
