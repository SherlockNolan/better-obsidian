require("esbuild").buildSync({
  entryPoints: ["src/main.js"],
  outfile: "main.js",
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  external: ["obsidian", "@codemirror/*"],
  logLevel: "info",
});
