const assert = require('node:assert/strict');
const {DirectoryQueue,writeBookToDirectory} = require('../browser_extension/directory.js');
const {fakeDirectory} = require('./file-system.cjs');
const items = count => Array.from({length:count},(_,id)=>({id:String(id),title:`书${id}`,filename:`书单/书${id}.pdf`,url:`https://example.com/dl/${id}`}));
const settle = () => new Promise(resolve=>setImmediate(resolve));
async function until(condition) {for(let i=0;i<1000;i++){if(condition())return;await settle();}throw new Error('队列没有达到预期状态');}
async function tests(){
  const originalFetch=global.fetch, originalNow=Date.now;let now=0;
  Date.now=()=>now;
  const roots=[],queues=[];
  function queue(limit,changed=()=>{}){
    const root=fakeDirectory();roots.push(root);
    const q=new DirectoryQueue(root,changed);queues.push(q);q.setConcurrency(limit);q.setInterval(30);
    // 推进到下一次合法启动时刻；网络流保持未结束，用来独立验证“启动”不等待“完成”。
    q.waitForNext=async function(){now=Math.max(now,this.nextAt);await settle();};return q;
  }
  function controlledNetwork(){
    const controls=[];
    global.fetch=async(url,{signal})=>{
      let controller,closed=false;
      const body=new ReadableStream({start(c){controller=c;c.enqueue(Buffer.from('%PDF-1.7\n'+'x'.repeat(600)));}});
      const control={url,time:now,get closed(){return closed;},finish(){if(closed)return;closed=true;controller.enqueue(Buffer.from('end'));controller.close();},fail(){if(closed)return;closed=true;controller.error(new TypeError('transport failed'));}};
      const abort=()=>{if(!closed){closed=true;controller.error(new DOMException('aborted','AbortError'));}};
      if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
      controls.push(control);return new Response(body,{headers:{'content-type':'application/pdf'}});
    };return controls;
  }
  try{
    const controls=controlledNetwork(), q=queue(10);let peak=0;
    q.changed=current=>{peak=Math.max(peak,current.active.size);};
    const running=q.start(items(12));await until(()=>controls.length===10);
    assert.equal(q.results.length,0,'前十本尚未完成，也应依次启动');assert.equal(q.active.size,10);assert.equal(q.pending.length,2);
    assert.deepEqual(controls.map(c=>Number(c.url.split('/').pop())),[0,1,2,3,4,5,6,7,8,9]);
    assert.deepEqual(controls.map(c=>c.time),[0,30000,60000,90000,120000,150000,180000,210000,240000,270000],'请求启动时刻严格有间隔');
    await settle();assert.equal(controls.length,10,'满额不启动第11本');
    controls[4].finish();await until(()=>controls.length===11);assert.equal(q.results[0].id,'4','按真实完成顺序计数');assert.equal(controls[10].time,300000);
    controls[1].finish();await until(()=>controls.length===12);assert.equal(controls[11].time,330000);assert(peak<=10);
    controls.forEach(control=>control.finish());await running;
    assert.equal(q.results.length,12,JSON.stringify(q.diagnostics));assert.equal(q.active.size,0);assert.equal(q.pending.length,0);assert.equal(q.directory.directories.get('书单').files.size,12,'所有不同书名文件均应保存');

    const pauseControls=controlledNetwork(), paused=queue(3);
    const pausing=paused.start(items(6));await until(()=>pauseControls.length===3);
    paused.pause();await pausing;
    assert(paused.paused);assert.equal(paused.active.size,0);assert.equal(paused.results.length,0);assert.deepEqual(paused.pending.map(i=>i.id),['0','1','2','3','4','5']);
    assert.equal(paused.directory.directories.get('书单')?.files.size||0,0,'中止全部在途并清理各自临时文件');
    const resuming=paused.resume();await until(()=>pauseControls.length===6);
    assert.deepEqual(pauseControls.slice(3).map(c=>c.url.split('/').pop()),['0','1','2'],'恢复仍按原顺序');
    pauseControls.slice(3).forEach(c=>c.finish());await until(()=>pauseControls.length===9);pauseControls.slice(6).forEach(c=>c.finish());await resuming;
    assert.equal(paused.results.length,6);

    const failureControls=controlledNetwork(), failed=queue(3);
    const failing=failed.start(items(6));await until(()=>failureControls.length===3);
    failureControls[1].fail();await until(()=>failed.paused);
    assert.equal(failureControls.length,3);assert.equal(failureControls[0].closed,false);assert.equal(failureControls[2].closed,false,'错误不能取消其他已开始的下载');
    failureControls[0].finish();failureControls[2].finish();await failing;
    assert.deepEqual(failed.pending.map(i=>i.id),['1','3','4','5']);assert.equal(failed.results.length,2);
    const retryRequests=[];global.fetch=async(url)=>{retryRequests.push(url.split('/').pop());return new Response('%PDF-1.7\nretry');};
    await failed.resume();assert.deepEqual(retryRequests,['1','3','4','5']);assert.equal(failed.results.length,6);

    const limitedControls=controlledNetwork(), limited=queue(3);
    const limiting=limited.start(items(4));await until(()=>limitedControls.length===3);limited.setConcurrency(1);
    limitedControls[0].finish();await until(()=>limited.active.size===2);assert.equal(limitedControls.length,3);
    limitedControls[1].finish();await until(()=>limited.active.size===1);assert.equal(limitedControls.length,3,'调低上限后不再补满旧上限');
    limitedControls[2].finish();await until(()=>limitedControls.length===4);limitedControls[3].finish();await limiting;
    assert.throws(()=>limited.setConcurrency(0));assert.throws(()=>limited.setConcurrency(11));
    const stoppedControls=controlledNetwork(), stopped=queue(3);const stopping=stopped.start(items(5));await until(()=>stoppedControls.length===3);stopped.stop();await stopping;
    assert.equal(stopped.pending.length,0);assert.equal(stopped.active.size,0);assert.equal(stopped.results.length,0);assert(stoppedControls.every(c=>c.closed));
    assert.equal(stopped.directory.directories.get('书单')?.files.size||0,0);

    // 多个同名文件可并行接收，但提交必须重新检查已有文件，禁止覆盖彼此。
    const root=fakeDirectory(), pdf=Buffer.from('%PDF-1.7\nsame');
    global.fetch=async url=>new Response(url.endsWith('/2')?Buffer.concat([pdf,Buffer.from('larger')]):pdf);
    const same=items(3).map(i=>({...i,filename:'书单/同名.pdf'}));
    const results=await Promise.all(same.map(item=>writeBookToDirectory(root,item,new AbortController().signal)));
    assert.equal(results.filter(r=>r.skipped).length,1);const files=root.directories.get('书单').files;
    assert.equal(files.size,2);assert.deepEqual([...files.values()].map(v=>v.byteLength).sort((a,b)=>a-b),[pdf.length,pdf.length+6]);
    assert([...files.keys()].every(name=>!name.endsWith('.part')));
    limited.lastStartedAt=0;limited.setInterval(90);assert.equal(limited.nextAt,90000,'时刻为0也要正确更新启动间隔');
    console.log('错峰并行：不等待前一本/严格启动间隔/最多10本/满额补位/完成乱序/全部暂停及恢复/错误保留在途/动态上限/全部停止/同名并行提交通过');
  } finally {queues.forEach(q=>q.stop());global.fetch=originalFetch;Date.now=originalNow;}
}
tests().catch(error=>{console.error(error);process.exitCode=1;});
