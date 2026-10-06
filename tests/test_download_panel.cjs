const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {fakeDirectory} = require('./file-system.cjs');
class Element {
  constructor(tag='div') {this.tag=tag;this.children=[];this.events={};this.dataset={};this.checked=false;this.disabled=false;this.hidden=false;this.value='';this.textContent='';this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  addEventListener(type,fn){(this.events[type] ||= []).push(fn);}
  removeAttribute(name){delete this[name];}
  scrollIntoView(){this.revealed=true;}
  reportValidity(){return this.tag!=='input' || (Number(this.value)>=Number(this.min||30)&&Number(this.value)<=Number(this.max||3600));}
  async emit(type,event={}){if(this.disabled)return;for(const fn of this.events[type]||[]) await fn({target:this,...event});}
}
async function tests(){
  const html=fs.readFileSync(require.resolve('../browser_extension/popup.html'),'utf8'), elements={};
  for(const match of html.matchAll(/<(\w+)[^>]*id="([^"]+)"[^>]*>/g)){const e=new Element(match[1]);elements[match[2]]=e;e.hidden=match[0].includes(' hidden');e.disabled=match[0].includes(' disabled');e.min=match[0].match(/min="([^"]+)"/)?.[1];e.max=match[0].match(/max="([^"]+)"/)?.[1];}
  const root=fakeDirectory('我的书库'); let grants=true,contained=true,permissionCalls=[],downloads=[],folderPrompts=0,storageListener,localPreferences={};
  let source={pageUrl:'https://z-library.website/booklist/1',name:'测试书单',total:'3',books:[{title:'局外人（译文经典）',author:'加缪 (Albert Camus)',download:'/dl/1',extension:'pdf'},{title:'英文书',author:'English Author',download:'/dl/2',extension:'pdf'}]};
  const context=vm.createContext({console,URL,Blob,TextDecoder,Uint8Array,AbortController,crypto,Date,Promise,JSZip:require('../browser_extension/vendor/jszip.min.js'),
    setTimeout:(fn,ms)=>setTimeout(fn,ms===600?0:ms),clearTimeout,setInterval,clearInterval,
    document:{getElementById:id=>elements[id],createElement:tag=>new Element(tag)},
    window:{showDirectoryPicker:async()=>{folderPrompts++;return root;},addEventListener(){}},
    chrome:{windows:{getCurrent:async()=>({id:3})},tabs:{query:async()=>[{id:7}]},
      scripting:{executeScript:async({func})=>{if(func.name==='clickLoadMore'){if(source.books.length===3)return[{result:false}];source.books.push({title:'新书',author:'作者三',download:'/dl/3',extension:'pdf'});return[{result:true}];}return[{result:structuredClone(source)}];}},
      storage:{local:{get:async()=>localPreferences,set:async data=>Object.assign(localPreferences,data)},session:{get:async()=>({'source-3':{tabId:7}})},onChanged:{addListener:fn=>storageListener=fn}},
      permissions:{request:async options=>{permissionCalls.push(options);return grants;},contains:async()=>contained},
      downloads:{download:async data=>{downloads.push(data);return 1;}}},
    fetch:async()=>new Response('%PDF-1.7\ncontent',{headers:{'content-type':'application/pdf','content-length':'16'}})
  });
  for(const name of ['core','clean','excel','directory','popup'])vm.runInContext(fs.readFileSync(require.resolve(`../browser_extension/${name}.js`),'utf8'),context,{filename:`${name}.js`});
  const settle=async()=>{for(let i=0;i<100;i++){await new Promise(resolve=>setTimeout(resolve,1));if(elements['booklist-name'].textContent==='测试书单'&&!elements.read.disabled)return;}throw new Error('初始化未完成');};
  await settle();
  assert.equal(elements.selection.textContent,'2 / 2 本已选');assert(elements.start.disabled);assert.equal(elements['load-all'].hidden,false);
  await elements['load-all'].emit('click');assert.equal(elements.selection.textContent,'3 / 3 本已选');assert.equal(elements['load-all'].hidden,true);assert.equal(elements.books.children.length,3);
  elements.search.value='English';await elements.search.emit('input');assert.equal(elements.books.children.length,1);
  elements.search.value='';await elements.search.emit('input');
  elements.clean.checked=true;await elements.clean.emit('change');assert.equal(elements.books.children[0].children[1].children[0].textContent,'局外人');
  await elements['choose-folder'].emit('click');assert.equal(folderPrompts,1);assert.equal(elements.target.textContent,'我的书库 / 测试书单');
  vm.runInContext('queue.waitForNext = async function() {};',context);
  await elements.export.emit('click');assert.equal(permissionCalls.length,0,'单独导出不请求下载网站权限');assert.equal(root.directories.get('测试书单').files.size,1);assert.equal(downloads.length,0,'已选目录直接保存Excel');
  elements.rights.checked=true;await elements.rights.emit('change');elements.interval.value='30';await elements.interval.emit('change');
  grants=false;await elements.start.emit('click');assert(elements.status.textContent.includes('授权'));assert.equal(root.directories.get('测试书单').files.size,1,'未授权不能生成下载任务或写入文件');
  grants=true;contained=false;await elements.start.emit('click');assert.equal(root.directories.get('测试书单').files.size,1);
  contained=true;let failing=true;
  context.fetch=async()=>failing?new Response('limited',{status:429}):new Response('%PDF-1.7\ncontent',{headers:{'content-type':'application/pdf','content-length':'16'}});
  await elements.start.emit('click');assert.equal(elements.resume.hidden,false);assert.equal(elements.resume.textContent,'重试并继续');assert(elements.status.textContent.includes('429'));assert.equal(elements['task-count'].textContent,'0 / 3 本');
  assert(elements.transfer.revealed,'开始后下载状态应自动进入视野');
  failing=false;await elements.resume.emit('click');assert.equal(elements['task-count'].textContent,'3 / 3 本');assert.equal(elements['batch-progress'].value,100);assert.equal(elements['diagnostic-box'].hidden,false,'失败记录可回看');
  const folder=root.directories.get('测试书单');assert(folder.files.has('局外人 - 加缪 (Albert Camus).pdf'));assert(folder.files.has('英文书 - English Author.pdf'));assert.equal(folderPrompts,1);
  assert.equal(JSON.stringify(permissionCalls.at(-1)),JSON.stringify({origins:['https://z-library.website/*','https://dln1.ncdn.ec/*']}));
  const count=folder.files.size;await elements.start.emit('click');assert.equal(folder.files.size,count+1,'再次下载只新增Excel，不重复保存同大小书籍');assert(elements['batch-note'].textContent.includes('已跳过 3 本'));
  elements.all.checked=false;await elements.all.emit('change');assert(elements.start.disabled);assert(elements.export.disabled);
  elements.all.checked=true;await elements.all.emit('change');
  elements.concurrency.value='10';await elements.concurrency.emit('change');assert.equal(localPreferences.concurrency,10);
  const controls=[];
  context.fetch=async(url,{signal})=>{
    let controller,closed=false;
    const stream=new ReadableStream({start(c){controller=c;c.enqueue(Buffer.from('%PDF-1.7\n'+'x'.repeat(600)));}});
    const abort=()=>{if(!closed){closed=true;controller.error(new DOMException('aborted','AbortError'));}};
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
    controls.push({finish(){if(!closed){closed=true;controller.close();}}});
    return new Response(stream,{headers:{'content-type':'application/pdf'}});
  };
  const starting=elements.start.emit('click');
  for(let i=0;i<1000&&elements['active-downloads'].children.length!==3;i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(elements['active-downloads'].children.length,3);assert(elements['current-title'].textContent.includes('3 本 / 上限 10 本'));assert(elements.speed.textContent.startsWith('总速度'));
  await elements.pause.emit('click');await starting;
  assert.equal(elements.resume.hidden,false);assert.equal(elements.resume.disabled,false);assert.equal(elements['active-downloads'].children.length,0);
  assert([...folder.files.keys()].every(name=>!name.endsWith('.part')),'面板暂停后不残留未完成文件');
  const resuming=elements.resume.emit('click');
  for(let i=0;i<1000&&controls.length!==6;i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(controls.length,6);controls.slice(3).forEach(c=>c.finish());await resuming;
  assert.equal(elements['task-count'].textContent,'3 / 3 本');assert.equal(elements['batch-progress'].value,100);
  assert.equal(elements['active-downloads'].children.length,0);assert.equal(folderPrompts,1);
  source={...source,pageUrl:'https://z-library.website/booklist/2',name:'另一书单',books:source.books.slice(0,1),total:'1'};
  storageListener({'source-3':{newValue:{tabId:8}}},'session');
  for(let i=0;i<100&&elements['booklist-name'].textContent!=='另一书单';i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(elements['booklist-name'].textContent,'另一书单');assert.equal(elements.target.textContent,'我的书库 / 另一书单');assert.equal(elements.rights.checked,false);assert.equal(elements.selection.textContent,'1 / 1 本已选');
  console.log('完整侧栏流程：读取/搜索/清洗/Excel/精准授权/失败恢复/去重/多本进度与总速度/并行暂停恢复/切换书单通过');
}
tests().catch(error=>{console.error(error);process.exitCode=1;});
