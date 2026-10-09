const element = id => document.getElementById(id);
let page = null, sourceId = null, windowId = null, queue = null, reading = false, loadingAll = false, preparing = false;
let chosen = new Set(), cancelLoad = false;
const busy = () => preparing || Boolean(queue?.running || queue?.pending.length || queue?.pendingRecords.size);
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
  element('start').hidden = Boolean(queue?.running || queue?.pending.length || queue?.pendingRecords.size);
  element('pause').hidden = !queue?.running || queue.paused;
  element('resume').hidden = !queue?.paused;
  element('resume').disabled = Boolean(queue?.running);
  element('resume').textContent = queue?.error ? '重试并继续' : '继续下载';
  element('stop').hidden = !queue?.running && !queue?.pending.length && !queue?.pendingRecords.size;
  element('rights').disabled = busy();
  element('load-all').disabled = busy() || reading;
  element('load-all').textContent = loadingAll ? '停止读取' : '自动读全';
  element('read-interval').disabled = loadingAll || reading;
}
function renderBooks() {
  const search = element('search').value.trim().toLocaleLowerCase();
  const books = page?.books.map(displayBook).filter(book => `${book.title} ${book.author}`.toLocaleLowerCase().includes(search)) || [];
  const states = new Map(queue?.results.map(result => [result.id, result.skipped ? '已存在 · 大小相同' : '已保存']) || []);
  for (const task of queue?.active || []) states.set(task.id, '正在下载');
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
  if (!/^\/booklist\//.test(new URL(next.pageUrl).pathname)) throw new Error('请进入具体书单页后读取，首页和搜索页不会自动展开。');
  if (next.siteError) throw new Error(next.siteError);
  if (!Array.isArray(next?.books) || (!next.books.length && booklistReadingState(next).expected !== 0)) throw new Error('当前页未识别到书单，请在书单网页点击扩展。');
  const same = page?.pageUrl === next.pageUrl;
  const allChosen = same && chosen.size === page.books.length;
  const old = chosen;
  // 标识只在本地使用，保留相同书目的选择；不将下载地址存入磁盘。
  next.books = next.books.map((book, index) => ({...book, id: `${index}:${book.title}\n${book.download}`}));
  page = next; chosen = new Set(page.books.filter(book => !same || allChosen || old.has(book.id)).map(book => book.id));
  element('booklist-name').textContent = page.name;
  element('source-host').textContent = new URL(page.pageUrl).hostname;
  const state = booklistReadingState(page);
  element('source-note').textContent = state.complete ? `读取成功 · ${state.loaded} / ${state.expected} 本，数量一致`
    : state.expected === null ? `已读取 ${state.loaded} 本，未识别书单总数`
    : `已读取 ${state.loaded} / ${state.expected} 本，${state.loaded < state.expected ? `尚缺 ${state.expected - state.loaded} 本` : '数量不一致'}`;
  element('load-all').hidden = state.complete;
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
    const state = booklistReadingState(page);
    status(state.complete ? `读取成功：${state.loaded} / ${state.expected} 本，数量一致。` : state.loaded > state.expected && state.expected !== null ? '数量不一致，请检查原书单。' : state.expected === null ? `已读取 ${state.loaded} 本，未识别总数，无法确认读全。` : `已读取 ${state.loaded} / ${state.expected} 本；点击“自动读全”继续展开。`);
  } catch (error) { page = null; chosen.clear(); sourceId = null; status(`读取失败：${error.message}`, true); element('booklist-name').textContent = '打开一份书单'; element('source-note').textContent = '请在具体书单页读取'; element('load-all').hidden = true; }
  finally { reading = false; renderBooks(); update(); }
}
async function loadAll() {
  if (loadingAll) { cancelLoad = true; return; }
  if (!page || busy()) return;
  if (!element('read-interval').reportValidity()) return;
  if (booklistReadingState(page).expected === null) { status('未识别书单总数，已停止自动展开；请在原网页确认书单数量后重新读取。', true); return; }
  const readInterval = Number(element('read-interval').value) * 1000;
  loadingAll = true; cancelLoad = false; renderBooks(); update();
  try {
    // 只点击原网页的“加载更多”，不调用未公开接口，不发并发请求。
    let batches = 0;
    for (; batches < 500 && !cancelLoad; batches++) {
      if (batches) {
        for (let remaining = readInterval; remaining > 0 && !cancelLoad; remaining -= 600) await new Promise(resolve => setTimeout(resolve, Math.min(600, remaining)));
        if (cancelLoad) break;
      }
      const before = await snapshot(sourceId);
      if (before.pageUrl !== page.pageUrl) throw new Error('来源网页已切换，请重新读取当前页');
      if (before.siteError) throw new Error(before.siteError);
      applyPage(before);
      const state = booklistReadingState(page);
      if (state.complete || (state.expected !== null && state.loaded > state.expected)) break;
      const count = page.books.length;
      let grew = false, clicked = false;
      for (let poll = 0; poll < 25 && !cancelLoad; poll++) {
        // 上一批加载时按钮可能暂时不可点击；只在尚未触发本批时重试，避免重复请求。
        if (!clicked) {
          const [result] = await chrome.scripting.executeScript({target: {tabId: sourceId}, func: clickLoadMore});
          clicked = result.result;
        }
        await new Promise(resolve => setTimeout(resolve, 600));
        const next = await snapshot(sourceId);
        if (next.pageUrl !== page.pageUrl) throw new Error('来源网页已切换，请重新读取当前页');
        if (next.siteError) throw new Error(next.siteError);
        if (next.books.length > count) { applyPage(next); grew = true; status(`正在自动读取：${page.books.length}${booklistReadingState(page).expected !== null ? ` / ${booklistReadingState(page).expected}` : ''} 本…`); break; }
      }
      if (!grew && !cancelLoad) {
        if (!clicked) break;
        const state = booklistReadingState(page);
        throw new Error(`等待加载更多超时：已读取 ${state.loaded}${state.expected !== null ? ` / ${state.expected}` : ''} 本，尚未确认读全；可检查原网页后继续读取。`);
      }
    }
    const verified = await snapshot(sourceId);
    if (verified.pageUrl !== page.pageUrl) throw new Error('来源网页已切换，请重新读取当前页');
    applyPage(verified);
    const state = booklistReadingState(page);
    if (state.complete) status(`读取成功：${state.loaded} / ${state.expected} 本，与书单标注数量一致。`);
    else if (cancelLoad) status(`已停止读取，保留 ${state.loaded} 本；尚未确认读全。`);
    else if (state.expected === null) status(`已读取 ${state.loaded} 本，但未识别页面总数，无法确认读全。`, true);
    else if (state.loaded > state.expected) status(`数量不一致：读取 ${state.loaded} 本，页面标注 ${state.expected} 本，请检查原书单。`, true);
    else status(`尚未读全：${state.loaded} / ${state.expected} 本，尚缺 ${state.expected - state.loaded} 本。${batches >= 500 ? '达到本次 500 批读取上限' : '未找到可点击的“显示更多”'}；可检查原网页后点击“自动读全”。`, true);
  } catch (error) { status(error.message, true); }
  finally { loadingAll = false; renderBooks(); update(); }
}
function formatBytes(bytes) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`; }
let lastRenderedResult = '', lastPaint = 0;
function showQueue(current) {
  const tasks = Array.from(current.active);
  const signature = `${current.results.length}:${tasks.map(task => task.id).join('|')}:${current.concurrency}:${current.running}:${current.paused}:${current.stopped}`;
  const now = Date.now();
  if (signature === lastRenderedResult && now - lastPaint < 200) return;
  lastPaint = now;
  if (signature !== lastRenderedResult) { lastRenderedResult = signature; renderBooks(); }
  const processed = current.results.length, total = current.items?.length || 0;
  const saved = current.results.filter(result => !result.skipped).length;
  const skipped = processed - saved;
  const restored = current.results.filter(result => result.recorded).length;
  const records = current.pendingRecords.size;
  const revealTransfer = element('transfer').hidden;
  element('transfer').hidden = false;
  element('task-count').textContent = `${processed} / ${total} 本`;
  element('batch-progress').value = total ? processed / total * 100 : 0;
  element('batch-note').textContent = `已保存 ${saved} 本 · 已跳过 ${skipped} 本${restored ? `（记录恢复 ${restored} 本，未请求）` : ''} · 剩余 ${current.pending.length + tasks.length} 本${records ? ` · 待补写记录 ${records} 本` : ''}`;
  const wait = Math.max(0, Math.ceil((current.nextAt - now) / 1000));
  const scheduling = current.stopped ? '已停止新增下载' : current.paused ? '已暂停新增下载' : tasks.length >= current.concurrency ? '等待空余名额' : current.pending.length ? `${wait} 秒后启动下一本` : '等待在途下载完成';
  element('current-title').textContent = tasks.length ? `正在下载 ${tasks.length} 本 / 上限 ${current.concurrency} 本` : records ? '完成记录待补写' : current.paused ? '任务已暂停' : current.stopped ? '任务已停止' : current.pending.length ? scheduling : '下载完成';
  element('bytes').textContent = tasks.length ? scheduling : current.paused ? '继续时按原顺序重试' : current.pending.length ? '启动间隔中' : '书籍与 Excel 已保存到书单文件夹';
  element('speed').textContent = `总速度 ${formatBytes(current.speed)}/s`;
  element('active-downloads').replaceChildren(...tasks.map(task => {
    const row = document.createElement('div');
    const title = document.createElement('p'); title.className = 'active-title'; title.textContent = task.title;
    const progress = document.createElement('progress'); progress.max = 100; progress.ariaLabel = `${task.title} 下载进度`;
    if (task.total) progress.value = Math.min(100, task.bytes / task.total * 100); else progress.removeAttribute('value');
    const meta = document.createElement('div'); meta.className = 'active-meta';
    const bytes = document.createElement('span'); const speed = document.createElement('span'); speed.className = 'number';
    const phase = {connecting:'连接中',receiving:'下载中',checking:'校验大小',saving:'保存中'}[task.phase];
    bytes.textContent = `${phase} · ${formatBytes(task.bytes)}${task.total ? ` / ${formatBytes(task.total)}` : ' · 总大小未知'}`;
    speed.textContent = `${formatBytes(task.phase === 'receiving' ? task.speed : 0)}/s`;
    meta.append(bytes, speed); row.append(title, progress, meta); return row;
  }));
  element('diagnostic-box').hidden = !current.diagnostics.length;
  element('diagnostic').textContent = JSON.stringify(current.diagnostics.slice(-5), null, 2);
  if (current.error) status(`${current.error}${tasks.length ? ' 其他已开始的下载继续，结束后可重试。' : ''}`, true);
  else if (current.paused) status(tasks.length ? '正在中止在途任务，清理后可以继续。' : '已暂停，未完成文件已清理。');
  else if (current.stopped) status('已停止，已经保存的书籍和 Excel 保留。');
  else if (!current.running && !current.pending.length && !tasks.length) status(`已完成：保存 ${saved} 本，跳过 ${skipped} 本同名同大小文件。`);
  if (revealTransfer) element('transfer').scrollIntoView({block:'nearest'});
  update();
}
async function authorizeDownload() {
  const source = new URL(page.pageUrl); const origins = [`${source.origin}/*`];
  if (['z-library.website','1lib.sk'].some(domain => source.hostname === domain || source.hostname.endsWith(`.${domain}`))) origins.push('https://dln1.ncdn.ec/*','https://dl-alps-2.gcdn.ac/*');
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
element('read-interval').addEventListener('change', async () => {
  if (element('read-interval').reportValidity()) await chrome.storage.local.set({readIntervalSeconds:Number(element('read-interval').value)});
});
element('search').addEventListener('input', renderBooks);
element('all').addEventListener('change', () => { chosen = new Set(element('all').checked ? page.books.map(book => book.id) : []); renderBooks(); update(); });
element('books').addEventListener('change', event => { const id = event.target.dataset.id; if (!id) return; if (event.target.checked) chosen.add(id); else chosen.delete(id); update(); });
element('clean').addEventListener('change', () => { element('clean-note').hidden = !element('clean').checked; renderBooks(); });
element('rights').addEventListener('change', update);
element('choose-folder').addEventListener('click', async () => {
  if (busy()) return;
  try {
    const directory = await window.showDirectoryPicker({id:'booklist-download',mode:'readwrite'});
    queue = new DirectoryQueue(directory, showQueue);
    queue.setConcurrency(Number(element('concurrency').value));
    target(); update();
    status('保存位置已选择，将按书单名称创建子文件夹。');
  } catch (error) { if (error.name !== 'AbortError') status(`无法选择目录：${error.message}`, true); }
});
element('interval').addEventListener('change', async () => {
  if (!element('interval').reportValidity()) return;
  try { const seconds = Number(element('interval').value); if (queue) queue.setInterval(seconds); await chrome.storage.local.set({intervalSeconds:seconds}); }
  catch (error) { status(error.message, true); }
});
element('concurrency').addEventListener('change', async () => {
  if (!element('concurrency').reportValidity()) return;
  try { const limit = Number(element('concurrency').value); if (queue) queue.setConcurrency(limit); await chrome.storage.local.set({concurrency:limit}); }
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
  if (busy() || !queue || !element('rights').checked || !element('interval').reportValidity() || !element('concurrency').reportValidity()) return;
  const books = selected(), downloadBooks = downloadable(books);
  if (!downloadBooks.length) return;
  preparing = true; renderBooks(); update();
  try {
    queue.setInterval(Number(element('interval').value));
    queue.setConcurrency(Number(element('concurrency').value));
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
  const preferences = await chrome.storage.local.get(['intervalSeconds','concurrency','readIntervalSeconds']);
  element('read-interval').value = Number.isFinite(preferences.readIntervalSeconds) && preferences.readIntervalSeconds >= 1 && preferences.readIntervalSeconds <= 3600 ? preferences.readIntervalSeconds : 3;
  const interval = preferences.intervalSeconds;
  element('interval').value = Number.isFinite(interval) && interval >= 0 && Number.isFinite(interval * 1000) ? interval : 60;
  element('concurrency').value = Number.isInteger(preferences.concurrency) && preferences.concurrency >= 1 && preferences.concurrency <= 10 ? preferences.concurrency : 1;
  const saved = await chrome.storage.session.get(`source-${windowId}`);
  await readCurrent(saved[`source-${windowId}`]?.tabId);
}
initialize().catch(error => status(`初始化失败：${error.message}`, true));
