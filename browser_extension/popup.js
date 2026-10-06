const element = id => document.getElementById(id);
let page = null, sourceId = null, windowId = null, queue = null, reading = false, loadingAll = false, preparing = false;
let chosen = new Set(), cancelLoad = false;
const busy = () => preparing || Boolean(queue?.running || queue?.pending.length);
const displayBook = book => element('clean').checked ? {...book, ...cleanBook(book)} : book;
const selected = () => page?.books.filter(book => chosen.has(book.id)).map(displayBook) || [];
const downloadable = books => books.filter(book => { try { prepareBrowserDownload(book, page.pageUrl, page.name); return true; } catch { return false; } });
function status(message, error = false) { element('status').textContent = message; element('status').classList.toggle('error', error); }
function target() {
  element('target').textContent = queue && page ? `${queue.directory.name} / ${safeBrowserName(page.name)}` : '选择父目录，自动创建书单文件夹';
}
function update() {
  const count = chosen.size, total = page?.books.length || 0;
  element('selection').textContent = `${count} / ${total} 本已选`;
  element('all').checked = total > 0 && count === total;
  element('all').indeterminate = count > 0 && count < total;
  element('all').disabled = !total || busy() || loadingAll || reading;
  element('clean').disabled = busy() || loadingAll || reading;
  element('read').disabled = busy() || loadingAll || reading;
  element('choose-folder').disabled = busy();
  element('export').disabled = busy() || loadingAll || reading || !selected().length;
  element('start').disabled = busy() || loadingAll || reading || !queue || !element('rights').checked || !downloadable(selected()).length;
  element('start').hidden = Boolean(queue?.running || queue?.pending.length);
  element('pause').hidden = !queue?.running || queue.paused;
  element('resume').hidden = !queue?.paused;
  element('resume').disabled = Boolean(queue?.running);
  element('resume').textContent = queue?.error ? '重试并继续' : '继续下载';
  element('stop').hidden = !queue?.running && !queue?.pending.length;
  element('rights').disabled = busy();
  element('load-all').disabled = busy() || reading;
  element('load-all').textContent = loadingAll ? '停止加载' : '加载全部';
}
function renderBooks() {
  const search = element('search').value.trim().toLocaleLowerCase();
  const books = page?.books.map(displayBook).filter(book => `${book.title} ${book.author}`.toLocaleLowerCase().includes(search)) || [];
  const states = new Map(queue?.results.map(result => [result.id, result.skipped ? '已存在 · 大小相同' : '已保存']) || []);
  if (queue?.active) states.set(queue.active.id, '正在下载');
  element('books').replaceChildren(...books.map(book => {
    const label = document.createElement('label'); label.className = 'book';
    const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.id = book.id;
    input.checked = chosen.has(book.id); input.disabled = busy() || loadingAll || reading;
    const content = document.createElement('span'); content.className = 'book-content';
    const title = document.createElement('span'); title.className = 'book-title'; title.textContent = book.title;
    const author = document.createElement('span'); author.className = 'book-author'; author.textContent = book.author || '作者未标注';
    content.append(title, author);
    if (states.has(book.id)) { const state = document.createElement('span'); state.className = 'book-state'; state.textContent = states.get(book.id); content.append(state); }
    const format = document.createElement('span'); format.className = 'book-format';
    format.textContent = downloadable([book]).length ? book.extension.toUpperCase() : '仅书目';
    label.append(input, content, format); return label;
  }));
  if (!books.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    empty.textContent = page ? '没有匹配的书籍' : '在书单网页点击扩展，读取书名和作者'; element('books').append(empty);
  }
  element('filtered-note').hidden = !search;
  element('filtered-note').textContent = `显示 ${books.length} 本；全选作用于整份已加载书单。`;
}
function applyPage(next) {
  if (!next?.books?.length) throw new Error('当前页未识别到书单，请在书单网页点击扩展。');
  const same = page?.pageUrl === next.pageUrl;
  const allChosen = same && chosen.size === page.books.length;
  const old = chosen;
  // 标识只在本地使用，保留相同书目的选择；不将下载地址存入磁盘。
  next.books = next.books.map((book, index) => ({...book, id: `${index}:${book.title}\n${book.download}`}));
  page = next; chosen = new Set(page.books.filter(book => !same || allChosen || old.has(book.id)).map(book => book.id));
  element('booklist-name').textContent = page.name;
  element('source-host').textContent = new URL(page.pageUrl).hostname;
  const total = Number(String(page.total).replace(/[,\s]/g, ''));
  const partial = total > page.books.length;
  element('source-note').textContent = `已读取 ${page.books.length} 本${partial ? ` / 共 ${total} 本` : ''}`;
  element('load-all').hidden = !partial;
  target(); renderBooks(); update();
}
async function snapshot(tabId) {
  const [result] = await chrome.scripting.executeScript({target: {tabId}, func: readBookPage});
  return result.result;
}
async function readCurrent(tabId) {
  if (busy() || reading || loadingAll) { status('当前任务结束或停止后，可以读取其他书单。'); return; }
  reading = true; update();
  try {
    if (!Number.isInteger(tabId)) { const [tab] = await chrome.tabs.query({active: true, currentWindow: true}); tabId = tab.id; }
    const next = await snapshot(tabId); applyPage(next); sourceId = tabId;
    // 新书单不沿用上一个任务的结果或下载权确认，目录授权仍可复用。
    if (queue) { queue.results = []; queue.items = []; queue.diagnostics = []; queue.error = ''; queue.stopped = false; }
    element('transfer').hidden = true; element('diagnostic-box').hidden = true;
    element('rights').checked = false;
    status('已读取当前页。书籍和 Excel 会保存到同一个书单文件夹。');
  } catch (error) { status(`读取失败：${error.message}。请在目标网页再次点击工具栏扩展图标。`, true); if (!page) { element('booklist-name').textContent = '打开一份书单'; element('source-note').textContent = '支持网页中的书籍卡片'; renderBooks(); } }
  finally { reading = false; renderBooks(); update(); }
}
async function loadAll() {
  if (loadingAll) { cancelLoad = true; return; }
  if (!page || busy()) return;
  loadingAll = true; cancelLoad = false; renderBooks(); update();
  try {
    // 只点击原网页的“加载更多”，不调用未公开接口，不发并发请求。
    for (let step = 0; step < 500 && !cancelLoad; step++) {
      const expected = Number(String(page.total).replace(/[,\s]/g, ''));
      if (expected && page.books.length >= expected) break;
      const count = page.books.length;
      const [result] = await chrome.scripting.executeScript({target: {tabId: sourceId}, func: clickLoadMore});
      if (!result.result) break;
      let grew = false;
      for (let poll = 0; poll < 25 && !cancelLoad; poll++) {
        await new Promise(resolve => setTimeout(resolve, 600));
        const next = await snapshot(sourceId);
        if (next.pageUrl !== page.pageUrl) throw new Error('来源网页已切换，请重新读取当前页');
        if (next.books.length > count) { applyPage(next); grew = true; status(`已读取 ${next.books.length} 本，正在加载更多…`); break; }
      }
      if (!grew && !cancelLoad) throw new Error('等待加载更多超时，已保留读取到的书目；请检查原网页后再试');
    }
    const total = Number(String(page.total).replace(/[,\s]/g, ''));
    status(cancelLoad ? `已停止加载，保留 ${page.books.length} 本。` : total > page.books.length ? `目前读取 ${page.books.length} / ${total} 本；原网页未提供可点击的加载按钮。` : `全部 ${page.books.length} 本已读取。`);
  } catch (error) { status(error.message, true); }
  finally { loadingAll = false; renderBooks(); update(); }
}
function formatBytes(bytes) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`; }
let lastRenderedResult = '', lastPaint = 0;
function showQueue(current) {
  const signature = `${current.results.length}:${current.active?.id}:${current.running}:${current.paused}:${current.stopped}`;
  const now = Date.now();
  if (signature === lastRenderedResult && now - lastPaint < 200) return;
  lastPaint = now;
  if (signature !== lastRenderedResult) { lastRenderedResult = signature; renderBooks(); }
  const processed = current.results.length, total = current.items?.length || 0;
  const saved = current.results.filter(result => !result.skipped).length;
  const skipped = processed - saved;
  const revealTransfer = element('transfer').hidden;
  element('transfer').hidden = false;
  element('task-count').textContent = `${processed} / ${total} 本`;
  element('batch-progress').value = total ? processed / total * 100 : 0;
  element('batch-note').textContent = `已保存 ${saved} 本 · 已跳过 ${skipped} 本 · 剩余 ${current.pending.length} 本`;
  const wait = Math.max(0, Math.ceil((current.nextAt - now) / 1000));
  element('current-title').textContent = current.active?.title || (current.paused ? '任务已暂停' : current.stopped ? '任务已停止' : current.pending.length ? `${wait} 秒后下载下一本` : '下载完成');
  if (current.active && !current.total) element('file-progress').removeAttribute('value');
  else element('file-progress').value = current.active ? Math.min(100, current.bytes / current.total * 100) : current.pending.length ? 0 : 100;
  const phase = {connecting:'正在连接',receiving:'正在下载',checking:'校验大小',saving:'正在保存'}[current.phase];
  element('bytes').textContent = current.active ? `${phase} · ${formatBytes(current.bytes)}${current.total ? ` / ${formatBytes(current.total)}` : ' · 总大小未知'}` : current.paused ? '继续时重试未完成书籍' : current.pending.length ? '下载间隔中' : '书籍与 Excel 已保存到书单文件夹';
  element('speed').textContent = `${formatBytes(current.active && current.phase === 'receiving' ? current.speed : 0)}/s`;
  element('diagnostic-box').hidden = !current.diagnostics.length;
  element('diagnostic').textContent = JSON.stringify(current.diagnostics.slice(-5), null, 2);
  if (current.error) status(current.error, true);
  else if (current.paused) status('已暂停，未完成文件已清理。');
  else if (current.stopped) status('已停止，已经保存的书籍和 Excel 保留。');
  else if (!current.running && !current.pending.length) status(`已完成：保存 ${saved} 本，跳过 ${skipped} 本同名同大小文件。`);
  if (revealTransfer) element('transfer').scrollIntoView({block:'nearest'});
  update();
}
async function authorizeDownload() {
  const source = new URL(page.pageUrl); const origins = [`${source.origin}/*`];
  if (source.hostname === 'z-library.website') origins.push('https://dln1.ncdn.ec/*');
  if (!await chrome.permissions.request({origins}) || !await chrome.permissions.contains({origins})) throw new Error('网站授权未生效，请允许书单来源与文件服务器的访问权限后重试。');
}
async function exportExcel(books) {
  const bytes = await createBooklistExcel(page.name, books);
  if (queue) return saveBooklistExcel(queue.directory, page.name, bytes);
  // 单独导出且尚未选目录时，只弹出一次 Excel 保存对话框。
  const url = URL.createObjectURL(new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  try { await chrome.downloads.download({url, filename: `${safeBrowserName(page.name)}.xlsx`, saveAs: true}); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
  return `${safeBrowserName(page.name)}.xlsx`;
}
element('read').addEventListener('click', () => readCurrent());
element('load-all').addEventListener('click', loadAll);
element('search').addEventListener('input', renderBooks);
element('all').addEventListener('change', () => { chosen = new Set(element('all').checked ? page.books.map(book => book.id) : []); renderBooks(); update(); });
element('books').addEventListener('change', event => { const id = event.target.dataset.id; if (!id) return; if (event.target.checked) chosen.add(id); else chosen.delete(id); update(); });
element('clean').addEventListener('change', () => { element('clean-note').hidden = !element('clean').checked; renderBooks(); });
element('rights').addEventListener('change', update);
element('choose-folder').addEventListener('click', async () => {
  if (busy()) return;
  try {
    const directory = await window.showDirectoryPicker({id:'booklist-download',mode:'readwrite'});
    queue = new DirectoryQueue(directory, showQueue); target(); update();
    status('保存位置已选择，将按书单名称创建子文件夹。');
  } catch (error) { if (error.name !== 'AbortError') status(`无法选择目录：${error.message}`, true); }
});
element('interval').addEventListener('change', async () => {
  if (!element('interval').reportValidity()) return;
  try { const seconds = Number(element('interval').value); if (queue) queue.setInterval(seconds); await chrome.storage.local.set({intervalSeconds:seconds}); }
  catch (error) { status(error.message, true); }
});
element('export').addEventListener('click', async () => {
  if (busy() || !selected().length) return;
  preparing = true; renderBooks(); update();
  try { const filename = await exportExcel(selected()); status(`已导出 ${selected().length} 本：${filename}`); }
  catch (error) { status(`Excel 导出失败：${error.message}`, true); }
  finally { preparing = false; renderBooks(); update(); }
});
element('start').addEventListener('click', async () => {
  if (busy() || !queue || !element('rights').checked || !element('interval').reportValidity()) return;
  const books = selected(), downloadBooks = downloadable(books);
  if (!downloadBooks.length) return;
  preparing = true; renderBooks(); update();
  try {
    queue.setInterval(Number(element('interval').value));
    // 权限请求必须直接来自这个点击动作，不能排在异步 Excel 生成之后。
    await authorizeDownload();
    const items = downloadBooks.map(book => prepareBrowserDownload(book, page.pageUrl, page.name));
    status('正在生成 Excel 书单…');
    const filename = await exportExcel(books);
    status(`Excel 已保存：${filename}。开始下载 ${items.length} 本。`);
    element('transfer').hidden = true;
    const promise = queue.start(items); preparing = false; update(); await promise;
  } catch (error) { status(error.message, true); }
  finally { preparing = false; renderBooks(); update(); }
});
element('pause').addEventListener('click', () => queue?.pause());
element('stop').addEventListener('click', () => queue?.stop());
element('resume').addEventListener('click', async () => {
  if (!queue?.paused || queue.running) return;
  preparing = true; update();
  try { await authorizeDownload(); const promise = queue.resume(); preparing = false; await promise; }
  catch (error) { status(error.message, true); }
  finally { preparing = false; update(); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  const source = changes[`source-${windowId}`]?.newValue;
  if (area === 'session' && source) readCurrent(source.tabId);
});
window.addEventListener('beforeunload', event => { if (busy()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { cancelLoad = true; queue?.stop(); });
async function initialize() {
  const currentWindow = await chrome.windows.getCurrent(); windowId = currentWindow.id;
  const preferences = await chrome.storage.local.get('intervalSeconds');
  const interval = preferences.intervalSeconds;
  element('interval').value = Number.isInteger(interval) && interval >= 30 && interval <= 3600 ? interval : 60;
  const saved = await chrome.storage.session.get(`source-${windowId}`);
  await readCurrent(saved[`source-${windowId}`]?.tabId);
}
initialize().catch(error => status(`初始化失败：${error.message}`, true));
