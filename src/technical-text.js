// Display-only break opportunities. Never add invisible characters to Markdown.
const TOKENS = /(?:[a-z][a-z\d+.-]*:\/\/|www\.|[A-Za-z]:[\\/]|\\\\|(?:~|\.{1,2})[\\/]|\/)[^\s<>"'`，。；：！？、（）【】《》]+|[A-Za-z\d_.~-]+(?:\/[A-Za-z\d_.~!$%&+;=@-]+)+|[A-Za-z_][A-Za-z\d_]{23,}/giu;

function technicalTokens(text) {
  const result = [];
  for (const match of text.matchAll(TOKENS)) {
    let value = match[0].replace(/[.,;:!?]+$/, "");
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
      while (value.endsWith(close) && value.split(close).length > value.split(open).length) value = value.slice(0, -1);
    }
    if (value.length < 8) continue;
    const path = /[\\/]/.test(value) || /^www\./i.test(value);
    if (!path && !/_|[a-z\d][A-Z]/.test(value)) continue;
    const prefix = value.match(/^(?:[a-z][a-z\d+.-]*:\/\/|[A-Za-z]:[\\/]|\\\\|[~.]?[\\/])/i)?.[0].length || 0;
    const encoded = new Set();
    for (const escape of value.matchAll(/%[a-f\d]{2}/gi)) {
      encoded.add(escape.index + 1);
      encoded.add(escape.index + 2);
    }
    const breaks = [];
    for (let i = Math.max(1, prefix); i < value.length - 1; i++) {
      if (encoded.has(i + 1)) continue;
      const current = value[i], next = value[i + 1];
      if (/[\\/_?&#=\-]/.test(current) && !/[\\/_?&#=\-]/.test(next)) breaks.push(i + 1);
      else if (/[a-z\d]/.test(current) && /[A-Z]/.test(next)) breaks.push(i + 1);
    }
    result.push({ from: match.index, to: match.index + value.length, text: value, breaks });
  }
  return result;
}

module.exports = { technicalTokens };
