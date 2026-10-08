const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {prepareBrowserDownload,safeBrowserName,readBookPage,clickLoadMore,booklistReadingState} = require('../browser_extension/core.js');
const manifest = require('../browser_extension/manifest.json');
assert.equal(manifest.version,'2.4.1');
assert.equal(manifest.name,'z站书单便捷下载');
assert.deepEqual(manifest.permissions,['activeTab','scripting','downloads','storage','sidePanel']);
assert(!manifest.action.default_popup); assert.equal(manifest.side_panel.default_path,'popup.html');
const book={id:'1',title:'书名',author:'作者',extension:'EPUB',download:'/dl/1'};
assert.equal(prepareBrowserDownload(book,'https://example.com/list','书单').filename,'书单/书名 - 作者.epub');
for(const download of ['https://other.com/dl/1','javascript:alert(1)','/account','http://example.com/dl/1']) assert.throws(()=>prepareBrowserDownload({...book,download},'https://example.com/list','书单'));
assert.equal(safeBrowserName('../CON'),'_CON');
assert(!safeBrowserName('书'.repeat(79)+'.更多').endsWith('.'));
global.location={href:'https://example.com/list'};
global.document={title:'示例书单 — Booklist',querySelector:()=>({textContent:'2'}),querySelectorAll:()=>[
  {querySelector:slot=>({textContent:slot.includes('title')?' 书名 ':' 作者 '}),getAttribute:attribute=>attribute==='download'?'/dl/1':'pdf'},
  {querySelector:()=>null,getAttribute:()=>''}
]};
const snapshot=readBookPage();assert.equal(snapshot.name,'示例书单');assert.equal(snapshot.books.length,1);assert.equal(snapshot.books[0].author,'作者');
let clicked=false;
global.document.querySelectorAll=selector=>selector.includes('role="alert"')?[{textContent:'发生了错误。 ID: private',getClientRects:()=>[{}]}]:[];
assert(readBookPage().siteError.includes('来源网页'));assert(!readBookPage().siteError.includes('private'));
global.document.querySelectorAll=selector=>selector.includes('role="alert"')?[{textContent:'发生了错误',getClientRects:()=>[]}]:[];
assert.equal(readBookPage().siteError,'','隐藏的旧错误提示不应阻止读取');
global.document.querySelector=()=>null;
global.document.querySelectorAll=selector=>selector==='z-bookcard'?[]:[{textContent:'评论 (28)'},{textContent:'BOOKS (127)'}];
assert.equal(readBookPage().total,'127','必须读取截图中的BOOKS总数，而不是评论数量');
global.document.querySelector=()=>({textContent:'20'});
assert.equal(readBookPage().total,'127','明确BOOKS总数优先于其他计数');
for(const [label,expected] of [['书籍（127）','127'],['BOOKS (1,027)','1027'],['BOOKS (0)','0']]) {
  global.document.querySelectorAll=selector=>selector==='z-bookcard'?[]:[{textContent:label}];assert.equal(readBookPage().total,expected);
}
for(const [total,loaded,complete] of [['127',127,true],['127',20,false],['127',128,false],['',127,false],['0',0,true]]) {
  assert.equal(booklistReadingState({total,books:Array(loaded)}).complete,complete);
}
global.document.querySelectorAll=()=>[{textContent:'显示更多',disabled:false,getAttribute:()=>null,getClientRects:()=>[{}],children:[],closest:()=>null,click(){clicked=true;}}];
assert.equal(clickLoadMore(),true,'显示更多不限定必须是原生button标签');assert(clicked);clicked=false;
global.document.querySelectorAll=()=>[{textContent:'Show more',disabled:true},{textContent:'Show more',disabled:false,getAttribute:()=>null,getClientRects:()=>[{}],click(){clicked=true;}}];
assert.equal(clickLoadMore(),true);assert(clicked);
global.document.querySelectorAll=()=>[{textContent:'Show more',disabled:false,getAttribute:()=>null,getClientRects:()=>[]}];
assert.equal(clickLoadMore(),false);delete global.document;delete global.location;
let handler, opened, stored;
vm.runInNewContext(fs.readFileSync(require.resolve('../browser_extension/background.js'),'utf8'),{console,Date,chrome:{action:{onClicked:{addListener(fn){handler=fn;}}},sidePanel:{open(options){opened=options;return Promise.resolve();}},storage:{session:{set(data){stored=data;return Promise.resolve();}}}}});
handler({id:7,windowId:3});assert.deepEqual(JSON.parse(JSON.stringify(opened)),{windowId:3}); assert.equal(stored['source-3'].tabId,7);
const html=fs.readFileSync(require.resolve('../browser_extension/popup.html'),'utf8');
const js=fs.readFileSync(require.resolve('../browser_extension/popup.js'),'utf8');
assert(!js.includes('127.0.0.1'));assert(!js.includes('tabs.create'));assert(!js.includes('windows.create'));
for(const key of ['load-all','search','export','choose-folder','interval','concurrency','active-downloads','batch-progress','speed','pause']) assert(html.includes(`id="${key}"`));
console.log('扩展入口、最小权限、链接校验、无本地服务/跳转、侧栏路由通过');
