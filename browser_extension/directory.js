function fileError(message) { return Object.assign(new Error(message), {stage: 'file'}); }
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
    if (folded === base.toLowerCase() || /^\d+$/.test(suffix)) copies.push({name, size: handle.kind === 'file' ? (await handle.getFile()).size : null});
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
  if (!response.ok) throw Object.assign(new Error(`网站返回 HTTP ${response.status}，请检查登录状态或下载限额后重试`), {stage: 'response', httpStatus: response.status});
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
    const text = new TextDecoder().decode(prefix).trimStart();
    if (/^(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(text) || (base.endsWith('.pdf') && !text.startsWith('%PDF-'))) throw new Error('响应内容不是有效书籍，可能是登录页或错误页');
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
      for (let number = 1; names.has(candidate.toLowerCase()); number++) candidate = base.replace(/(\.[^.]+)$/, ` (${number})$1`);
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

class DirectoryQueue {
  constructor(directory, changed) {
    this.directory = directory; this.changed = changed;
    this.pending = []; this.results = []; this.diagnostics = []; this.intervalSeconds = 60;
    this.concurrency = 1; this.active = new Set(); this.lastStartedAt = null;
    this.running = false; this.paused = false; this.stopped = false; this.nextAt = 0;
  }
  get speed() { return Array.from(this.active).reduce((sum, task) => sum + (task.phase === 'receiving' ? task.speed : 0), 0); }
  setInterval(seconds) {
    if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3600) throw new Error('间隔请输入 30 至 3600 的整数秒');
    this.intervalSeconds = seconds;
    if (this.lastStartedAt !== null) this.nextAt = this.lastStartedAt + seconds * 1000;
  }
  setConcurrency(limit) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('同时下载上限请输入 1 至 10 的整数');
    this.concurrency = limit;
    if (this.items?.length) this.changed(this);
  }
  start(items) {
    if (this.running || this.pending.length || this.active.size) throw new Error('请先完成或停止当前任务');
    this.pending = [...items]; this.items = [...items]; this.results = []; this.diagnostics = [];
    this.paused = false; this.stopped = false; this.nextAt = 0; this.lastStartedAt = null; this.error = '';
    return this.run();
  }
  stop() {
    this.stopped = true; this.paused = false; this.error = ''; this.pending = [];
    for (const task of this.active) { task.cancelled = true; task.controller.abort(); }
    this.changed(this);
  }
  pause() {
    this.paused = true;
    for (const task of this.active) { task.cancelled = true; task.controller.abort(); }
    this.changed(this);
  }
  resume() { this.paused = false; this.error = ''; return this.run(); }
  async waitForNext() {
    while (!this.stopped && !this.paused && Date.now() < this.nextAt) {
      this.changed(this); await new Promise(resolve => setTimeout(resolve, Math.min(1000, this.nextAt - Date.now())));
    }
  }
  async run() {
    if (this.running) return;
    this.running = true; this.changed(this);
    try {
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
    } finally {
      // 出错时停止新增请求，其他已开始的任务可完成；手动暂停/停止则中止全部在途任务。
      await Promise.allSettled(Array.from(this.active, task => task.promise));
      this.running = false; this.changed(this);
    }
  }
  async download(task) {
    let sampledAt = Date.now(), sampledBytes = 0, timedOut = false, idleTimer;
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
    } catch (error) {
      if (!this.stopped) {
        this.pending.push(task.item);
        this.pending.sort((a,b) => this.items.indexOf(a) - this.items.indexOf(b));
        if (!task.cancelled || timedOut) {
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
