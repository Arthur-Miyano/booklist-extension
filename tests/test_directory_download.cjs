const assert = require('node:assert/strict');
const {fakeDirectory} = require('./file-system.cjs');
const {writeBookToDirectory,DirectoryQueue} = require('../browser_extension/directory.js');
const item = {id:'1',title:'测试书',filename:'书单/测试书 - 作者.pdf',url:'https://example.com/dl/1'};
const pdf = Buffer.from('%PDF-1.7\nbook content');
const response = (known = false, bytes = pdf, extra = {}) => new Response(bytes,{headers:{'content-type':'application/pdf',...(known ? {'content-length':String(bytes.length)} : {}),...extra}});
async function tests() {
  const originalFetch = global.fetch, originalNow = Date.now; let now = 100000, requests = [];
  Date.now = () => now;
  global.fetch = async (url, options) => {requests.push(options);return response(true);};
  try {
    const root = fakeDirectory(), signal = new AbortController().signal;
    let result = await writeBookToDirectory(root,item,signal);
    assert.equal(result.filename,item.filename); assert.equal(result.skipped,false); assert.equal(result.size,pdf.length);
    const folder = root.directories.get('书单'); assert.equal(root.files.size,0); assert.equal(folder.files.size,1);
    const writes = folder.writes;
    result = await writeBookToDirectory(root,item,signal); assert.equal(result.skipped,true); assert.equal(folder.writes,writes,'可靠大小匹配无需重复写入');
    folder.files.set('测试书 - 作者.pdf',Buffer.from('different'));
    result = await writeBookToDirectory(root,item,signal);
    assert.equal(result.filename,'书单/测试书 - 作者 (1).pdf'); assert.equal(result.skipped,false);
    assert.equal(Buffer.from(folder.files.get('测试书 - 作者.pdf')).toString(),'different');
    result = await writeBookToDirectory(root,item,signal); assert.equal(result.skipped,true); assert.equal(result.filename,'书单/测试书 - 作者 (1).pdf','已存在编号副本也应识别');
    global.fetch = async()=>response(false);
    result = await writeBookToDirectory(root,item,signal); assert.equal(result.skipped,true); assert.equal(folder.files.size,2,'未知大小下载后去重并清理临时文件');
    global.fetch = async()=>response(false,pdf,{'content-length':'4','content-encoding':'gzip'});
    result = await writeBookToDirectory(root,item,signal); assert.equal(result.size,pdf.length); assert.equal(result.skipped,true,'压缩传输不能使用长度头');
    global.fetch = async()=>response(false,pdf,{'content-length':String(pdf.length+100)});
    await assert.rejects(writeBookToDirectory(root,item,signal),/大小|不完整/); assert.equal(folder.files.size,2);
    for (const [body,status,type] of [['<html>login</html>',200,'application/octet-stream'],['login',200,'text/html'],['limited',429,'text/plain'],['',200,'application/pdf'],['error',200,'application/pdf']]) {
      global.fetch = async()=>new Response(body,{status,headers:{'content-type':type}});
      await assert.rejects(writeBookToDirectory(root,item,signal)); assert.equal(folder.files.size,2);
    }
    for (const filename of ['../book.pdf','书单/../book.pdf','书单\\其他/book.pdf']) await assert.rejects(writeBookToDirectory(root,{...item,filename},signal),/文件名无效/);
    global.fetch = async()=>response(false);
    const occupied = await root.getDirectoryHandle('占名书单',{create:true});
    await occupied.getDirectoryHandle('测试书 - 作者.pdf',{create:true});
    const occupiedResult = await writeBookToDirectory(root,{...item,filename:'占名书单/测试书 - 作者.pdf'},signal);
    assert.equal(occupiedResult.filename,'占名书单/测试书 - 作者 (1).pdf');assert(occupied.directories.has('测试书 - 作者.pdf'),'已有同名目录必须保留');
    const caseFolder = await root.getDirectoryHandle('大小写书单',{create:true});
    caseFolder.files.set('TEST - AUTHOR.PDF',pdf);
    const caseResult = await writeBookToDirectory(root,{...item,filename:'大小写书单/test - author.pdf'},signal);
    assert.equal(caseResult.skipped,true);
    const abort = new AbortController();
    await assert.rejects(writeBookToDirectory(root,{...item,filename:'书单/其他.pdf'},abort.signal,(bytes,total,phase)=>{if(phase==='saving')abort.abort();}));
    assert.equal(folder.files.size,2,'中止只清理自己的临时与未完成文件');
    assert.equal(requests[0].credentials,'include'); assert.equal(requests[0].headers,undefined);
    const queue = new DirectoryQueue(root,()=>{}); const waits=[];
    queue.waitForNext = async function(){if(this.nextAt>now){waits.push(this.nextAt-now);now=this.nextAt;}};
    queue.setInterval(90); await queue.start([item,item,item]);
    assert.equal(queue.results.length,3); assert.deepEqual(waits,[90000,90000]); assert(queue.results.every(result=>result.skipped));
    global.fetch = async()=>new Response('limited',{status:429}); await queue.start([item,item]);
    assert(queue.paused); assert.equal(queue.pending.length,2); assert.equal(queue.diagnostics[0].httpStatus,429);
    global.fetch = async()=>response(false); await queue.resume(); assert.equal(queue.results.length,2);
    let paused = false;
    const pauseQueue = new DirectoryQueue(root,q=>{if(q.active.size&&!paused){paused=true;q.pause();}});
    pauseQueue.waitForNext = async function(){now=Math.max(now,this.nextAt);};
    await pauseQueue.start([item]); assert.equal(pauseQueue.results.length,0); assert.equal(pauseQueue.pending.length,1); assert.equal(pauseQueue.error,'');
    await pauseQueue.resume(); assert.equal(pauseQueue.results.length,1);
    let stopped = false;
    const stopQueue = new DirectoryQueue(root,q=>{if(q.results.length===1&&!stopped){stopped=true;q.stop();}});
    stopQueue.waitForNext = async()=>{}; await stopQueue.start([item,item]); assert.equal(stopQueue.results.length,1); assert.equal(stopQueue.pending.length,0);
    assert.throws(()=>queue.setInterval(0));
    global.fetch = async()=>{throw new TypeError('Failed to fetch https://example.com/secret?token=hidden');};
    await queue.start([item]); assert.equal(queue.diagnostics[0].stage,'network'); assert(!queue.error.includes('token'));
    global.fetch = async()=>response(false);
    const diskQueue = new DirectoryQueue({async getDirectoryHandle(){throw new DOMException('denied','NotAllowedError');}},()=>{});
    await diskQueue.start([item]); assert.equal(diskQueue.diagnostics[0].stage,'file');
    // 时间从真正接收字节的回调采样，不使用虚构进度或文件数推算速度。
    global.fetch = async()=>new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.from('%PDF-1.7\n'+ 'x'.repeat(600)));},pull(controller){now+=1000;controller.enqueue(Buffer.from('more'));controller.close();}}));
    const speeds=[]; const speedQueue = new DirectoryQueue(root,q=>{if(q.speed>0)speeds.push(q.speed);});
    await speedQueue.start([{...item,filename:'书单/速度.pdf'}]); assert(speeds.length>0); assert(speeds.every(Number.isFinite));
    console.log('文件保存：同名同大小/编号副本/未知长度/压缩长度/不完整文件/错误页/停止清理/暂停重试/间隔/速度通过');
  } finally {global.fetch=originalFetch;Date.now=originalNow;}
}
tests().catch(error=>{console.error(error);process.exitCode=1;});
