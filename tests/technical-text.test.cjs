const { test } = require("node:test");
const assert = require("node:assert/strict");
const { technicalTokens } = require("../src/technical-text");

test("mixed Chinese prose detects the path without splitting ordinary English", () => {
  const path = "/mnt/data/ruofei/zhangyu/code/HumanoidSoccer";
  const text = `但是现在 GPU 不够。需要你 ssh PAI 然后在 ${path} 路径下完成代码同步并开启 training`;
  const tokens = technicalTokens(text);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].text, path);
  assert.equal(text.slice(tokens[0].from, tokens[0].to), path);
  assert(tokens[0].breaks.includes(path.indexOf("zhangyu")));
  assert.deepEqual(technicalTokens("RL training Antidisestablishmentarianism normal English"), []);
});

test("URLs preserve scheme, percent escapes, query and punctuation", () => {
  const url = "https://example.com/a%20b/%aB%fF/checkpoints?model=large&step=100#result";
  const [token] = technicalTokens(`(${url}).`);
  assert.equal(token.text, url);
  assert(token.breaks.every(offset => offset > "https://".length));
  for (const escape of url.matchAll(/%[a-f\d]{2}/gi)) {
    assert(!token.breaks.some(offset => [escape.index + 1, escape.index + 2].includes(offset)));
  }
  assert(token.breaks.includes(url.indexOf("model")));
});

test("Windows, UNC, relative and Unicode paths retain exact source", () => {
  for (const path of ["D:\\Study\\Documents\\notes.md", "\\\\server\\share\\notes.md", "../scripts/run_training.py", "~/code/project/main.py", "./数据/训练/checkpoint.pt"]) {
    const [token] = technicalTokens(path);
    assert.equal(token.text, path);
    assert(token.breaks.length > 0);
    let previous = 0;
    const chunks = token.breaks.map(offset => {
      assert(offset > previous && offset < path.length);
      const chunk = path.slice(previous, offset); previous = offset; return chunk;
    });
    assert.equal(chunks.join("") + path.slice(previous), path);
  }
});

test("long technical identifiers have boundaries but ordinary words remain untouched", () => {
  for (const text of ["MODEL_CHECKPOINT_OUTPUT_DIRECTORY", "myVeryLongCheckpointOutputDirectory"]) {
    const [token] = technicalTokens(text);
    assert.equal(token.text, text);
    assert(token.breaks.length > 0);
  }
  assert.deepEqual(technicalTokens("and/or GPU PAI training"), []);
});
