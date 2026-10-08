function fileError(message) { return Object.assign(new Error(message), {stage: 'file'}); }
const formatFilename = typeof module !== 'undefined' ? require('./core.js').safeBrowserFilename : safeBrowserFilename;
function validBookPrefix(prefix, extension) {
  let text = new TextDecoder().decode(prefix).trimStart();
  if (prefix[0] === 255 && prefix[1] === 254) text = new TextDecoder('utf-16le').decode(prefix).trimStart();
  if (prefix[0] === 254 && prefix[1] === 255) text = new TextDecoder('utf-16be').decode(prefix).trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?<(?:!doctype\s+html|html\b|head\b|body\b|script\b)/i.test(text)
      || /^(?:error\s*:\s*)?(?:download(?:s)? (?:limit|quota).{0,40}(?:reached|exceeded)|too many requests\b|access denied\b|please (?:log ?in|sign in)\b|发生了错误|下载.{0,8}(?:限额|上限))/i.test(text)
      || /^[\[{]/.test(text) && /"errors?"\s*:|"success"\s*:\s*false|"status"\s*:\s*"error"|"(?:code|status)"\s*:\s*[45]\d\d\b/i.test(text)) return false;
  const ascii = (start, length) => String.fromCharCode(...prefix.subarray(start, start + length));
  if (extension === 'pdf') return ascii(0,5) === '%PDF-';
  if (extension === 'epub') {
    if (prefix.length < 58 || ascii(0,4) !== 'PK\x03\x04') return false;
    const view = new DataView(prefix.buffer,prefix.byteOffset,prefix.byteLength);
    const nameLength = view.getUint16(26,true), extraLength = view.getUint16(28,true);
    return view.getUint16(8,true) === 0 && nameLength === 8 && ascii(30,8) === 'mimetype' && ascii(30+nameLength+extraLength,20) === 'application/epub+zip';
  }
  if (extension === 'mobi' || extension === 'azw3') return prefix.length >= 78 && ascii(60,8) === 'BOOKMOBI';
  if (extension === 'djvu') return ascii(0,8) === 'AT&TFORM' && ['DJVU','DJVM'].includes(ascii(12,4));
  if (extension === 'fb2') return /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?FictionBook\b/i.test(text);
  if (extension === 'txt') return text.length > 0 && !text.includes('\x00');
  return false;
}
async function validLocalBook(file, name) {
  return validBookPrefix(new Uint8Array(await file.slice(0,512).arrayBuffer()), name.split('.').pop().toLowerCase());
}
// 同一个下载队列并行接收，但最终检查与提交串行，避免同名任务相互覆盖。
// ponytail: 锁按目录句柄对象划分；不同侧栏同时操作同一物理目录时仍需用户协调。
const directoryCommits = new WeakMap();
async function commitToDirectory(root, action) {
  const previous = directoryCommits.get(root) || Promise.resolve();
  const operation = previous.then(action);
  const tail = operation.catch(() => {});
  directoryCommits.set(root, tail);
  try { return await operation; }
  finally { if (directoryCommits.get(root) === tail) directoryCommits.delete(root); }
}

async function existingCopies(directory, base) {
  const dot = base.lastIndexOf('.');
  const stem = base.slice(0, dot), extension = base.slice(dot);
  const foldedStem = stem.toLowerCase(), foldedExtension = extension.toLowerCase();
  const copies = [];
  for await (const [name, handle] of directory.entries()) {
    const folded = name.toLowerCase();
    const suffix = folded.startsWith(`${foldedStem} (`) && folded.endsWith(`)${foldedExtension}`)
      ? name.slice(stem.length + 2, -extension.length - 1) : '';
    // 同名目录也占用名称，不能误删或覆盖；Windows 文件名比较忽略大小写。
    if (folded === base.toLowerCase() || /^\d+$/.test(suffix)) {
      const file = handle.kind === 'file' ? await handle.getFile() : null;
      copies.push({name, size: file && await validLocalBook(file,name) ? file.size : null});
    }
  }
  return copies;
}

async function writeBookToDirectory(root, item, signal, onProgress = () => {}) {
  const parts = item.filename.split('/');
  if (parts.length !== 2 || parts.some(part => !part || ['.', '..'].includes(part) || /[\\<>:"|?*\x00-\x1f]/.test(part))) throw fileError('书单目录或文件名无效');
  const [folder, base] = parts;
  let response;
  try { response = await fetch(item.url, {credentials: 'include', signal}); }
  catch (error) { error.stage = 'network'; throw error; }
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after');
    const retryAt = /^\d+$/.test(retryAfter || '') ? Date.now() + Number(retryAfter) * 1000 : Date.parse(retryAfter || '');
    const wait = Number.isFinite(retryAt) ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) : 0;
    const reason = response.status === 429 ? `请求过于频繁，已停止新增下载${wait ? `；服务器要求至少等待 ${wait} 秒后再试` : '；请稍后重试'}`
      : response.status === 504 ? '网关等待上游服务器超时，不能据此判断账号或下载额度；请稍后检查原网页'
      : response.status === 401 ? '登录验证失败，请在原网页确认登录'
      : response.status === 403 ? '服务器拒绝访问，请在原网页检查访问权限或验证提示'
      : response.status >= 500 ? '网站服务暂时出错，请稍后检查原网页'
      : '下载请求未成功，请在原网页查看具体提示';
    throw Object.assign(new Error(`网站返回 HTTP ${response.status}：${reason}`), {stage: 'response', httpStatus: response.status, retryAt: response.status === 429 && Number.isFinite(retryAt) ? retryAt : 0});
  }
  if (/html|json/i.test(response.headers.get('content-type') || '') || !response.body) throw Object.assign(new Error('网站返回网页或空响应，没有保存为书籍'), {stage: 'response'});
  // 压缩传输的 Content-Length 不是解压后的文件大小，不能用于跳过或完整性校验。
  const encoding = response.headers.get('content-encoding');
  const length = response.headers.get('content-length');
  const total = (!encoding || encoding === 'identity') && /^\d+$/.test(length || '') ? Number(length) : 0;
  const reader = response.body.getReader();
  let directory, temporary, writable, finalName, stage = 'body';
  try {
    const chunks = []; let bytes = 0, ended = false;
    while (bytes < 512 && !ended) {
      const chunk = await reader.read(); ended = chunk.done;
      if (chunk.value) { chunks.push(chunk.value); bytes += chunk.value.byteLength; onProgress(bytes, total, 'receiving'); }
    }
    if (!bytes) throw new Error('网站返回空文件');
    const prefix = new Uint8Array(Math.min(bytes, 512)); let offset = 0;
    for (const chunk of chunks) { const part = chunk.subarray(0, prefix.length - offset); prefix.set(part, offset); offset += part.length; if (offset === prefix.length) break; }
    if (!validBookPrefix(prefix, base.split('.').pop().toLowerCase())) throw new Error('响应内容不符合书籍格式，可能是登录页、错误文本或错误 JSON；未保存为书籍');
    if (total && (bytes > total || (ended && bytes !== total))) throw new Error('收到的文件大小与服务器声明不一致');
    signal.throwIfAborted(); stage = 'file';
    directory = await root.getDirectoryHandle(folder, {create: true});
    let copies = await existingCopies(directory, base);
    const duplicate = total && copies.find(copy => copy.size === total);
    if (duplicate) return {filename: `${folder}/${duplicate.name}`, size: total, skipped: true};
    temporary = `.booklist-${crypto.randomUUID()}.part`;
    const handle = await directory.getFileHandle(temporary, {create: true});
    writable = await handle.createWritable();
    for (const chunk of chunks) { signal.throwIfAborted(); await writable.write(chunk); }
    while (!ended) {
      stage = 'body'; const chunk = await reader.read(); ended = chunk.done;
      if (chunk.value) {
        signal.throwIfAborted(); stage = 'file'; await writable.write(chunk.value);
        bytes += chunk.value.byteLength; onProgress(bytes, total, 'receiving');
      }
    }
    stage = 'body';
    if (total && bytes !== total) throw new Error(`文件不完整：应有 ${total} 字节，实际收到 ${bytes} 字节`);
    signal.throwIfAborted(); stage = 'file';
    await writable.close(); writable = null;
    onProgress(bytes, total || bytes, 'checking');
    const file = await handle.getFile();
    if (file.size !== bytes) throw fileError('写入大小不一致，未提交文件');
    // 未知长度必须下载后比较；同时复查下载期间新增的文件与同名编号副本。
    return await commitToDirectory(root, async () => {
      signal.throwIfAborted();
      copies = await existingCopies(directory, base);
      const match = copies.find(copy => copy.size === bytes);
      if (match) return {filename: `${folder}/${match.name}`, size: bytes, skipped: true};
      const names = new Set(copies.map(copy => copy.name.toLowerCase()));
      let candidate = base;
      for (let number = 1; names.has(candidate.toLowerCase()); number++) { const dot=base.lastIndexOf('.'); candidate=formatFilename(base.slice(0,dot),base.slice(dot+1),` (${number})`); }
      signal.throwIfAborted();
      const target = await directory.getFileHandle(candidate, {create: true});
      finalName = candidate;
      writable = await target.createWritable();
      onProgress(bytes, total || bytes, 'saving');
      await file.stream().pipeTo(writable, {signal}); writable = null;
      const saved = await target.getFile();
      if (saved.size !== bytes) throw fileError('最终文件大小不一致');
      finalName = null;
      return {filename: `${folder}/${candidate}`, size: bytes, skipped: false};
    });
  } catch (error) {
    error.stage ||= stage;
    if (writable) await writable.abort().catch(() => {});
    if (finalName) await directory.removeEntry(finalName).catch(() => {});
    throw error;
  } finally {
    await reader.cancel().catch(() => {});
    if (temporary && directory) await directory.removeEntry(temporary).catch(() => {});
  }
}

const progressFileName = '.booklist-progress.json';
async function readProgress(root, folder) {
  try {
    const directory = await root.getDirectoryHandle(folder);
    const handle = await directory.getFileHandle(progressFileName);
    const file = await handle.getFile();
    if (file.size > 5000000) throw fileError('下载记录过大，请检查书单目录中的 .booklist-progress.json');
    const record = JSON.parse(await file.text());
    if (record.version !== 1 || !Array.isArray(record.books) || !record.books.every(entry => entry && typeof entry === 'object' && typeof entry.requestedFilename === 'string')) throw new Error('invalid');
    return record.books;
  } catch (error) {
    if (error.name === 'NotFoundError') return [];
    throw fileError('无法读取下载记录，请检查书单目录中的 .booklist-progress.json；未继续请求书籍。');
  }
}
async function recordedDownload(root, item, cache) {
  const [folder] = item.filename.split('/');
  if (!cache.has(folder)) cache.set(folder, await readProgress(root, folder));
  const record = cache.get(folder).find(entry => entry.requestedFilename === item.filename && (entry.bookKey || '') === (item.bookKey || '') && entry.title === item.title && entry.author === (item.author || '') && entry.extension === (item.extension || ''));
  if (!record || !Number.isSafeInteger(record.size) || record.size <= 0 || typeof record.filename !== 'string') return null;
  const parts = record.filename.split('/');
  if (parts.length !== 2 || parts[0] !== folder || !parts[1] || /[\\<>:"|?*\x00-\x1f]/.test(parts[1]) || ['.','..'].includes(parts[1])) return null;
  try {
    const directory = await root.getDirectoryHandle(folder);
    const file = await (await directory.getFileHandle(parts[1])).getFile();
    if (file.size !== record.size || (record.lastModified && file.lastModified !== record.lastModified) || !await validLocalBook(file,parts[1])) return null;
    return {filename:record.filename, size:record.size, skipped:true, recorded:true};
  } catch (error) { if (error.name === 'NotFoundError') return null; throw fileError('无法校验已记录的书籍，请检查目录访问权限。'); }
}
async function saveProgress(root, item, result) {
  // ponytail: 每本完成后重写一份原子快照；超大书单可改为分段记录，避免累计写入量过大。
  return commitToDirectory(root, async () => {
    const [folder, base] = result.filename.split('/');
    const directory = await root.getDirectoryHandle(folder);
    const file = await (await directory.getFileHandle(base)).getFile();
    if (file.size !== result.size) throw fileError('书籍已保存，但大小改变，未记录为已完成。');
    const books = (await readProgress(root, folder)).filter(entry => entry.requestedFilename !== item.filename || (entry.bookKey || '') !== (item.bookKey || ''));
    books.push({requestedFilename:item.filename, filename:result.filename, size:result.size, lastModified:file.lastModified || null, bookKey:item.bookKey || '', title:item.title, author:item.author || '', extension:item.extension || ''});
    let handle, writable, created=false;
    try {
      try { handle=await directory.getFileHandle(progressFileName); }
      catch (error) { if(error.name!=='NotFoundError')throw error;handle=await directory.getFileHandle(progressFileName,{create:true});created=true; }
      writable = await handle.createWritable();
      await writable.write(JSON.stringify({version:1, books})); await writable.close();
    } catch (error) {
      if(writable)await writable.abort().catch(() => {});
      if(created && (await handle.getFile()).size === 0)await directory.removeEntry(progressFileName).catch(() => {});
      throw fileError('书籍已保存，但下载记录写入失败；请检查目录权限或空间后重试补写。');
    }
  });
}

class DirectoryQueue {
  constructor(directory, changed) {
    this.directory = directory; this.changed = changed;
    this.pending = []; this.results = []; this.diagnostics = []; this.intervalSeconds = 60;
    this.pendingRecords = new Map();
    this.concurrency = 1; this.active = new Set(); this.lastStartedAt = null;
    this.running = false; this.paused = false; this.stopped = false; this.nextAt = 0; this.retryNotBefore = 0;
  }
  get speed() { return Array.from(this.active).reduce((sum, task) => sum + (task.phase === 'receiving' ? task.speed : 0), 0); }
  setInterval(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(seconds * 1000)) throw new Error('间隔请输入有效的非负秒数，可使用小数');
    this.intervalSeconds = seconds;
    if (this.lastStartedAt !== null) this.nextAt = this.lastStartedAt + seconds * 1000;
  }
  setConcurrency(limit) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('同时下载上限请输入 1 至 10 的整数');
    this.concurrency = limit;
    if (this.items?.length) this.changed(this);
  }
  start(items) {
    this.checkRetryWait();
    if (this.running || this.pending.length || this.active.size || this.pendingRecords.size) throw new Error('请先完成当前任务或重试补写完成记录');
    this.pending = [...items]; this.items = [...items]; this.results = []; this.diagnostics = [];
    this.paused = false; this.stopped = false; this.nextAt = 0; this.lastStartedAt = null; this.error = '';
    return this.run();
  }
  stop() {
    this.stopped = true; this.paused = Boolean(this.pendingRecords.size); this.error = this.paused ? '已停止下载，仍有完成记录待补写。' : ''; this.pending = [];
    for (const task of this.active) { task.cancelled = true; task.controller.abort(); }
    this.changed(this);
  }
  pause() {
    this.paused = true;
    for (const task of this.active) { task.cancelled = true; task.controller.abort(); }
    this.changed(this);
  }
  checkRetryWait() {
    const seconds = Math.ceil((this.retryNotBefore - Date.now()) / 1000);
    if (seconds > 0) throw new Error(`服务器要求等待，还需 ${seconds} 秒后才能重试。`);
  }
  resume() { this.checkRetryWait(); this.stopped = false; this.paused = false; this.error = ''; return this.run(); }
  async waitForNext() {
    while (!this.stopped && !this.paused && Date.now() < this.nextAt) {
      this.changed(this); await new Promise(resolve => setTimeout(resolve, Math.min(1000, this.nextAt - Date.now())));
    }
  }
  async run() {
    if (this.running) return;
    this.running = true; this.changed(this);
    try {
      for (const [item,result] of this.pendingRecords) {
        if(this.stopped || this.paused)break;
        await saveProgress(this.directory,item,result);this.pendingRecords.delete(item);this.changed(this);
      }
      const cache = new Map();
      for (const item of [...this.pending]) {
        if (this.stopped || this.paused) break;
        const recorded = await recordedDownload(this.directory, item, cache);
        if (this.stopped || this.paused) break;
        if (recorded) {
          this.pending.splice(this.pending.indexOf(item), 1);
          this.results.push({...recorded, id:item.id, title:item.title});
          this.changed(this);
        }
      }
      while ((this.pending.length || this.active.size) && !this.stopped && !this.paused) {
        if (this.pending.length && this.active.size < this.concurrency) {
          await this.waitForNext();
          if (this.stopped || this.paused) break;
          if (this.active.size >= this.concurrency) continue;
          const item = this.pending.shift();
          const task = {...item, item, controller: new AbortController(), bytes: 0, total: 0, speed: 0, phase: 'connecting'};
          this.lastStartedAt = Date.now(); this.nextAt = this.lastStartedAt + this.intervalSeconds * 1000;
          this.active.add(task); this.changed(this);
          // 一次只启动一本。后续启动仅受间隔和空余名额约束，不等待这一本文档完成。
          task.promise = this.download(task);
        } else await Promise.race(Array.from(this.active, task => task.promise));
      }
    } catch (error) {
      this.paused = true; this.error = `恢复下载失败：${error.message}`;
      const item = this.pending[0] || this.pendingRecords.keys().next().value;
      if (item) this.diagnostics.push({time:new Date().toISOString(), title:item.title, stage:'file', host:new URL(item.url).hostname, message:error.message, httpStatus:null});
      this.changed(this);
    } finally {
      // 出错时停止新增请求，其他已开始的任务可完成；手动暂停/停止则中止全部在途任务。
      await Promise.allSettled(Array.from(this.active, task => task.promise));
      this.running = false; this.changed(this);
    }
  }
  async download(task) {
    let sampledAt = Date.now(), sampledBytes = 0, timedOut = false, idleTimer, completed = false;
    const resetTimeout = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => { timedOut = true; task.controller.abort(); }, 120000); };
    resetTimeout();
    const ticker = setInterval(() => { if (Date.now() - sampledAt > 2000) task.speed = 0; this.changed(this); }, 1000);
    try {
      const result = await writeBookToDirectory(this.directory, task, task.controller.signal, (bytes, total, phase) => {
        if (phase === 'receiving') resetTimeout(); else clearTimeout(idleTimer);
        const now = Date.now();
        if (now - sampledAt >= 500) { task.speed = (bytes - sampledBytes) * 1000 / (now - sampledAt); sampledAt = now; sampledBytes = bytes; }
        task.bytes = bytes; task.total = total; task.phase = phase; this.changed(this);
      });
      this.results.push({...result, id: task.id, title: task.title});
      completed = true; clearTimeout(idleTimer);
      this.pendingRecords.set(task.item,result);
      try { await saveProgress(this.directory, task, result); this.pendingRecords.delete(task.item); if(this.stopped && !this.pendingRecords.size){this.paused=false;this.error='';} }
      catch (error) { throw fileError(`书籍已保存，但完成记录未更新：${error.message}`); }
    } catch (error) {
      if (!this.stopped || completed) {
        if (!completed) { this.pending.push(task.item); this.pending.sort((a,b) => this.items.indexOf(a) - this.items.indexOf(b)); }
        if (completed || !task.cancelled || timedOut) {
          if (error.retryAt) this.retryNotBefore = Math.max(this.retryNotBefore, error.retryAt);
          this.paused = true;
          const message = String(error.message).replace(/https?:\/\/[^\s"'<>]+/g, url => { try { return new URL(url).origin; } catch { return '[地址已省略]'; } }).slice(0, 400);
          this.diagnostics.push({time: new Date().toISOString(), title: task.title, stage: error.stage || 'unknown', host: new URL(task.url).hostname, message, httpStatus: error.httpStatus || null});
          this.error = timedOut ? '一本书籍超过 120 秒没有收到数据，已暂停新增下载。' : error.stage === 'network' ? `网络请求失败：${message}。请检查网站授权、登录和网络。` : error.stage === 'file' ? `保存失败：${message}。请检查目录授权和剩余空间。` : message;
        }
      }
    } finally { clearTimeout(idleTimer); clearInterval(ticker); this.active.delete(task); this.changed(this); }
  }
}
if (typeof module !== 'undefined') module.exports = {writeBookToDirectory, DirectoryQueue, existingCopies};
