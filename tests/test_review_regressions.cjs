const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {DirectoryQueue,writeBookToDirectory} = require('../browser_extension/directory.js');
const {prepareBrowserDownload} = require('../browser_extension/core.js');
const {fakeDirectory} = require('./file-system.cjs');
const item={id:'1',title:'示例书',author:'作者',extension:'epub',filename:'书单/示例书 - 作者.epub',url:'https://example.com/dl/1'};
async function main(){
  const original=global.fetch;
  try {
    for(const extension of ['pdf','epub','mobi','azw3','djvu','fb2','txt'])for(const body of ['Download limit reached. Please try again tomorrow.','{"error":"download limit reached","success":false}','<!DOCTYPE html><html>login</html>']) {
      const root=fakeDirectory();global.fetch=async()=>new Response(body,{headers:{'content-type':'application/octet-stream'}});
      const queue=new DirectoryQueue(root,()=>{});await queue.start([{...item,extension,filename:`书单/书籍.${extension}`}]);
      assert(queue.paused,`${extension} 不能保存网站错误响应`);assert.equal(queue.results.length,0);assert.equal(root.directories.size,0,'错误内容不能创建完成文件或记录');
    }
    const zip=new (require('../browser_extension/vendor/jszip.min.js'))();zip.file('mimetype','application/epub+zip',{compression:'STORE'});zip.file('META-INF/container.xml','<container/>');
    const epub=await zip.generateAsync({type:'uint8array',compression:'STORE'});
    const mobi=Buffer.alloc(94);mobi.write('BOOKMOBI',60);
    const formats={epub,mobi,azw3:mobi,djvu:Buffer.concat([Buffer.from('AT&TFORM'),Buffer.alloc(4),Buffer.from('DJVU')]),fb2:Buffer.from('<?xml version="1.0"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><body/></FictionBook>'),txt:Buffer.from('第一章\n这是正文。')};
    for(const [extension,body] of Object.entries(formats)) {
      global.fetch=async()=>new Response(body,{headers:{'content-type':'application/octet-stream'}});
      const root=fakeDirectory(),queue=new DirectoryQueue(root,()=>{});await queue.start([{...item,extension,filename:`书单/有效.${extension}`}]);assert.equal(queue.results.length,1,`${extension} 的有效基本格式不能被拒绝`);
    }
    global.fetch=async()=>new Response(epub);const legacyRoot=fakeDirectory(),legacy=await legacyRoot.getDirectoryHandle('书单',{create:true});
    const bad=Buffer.from('Download limit reached. Please try again tomorrow.');legacy.files.set('示例书 - 作者.epub',bad);legacy.files.set('.booklist-progress.json',Buffer.from(JSON.stringify({version:1,books:[{requestedFilename:item.filename,filename:item.filename,size:bad.length,title:item.title,author:item.author,extension:'epub'}]})));
    const repaired=new DirectoryQueue(legacyRoot,()=>{});await repaired.start([item]);assert.equal(repaired.results.length,1);assert(!repaired.results[0].recorded,'旧版错误文件即使有完成记录也必须重新校验');assert(repaired.results[0].filename.endsWith(' (1).epub'));
    const root=fakeDirectory(),folder=await root.getDirectoryHandle('书单',{create:true}),native=folder.getFileHandle.bind(folder);let attempts=0,requests=0,failWriter=false,failClose=false;
    folder.getFileHandle=async(name,options)=>{const handle=await native(name,options);if(name==='.booklist-progress.json'){const writer=handle.createWritable;handle.createWritable=async()=>{if(++attempts===1||failWriter)throw new DOMException('temporary','NotAllowedError');const writable=await writer();if(failClose)writable.close=async()=>{throw new Error('temporary close failure');};return writable;};}return handle;};
    global.fetch=async()=>{requests++;return new Response('%PDF-1.7\nbook');};
    const pdf={...item,extension:'pdf',filename:'书单/书籍.pdf'},queue=new DirectoryQueue(root,()=>{});await queue.start([pdf]);
    assert(queue.paused);assert(folder.files.has('书籍.pdf'));assert(!folder.files.has('.booklist-progress.json'),'本次新建但未成功写入的空记录必须清理');
    await queue.resume();assert.equal(attempts,2,'重试应补写记录');assert.equal(requests,1,'补写不能重新下载');assert(!queue.paused);assert.equal(JSON.parse(Buffer.from(folder.files.get('.booklist-progress.json')).toString()).books.length,1);
    const reopened=new DirectoryQueue(root,()=>{});await reopened.start([pdf]);assert.equal(requests,1);assert(reopened.results[0].recorded);
    const validRecord=Buffer.from(folder.files.get('.booklist-progress.json'));failWriter=true;
    await queue.start([{...pdf,id:'2',filename:'书单/第二本.pdf'}]);assert(queue.paused);assert.deepEqual(Buffer.from(folder.files.get('.booklist-progress.json')),validRecord,'失败不能删除已有有效记录');assert.throws(()=>queue.start([pdf]),/补写/);
    failWriter=false;await queue.resume();assert.equal(requests,2);assert.equal(queue.pendingRecords.size,0);
    const secondRecord=Buffer.from(folder.files.get('.booklist-progress.json'));failClose=true;await queue.start([{...pdf,id:'3',filename:'书单/第三本.pdf'}]);assert(queue.paused);assert.deepEqual(Buffer.from(folder.files.get('.booklist-progress.json')),secondRecord);
    failClose=false;queue.stop();await queue.resume();assert.equal(requests,3,'停止下载后补写记录仍不能请求书籍');assert.equal(JSON.parse(Buffer.from(folder.files.get('.booklist-progress.json')).toString()).books.length,3);
    const long=prepareBrowserDownload({...pdf,title:'😀'.repeat(80),author:'😀'.repeat(80),download:'/dl/1'},'https://example.com/booklist/1','书单');
    const name=long.filename.split('/')[1];assert(name.length<=240,'整个文件名须按UTF-16长度限制并留出重名后缀空间');assert(!/[\uD800-\uDBFF]$/.test(name.slice(0,-4)));
    const namesRoot=fakeDirectory();global.fetch=async()=>new Response('%PDF-1.7\nfirst');const first=await writeBookToDirectory(namesRoot,long,new AbortController().signal);
    global.fetch=async()=>new Response('%PDF-1.7\nsecond and different');const second=await writeBookToDirectory(namesRoot,long,new AbortController().signal);assert(second.filename.endsWith(' (1).pdf'));assert(second.filename.split('/')[1].length<=255);
    if(process.platform==='win32') {
      const directory=fs.mkdtempSync(path.join(__dirname,'filename-check-'));
      try{for(const result of [first,second]){const target=path.join(directory,result.filename.split('/')[1]);fs.writeFileSync(target,'check');fs.unlinkSync(target);}}finally{fs.rmdirSync(directory);}
    }
    console.log('审查回归：错误响应拒绝、记录仅补写、真实Windows长文件名及重名后缀通过');
  }finally{global.fetch=original;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
