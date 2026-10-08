function readBookPage() {
  const siteError = Array.from(document.querySelectorAll('[role="alert"], .alert-danger, .notification-error, .toast-error')).some(node =>
    (!node.getClientRects || node.getClientRects().length) && /发生了错误|请求过于频繁|下载.{0,8}(?:限额|上限)|too many requests|an error (?:has )?occurred|access denied|download limit/i.test(node.textContent || ''))
    ? '来源网页显示错误或限制提示，请在原网页处理后重试。' : '';
  const cards = Array.from(document.querySelectorAll('z-bookcard'));
  // 此函数由 executeScript 独立注入，解析总数的代码必须位于函数内。
  function count(text) {
    const value = String(text || '').trim();
    const match = value.match(/^(?:books?|书籍|书目|图书)\s*[(（]\s*([\d\s,，]+)\s*[)）]$/i);
    const digits = (match ? match[1] : value).replace(/[,，\s]/g, '');
    return /^\d+$/.test(digits) && Number.isSafeInteger(Number(digits)) ? digits : '';
  }
  let total = '';
  for (const node of document.querySelectorAll('[role="tab"], a, button, li, span, div')) {
    if (node.getClientRects && !node.getClientRects().length) continue;
    // 优先页面明确的 BOOKS 总数，不提取评论/年份/文件大小。
    if (!/^(?:books?|书籍|书目|图书)\s*[(（]/i.test(String(node.textContent || '').trim())) continue;
    total = count(node.textContent); if (total) break;
  }
  if (!total) total = count(document.querySelector('.books_count')?.textContent);
  return {
    pageUrl: location.href,
    siteError,
    name: document.title.split(' — ')[0].trim() || '书单',
    total,
    books: cards.map(card => ({
      title: card.querySelector('[slot="title"]')?.textContent.trim() || '',
      author: card.querySelector('[slot="author"]')?.textContent.trim() || '',
      download: card.getAttribute('download') || '',
      extension: card.getAttribute('extension') || '',
    })).filter(book => book.title),
  };
}

function safeBrowserName(text) {
  const value = Array.from(String(text).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()).slice(0, 80).join('').replace(/^[ .]+|[ .]+$/g, '');
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ? `_${value}` : value || '书籍';
}

function prepareBrowserDownload(book, pageUrl, name) {
  const source = new URL(pageUrl);
  const target = new URL(book.download, source);
  const extension = String(book.extension).toLowerCase().replace(/^\./, '');
  const allowed = ['pdf', 'epub', 'txt', 'mobi', 'azw3', 'fb2', 'djvu'];
  if (!book.download || source.protocol !== 'https:' || target.origin !== source.origin || target.username || target.password
      || !allowed.includes(extension)
      || !(/^\/(?:dl|download)\//.test(target.pathname) || allowed.some(ext => target.pathname.toLowerCase().endsWith(`.${ext}`)))) {
    throw new Error('没有可用的同站下载链接或文件格式不支持');
  }
  return {
    url: target.href,
    filename: `${safeBrowserName(name)}/${safeBrowserName(book.title)} - ${safeBrowserName(book.author)}.${extension}`,
    title: book.title,
    author: book.author,
    extension,
    id: book.id,
  };
}

function clickLoadMore() {
  const matches = node => /^(show more|load more|显示更多|加载更多|更多书籍)$/i.test(String(node.value || node.textContent || '').trim());
  const clickable = 'button, a, [role="button"], input[type="button"], input[type="submit"], z-button';
  for (const node of document.querySelectorAll(`${clickable}, div, span`)) {
    // 选最内层的标签后向上找点击控件，避免点击仅包裹按钮的外层容器。
    if (!matches(node) || Array.from(node.children || []).some(matches)) continue;
    const button = node.closest?.(clickable) || node;
    if (button.disabled || button.getAttribute('disabled') !== null || button.getAttribute('aria-disabled') === 'true' || !button.getClientRects().length) continue;
    button.scrollIntoView?.({block:'center'});
    button.click(); return true;
  }
  return false;
}

function booklistReadingState(page) {
  const value = String(page.total ?? '').replace(/[,，\s]/g, '');
  const expected = /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  const loaded = page.books.length;
  return {expected, loaded, complete: expected !== null && loaded === expected};
}

if (typeof module !== 'undefined') module.exports = {readBookPage, safeBrowserName, prepareBrowserDownload, clickLoadMore, booklistReadingState};
