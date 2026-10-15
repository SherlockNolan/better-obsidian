const { PluginSettingTab, Setting } = require("obsidian");

const DEFAULT_SETTINGS = {
  codeScrollEnabled: true,
  codeWrapEnabled: false,
  codeLineNumbersEnabled: false,
  copyLatexEnabled: true,
  compactHtmlPasteEnabled: true,
  navigationHistoryEnabled: true,
  navigationHistoryPersist: true,
  navigationHistoryLimit: 100,
  smartWrapEnabled: true,
};

const LEGACY_SETTINGS = {
  "vscode-theme@@vscode-code-wrap": "codeWrapEnabled",
  "vscode-theme@@vscode-code-line-numbers": "codeLineNumbersEnabled",
};

async function loadSettings(plugin) {
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
  // Persist migrated values first. Reloads always prefer the plugin's own data.
  if (cleaned || Object.keys(DEFAULT_SETTINGS).some(key => !Object.hasOwn(saved, key))) await plugin.saveData(settings);
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

class BetterObsidianSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  toggle(name, description, key) {
    return new Setting(this.containerEl).setName(name).setDesc(description)
      .addToggle(toggle => toggle.setValue(this.plugin.settings[key])
        .onChange(value => this.plugin.setFeature(key, value)));
  }

  display() {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("正文排版").setHeading();
    this.toggle("路径与 URL 智能断行", "在阅读视图和实时预览中，为路径、URL 和长标识符提供分隔符断行点；超长片段允许继续拆分，普通英文单词保持原有规则。仅影响显示，不插入零宽字符，不改变链接或代码块。两端对齐仍由主题控制。默认开启。", "smartWrapEnabled");
    new Setting(this.containerEl).setName("导航历史").setHeading();
    this.toggle("笔记内位置前进／后退", "记录标题／块链接、大纲、搜索、点击编辑行和较大的光标或滚动跳转。直接使用顶部箭头及原生 Navigate back／forward 命令与快捷键，无需单独绑定插件命令。每个标签页分别记录，默认开启。", "navigationHistoryEnabled");
    this.toggle("重启后保留导航历史", "保存每个标签页的笔记路径、光标和滚动位置，不保存笔记正文。默认开启。", "navigationHistoryPersist");
    new Setting(this.containerEl).setName("每个方向的历史数量上限").setDesc("每个标签页最多保留多少个历史位置；20–500，默认 100。")
      .addSlider(slider => slider.setLimits(20, 500, 10).setValue(this.plugin.settings.navigationHistoryLimit)
        .setDynamicTooltip().onChange(value => this.plugin.setFeature("navigationHistoryLimit", value)));
    new Setting(this.containerEl).setName("代码块").setHeading();
    this.toggle("代码块增强（code-scroll）", "启用实时预览代码块横向滚动、与阅读视图一致的高亮及 PDF 折行标记。代码配色与字体由当前主题和 Obsidian 外观设置提供。默认开启。", "codeScrollEnabled");
    this.toggle("代码块自动折行", "在实时预览和阅读视图中折行，可断开长词和路径；关闭时横向滚动。PDF 导出始终折行。需要开启代码块增强，默认关闭。", "codeWrapEnabled");
    this.toggle("代码块行号", "在实时预览、阅读视图及 PDF 中显示行号，每个代码块从 1 开始；空行计数，折行续行不重复编号。需要开启代码块增强，默认关闭。", "codeLineNumbersEnabled");
    new Setting(this.containerEl).setName("剪贴板与粘贴").setHeading();
    this.toggle("复制时转换 LaTeX", "复制或粘贴外部内容时，将 \\(…\\) 转为 $…$、\\[…\\] 转为 $$…$$。支持编辑区、阅读视图、代码块复制按钮及外部纯文本／HTML 粘贴。默认开启。", "copyLatexEnabled");
    this.toggle("取消粘贴转换时新增的空行", "开启 Obsidian 的“粘贴时将 HTML 转换为 Markdown”时，去掉列表项之间及列表末尾自动新增的缩进空行，保留列表后无缩进的段落分隔空行。普通段落和同一列表项内的段落间距保持原生行为。默认开启。", "compactHtmlPasteEnabled");
  }
}

module.exports = { DEFAULT_SETTINGS, loadSettings, BetterObsidianSettings };
