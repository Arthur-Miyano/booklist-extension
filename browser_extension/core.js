function readBookPage() {
  const cards = Array.from(document.querySelectorAll('z-bookcard'));
  return {
    pageUrl: location.href,
    name: document.title.split(' — ')[0].trim() || '书单',
    total: document.querySelector('.books_count')?.textContent.trim() || '',
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
  const button = Array.from(document.querySelectorAll('button, a, [role="button"]')).find(node =>
    /^(show more|load more|显示更多|加载更多|更多书籍)$/i.test(node.textContent.trim()) &&
    !node.disabled && node.getAttribute('aria-disabled') !== 'true' && node.getClientRects().length);
  if (!button) return false;
  button.click(); return true;
}

if (typeof module !== 'undefined') module.exports = {readBookPage, safeBrowserName, prepareBrowserDownload, clickLoadMore};
