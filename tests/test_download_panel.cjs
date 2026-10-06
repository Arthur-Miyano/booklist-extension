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
  reportValidity(){return this.tag!=='input' || (Number(this.value)>=30&&Number(this.value)<=3600);}
  async emit(type,event={}){if(this.disabled)return;for(const fn of this.events[type]||[]) await fn({target:this,...event});}
}
async function tests(){
  const html=fs.readFileSync(require.resolve('../browser_extension/popup.html'),'utf8'), elements={};
  for(const match of html.matchAll(/<(\w+)[^>]*id="([^"]+)"[^>]*>/g)){const e=new Element(match[1]);elements[match[2]]=e;e.hidden=match[0].includes(' hidden');e.disabled=match[0].includes(' disabled');}
  const root=fakeDirectory('我的书库'); let grants=true,contained=true,permissionCalls=[],downloads=[],folderPrompts=0,storageListener;
  let source={pageUrl:'https://z-library.website/booklist/1',name:'测试书单',total:'3',books:[{title:'局外人（译文经典）',author:'加缪 (Albert Camus)',download:'/dl/1',extension:'pdf'},{title:'英文书',author:'English Author',download:'/dl/2',extension:'pdf'}]};
  const context=vm.createContext({console,URL,Blob,TextDecoder,Uint8Array,AbortController,crypto,Date,Promise,JSZip:require('../browser_extension/vendor/jszip.min.js'),
    setTimeout:(fn,ms)=>setTimeout(fn,ms===600?0:ms),clearTimeout,setInterval,clearInterval,
    document:{getElementById:id=>elements[id],createElement:tag=>new Element(tag)},
    window:{showDirectoryPicker:async()=>{folderPrompts++;return root;},addEventListener(){}},
    chrome:{windows:{getCurrent:async()=>({id:3})},tabs:{query:async()=>[{id:7}]},
      scripting:{executeScript:async({func})=>{if(func.name==='clickLoadMore'){if(source.books.length===3)return[{result:false}];source.books.push({title:'新书',author:'作者三',download:'/dl/3',extension:'pdf'});return[{result:true}];}return[{result:structuredClone(source)}];}},
      storage:{local:{get:async()=>({}),set:async()=>{}},session:{get:async()=>({'source-3':{tabId:7}})},onChanged:{addListener:fn=>storageListener=fn}},
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
  source={...source,pageUrl:'https://z-library.website/booklist/2',name:'另一书单',books:source.books.slice(0,1),total:'1'};
  storageListener({'source-3':{newValue:{tabId:8}}},'session');
  for(let i=0;i<100&&elements['booklist-name'].textContent!=='另一书单';i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(elements['booklist-name'].textContent,'另一书单');assert.equal(elements.target.textContent,'我的书库 / 另一书单');assert.equal(elements.rights.checked,false);assert.equal(elements.selection.textContent,'1 / 1 本已选');
  console.log('完整侧栏流程：读取/原页加载全部/搜索/全选/清洗/选一次目录/Excel/精准授权/失败恢复/重复跳过/切换书单通过');
}
tests().catch(error=>{console.error(error);process.exitCode=1;});
