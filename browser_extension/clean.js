// 只删除可识别的附加信息；不凭格式猜测陌生人名或书名。
function cleanBook(book) {
  function cleanBrackets(text, remove) {
    const pairs = { "(": ")", "（": "）", "[": "]", "【": "】" };
    let output = "";
    for (let i = 0; i < text.length; i += 1) {
      const close = pairs[text[i]];
      if (!close) { output += text[i]; continue; }
      const stack = [close];
      let j = i + 1;
      for (; j < text.length && stack.length; j += 1) {
        if (pairs[text[j]]) stack.push(pairs[text[j]]);
        else if (text[j] === stack[stack.length - 1]) stack.pop();
      }
      if (stack.length) { output += text.slice(i); break; }
      const content = text.slice(i + 1, j - 1);
      if (!remove(content, output)) output += text.slice(i, j);
      i = j - 1;
    }
    return output.trim();
  }
  function splitAuthors(text) {
    const pairs = { "(": ")", "（": "）", "[": "]", "【": "】" };
    const stack = [], parts = [];
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      if (pairs[text[i]]) stack.push(pairs[text[i]]);
      else if (text[i] === stack[stack.length - 1]) stack.pop();
      else if (!stack.length && /[,，;；、]/.test(text[i])) {
        parts.push(text.slice(start, i)); start = i + 1;
      }
    }
    return [...parts, text.slice(start)];
  }
  const series = /^译文经典(?:[·・]?精装|[（(]精装本?[）)])?$/;
  const promo = /上海译文出品|豆瓣.{0,30}(?:评分|高分|打出)|倾情推荐|文学.{0,30}(?:杰作|之作|鼻祖)|日版.{0,15}聊斋/;
  let title = cleanBrackets(book.title, content => series.test(content.trim()) || promo.test(content));
  title = title.replace(/^译文经典[·・]\s*/, "").trim() || book.title;
  let author = cleanBrackets(book.author, (content, before) => {
    const value = content.trim();
    if (/^(?:英|美|法|德|日|俄|苏联|印度|捷克|奥地利|意大利)$/.test(value)) return true;
    return value && value.replace(/\s/g, "") === before.trim().replace(/\s/g, "");
  });
  author = splitAuthors(author).map(part => part.trim())
    .filter(part => part && !/(?:\s+(?:译|翻译|校译|编译|译注)|[（(](?:译|译者)[）)])$/.test(part) && part !== "ePUBw")
    .map(part => part.replace(/\s+著$/, "").trim()).filter(Boolean).join("、");
  // 全部都像译者时保留原文，交给用户确认，而不是生成空作者。
  if (!author && book.author) author = book.author;
  return { title, author };
}

if (typeof module !== "undefined") module.exports = { cleanBook };
