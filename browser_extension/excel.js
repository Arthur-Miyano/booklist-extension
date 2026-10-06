// 浏览器内生成真正的 .xlsx；JSZip 随扩展打包，运行时无需联网或 Python。
async function createBooklistExcel(name, books) {
  const xml = value => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
  const cell = (ref, value, style = 0) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  const end = books.length + 2;
  const rows = [`<row r="1" ht="36" customHeight="1">${cell('A1', name, 1)}</row>`,
    `<row r="2" ht="26" customHeight="1">${['序号','书名','作者'].map((value, i) => cell(`${'ABC'[i]}2`, value, 2)).join('')}</row>`,
    ...books.map((book, i) => {
      const row = i + 3;
      const lines = Math.max(Math.ceil(book.title.length / 28), Math.ceil(book.author.length / 26), 1);
      return `<row r="${row}" ht="${Math.min(180, Math.max(30, lines * 18))}" customHeight="1"><c r="A${row}" s="3"><v>${i + 1}</v></c>${cell(`B${row}`, book.title, 3)}${cell(`C${row}`, book.author, 3)}</row>`;
    })];
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="书单" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Microsoft YaHei"/><color rgb="FF202624"/></font><font><b/><sz val="18"/><name val="Microsoft YaHei"/><color rgb="FF16634B"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/><color rgb="FFF7FAF8"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16634B"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C${end}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="2" width="60" customWidth="1"/><col min="3" max="3" width="50" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A2:C${end}"/><mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells></worksheet>`);
  return zip.generateAsync({type: 'uint8array', compression: 'DEFLATE'});
}

async function saveBooklistExcel(root, name, bytes) {
  const folder = await root.getDirectoryHandle(safeBrowserName(name), {create: true});
  const base = `${safeBrowserName(name)}.xlsx`;
  let filename;
  for (let i = 0; i < 10000; i++) {
    const candidate = i ? base.replace(/\.xlsx$/, ` (${i}).xlsx`) : base;
    try { await folder.getFileHandle(candidate); }
    catch (error) { if (error.name !== 'NotFoundError') throw error; filename = candidate; break; }
  }
  if (!filename) throw new Error('同名 Excel 过多');
  let writer;
  try {
    writer = await (await folder.getFileHandle(filename, {create: true})).createWritable();
    await writer.write(bytes); await writer.close(); writer = null;
    return `${folder.name}/${filename}`;
  } catch (error) {
    if (writer) await writer.abort().catch(() => {});
    await folder.removeEntry(filename).catch(() => {}); throw error;
  }
}
if (typeof module !== 'undefined') module.exports = {createBooklistExcel, saveBooklistExcel};
