const {spawnSync} = require('node:child_process');
const path = require('node:path');
for (const file of ['test_browser_extension.cjs','test_clean.cjs','test_directory_download.cjs','test_staggered_download.cjs','test_excel.cjs','test_download_panel.cjs','test_review_regressions.cjs']) {
  const result = spawnSync(process.execPath,[path.join(__dirname,file)],{stdio:'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const file of ['background.js','core.js','clean.js','directory.js','excel.js','popup.js']) {
  const result = spawnSync(process.execPath,['--check',path.join(__dirname,'..','browser_extension',file)],{stdio:'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('全部扩展检查通过');
