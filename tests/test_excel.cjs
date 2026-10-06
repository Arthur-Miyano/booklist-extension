const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.JSZip = require('../browser_extension/vendor/jszip.min.js');
global.safeBrowserName = require('../browser_extension/core.js').safeBrowserName;
const {createBooklistExcel,saveBooklistExcel} = require('../browser_extension/excel.js');
const {fakeDirectory} = require('./file-system.cjs');
async function tests(){
  const books = [{title:'=HYPERLINK("bad") & <书名>',author:'英文作者 (English Name)'},{title:'长书名'.repeat(28),author:'作者'.repeat(30)}];
  const bytes=await createBooklistExcel('测试书单',books);
  const zip=await JSZip.loadAsync(bytes); const sheet=await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert(sheet.includes('t="inlineStr"'));assert(!sheet.includes('<f>')); assert(sheet.includes('&amp; &lt;')); assert(sheet.includes('ySplit="2"'));assert(sheet.includes('A2:C4'));
  const root=fakeDirectory(); const first=await saveBooklistExcel(root,'测试书单',bytes); const second=await saveBooklistExcel(root,'测试书单',bytes);
  assert.equal(first,'测试书单/测试书单.xlsx');assert.equal(second,'测试书单/测试书单 (1).xlsx');
  assert.equal(root.directories.get('测试书单').files.size,2);
  const output=path.join(__dirname,'..','.qa','extension-2.0-excel.xlsx');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,bytes);
  console.log('Excel：真实xlsx/文本防公式/冻结/筛选/自动书单目录/原文件不覆盖通过');
}
tests().catch(error=>{console.error(error);process.exitCode=1;});
