// ============ xlsx-lite：无依赖的 .xlsx 读写（MVP 无后端方案） ============
// read:  ArrayBuffer → { sheetName, rows: string[][] }（首个工作表，字符串矩阵）
// write: rows → ArrayBuffer（可经 FileSystemManager 落盘后 wx.openDocument 打开）
// 压缩解压依赖 utils/vendor/pako.min.js（MIT）；生成端使用 stored 无压缩 zip。
// 仅支持 .xlsx（OOXML）；.xls 老格式与日期样式列不在支持范围，导入模板请用文本列。

const pako = require('./vendor/pako.min.js');

// ---------- 公共工具 ----------
function xmlEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlDec(s) {
  let out = String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
  // 数字字符实体（十进制与十六进制，openpyxl/Excel 导出中文常用）
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  out = out.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
  // &amp; 必须最后解码
  return out.replace(/&amp;/g, '&');
}

// 列名 A→0, B→1 ... AA→26
function colToIndex(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const ch = ref.charCodeAt(i);
    if (ch >= 65 && ch <= 90) n = n * 26 + (ch - 64);
    else break;
  }
  return n - 1;
}

// ---------- CRC32（写入用） ----------
const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- zip 解析（读） ----------
function parseZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // 从尾部找 EOCD 签名 0x06054b50
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx 文件（找不到 zip 目录）');
  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  const files = {};
  const td = new TextDecoder('utf-8');
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const cmtLen = dv.getUint16(ptr + 32, true);
    const lhoOffset = dv.getUint32(ptr + 42, true);
    const name = td.decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));
    // local header: 30 字节固定 + name + extra
    const lNameLen = dv.getUint16(lhoOffset + 26, true);
    const lExtraLen = dv.getUint16(lhoOffset + 28, true);
    const dataStart = lhoOffset + 30 + lNameLen + lExtraLen;
    const raw = u8.subarray(dataStart, dataStart + compSize);
    files[name] = method === 0 ? raw : pako.inflateRaw(raw);
    ptr += 46 + nameLen + extraLen + cmtLen;
  }
  return files;
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    const rowXml = rm[1];
    const cells = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cm;
    let expect = 0;
    while ((cm = cellRe.exec(rowXml)) !== null) {
      const attrs = cm[1];
      const body = cm[2];
      const refM = attrs.match(/r="([A-Z]+)\d+"/);
      const idx = refM ? colToIndex(refM[1]) : expect;
      // 空位补空串，保持列对齐
      while (cells.length < idx) cells.push('');
      const tM = attrs.match(/t="(\w+)"/);
      const type = tM ? tM[1] : 'n';
      const vM = body.match(/<v>([\s\S]*?)<\/v>/);
      let val = '';
      if (type === 'inlineStr') {
        const tm = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        val = tm ? xmlDec(tm[1]) : '';
      } else if (vM) {
        const raw = xmlDec(vM[1]);
        val = type === 's' ? (shared[parseInt(raw, 10)] || '') : raw;
      }
      cells.push(val);
      expect = idx + 1;
    }
    rows.push(cells);
  }
  return rows;
}

// 读取 xlsx → 首个工作表的字符串矩阵
function readWorkbook(arrayBuffer) {
  const u8 = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
  const files = parseZip(u8);
  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    const xml = new TextDecoder('utf-8').decode(files['xl/sharedStrings.xml']);
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(xml)) !== null) {
      let s = '';
      const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let tm;
      while ((tm = tRe.exec(m[1])) !== null) s += xmlDec(tm[1]);
      shared.push(s);
    }
  }
  // 选第一个 worksheet
  const sheetName = Object.keys(files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0];
  if (!sheetName) throw new Error('xlsx 中未找到工作表');
  const xml = new TextDecoder('utf-8').decode(files[sheetName]);
  return { sheetName, rows: parseSheet(xml, shared) };
}

// ---------- zip 打包（写，stored 无压缩） ----------
function buildZip(entries) {
  // entries: [{ name, data: Uint8Array }]
  const chunks = [];
  const central = [];
  let offset = 0;
  const te = new TextEncoder();

  function u16(v) { return [v & 0xff, (v >> 8) & 0xff]; }
  function u32(v) { return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]; }

  entries.forEach((e) => {
    const name = te.encode(e.name);
    const crc = crc32(e.data);
    const local = [].concat(
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(e.data.length), u32(e.data.length),
      u16(name.length), u16(0)
    );
    chunks.push(new Uint8Array(local), name, e.data);
    central.push({
      name, crc, size: e.data.length, offset
    });
    offset += local.length + name.length + e.data.length;
  });

  const centralStart = offset;
  central.forEach((c) => {
    const cd = [].concat(
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(c.crc), u32(c.size), u32(c.size),
      u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset)
    );
    chunks.push(new Uint8Array(cd), c.name);
    offset += cd.length + c.name.length;
  });
  const eocd = [].concat(
    u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
    u32(offset - centralStart), u32(centralStart), u16(0)
  );
  chunks.push(new Uint8Array(eocd));
  return concat(chunks);
}

function concat(list) {
  let len = 0;
  list.forEach((c) => { len += c.length; });
  const out = new Uint8Array(len);
  let p = 0;
  list.forEach((c) => { out.set(c, p); p += c.length; });
  return out;
}

// 生成 xlsx → ArrayBuffer
function makeWorkbook(rows, sheetName) {
  const name = sheetName || 'Sheet1';
  const esc = xmlEsc;
  let sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  sheetXml += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  rows.forEach((row, ri) => {
    sheetXml += '<row r="' + (ri + 1) + '">';
    row.forEach((cell, ci) => {
      const ref = String.fromCharCode(65 + ci) + (ri + 1);
      const num = cell !== '' && cell !== null && cell !== undefined && !isNaN(Number(cell)) && typeof cell !== 'boolean';
      if (cell === '' || cell === null || cell === undefined) {
        // 跳过空单元格
      } else if (num) {
        sheetXml += '<c r="' + ref + '"><v>' + Number(cell) + '</v></c>';
      } else {
        sheetXml += '<c r="' + ref + '" t="inlineStr"><is><t>' + esc(cell) + '</t></is></c>';
      }
    });
    sheetXml += '</row>';
  });
  sheetXml += '</sheetData></worksheet>';

  const workbookXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="' + esc(name) + '" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const wbRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>';
  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>';

  const te = new TextEncoder();
  const zip = buildZip([
    { name: '[Content_Types].xml', data: te.encode(contentTypes) },
    { name: '_rels/.rels', data: te.encode(rootRels) },
    { name: 'xl/workbook.xml', data: te.encode(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: te.encode(wbRels) },
    { name: 'xl/worksheets/sheet1.xml', data: te.encode(sheetXml) }
  ]);
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
}

// 生成多 sheet xlsx → ArrayBuffer
// sheets: [{ name: '工作表名', rows: [[...], ...] }, ...]
function makeWorkbookSheets(sheets) {
  const list = (sheets || []).filter((s) => s && s.rows && s.rows.length);
  if (list.length === 0) throw new Error('没有可写入的数据');
  const esc = xmlEsc;
  const te = new TextEncoder();
  const zipEntries = [];
  const sheetOverrides = [];
  const sheetTags = [];
  const sheetRels = [];

  list.forEach((s, si) => {
    const sheetFile = 'xl/worksheets/sheet' + (si + 1) + '.xml';
    let sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    sheetXml += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
    s.rows.forEach((row, ri) => {
      sheetXml += '<row r="' + (ri + 1) + '">';
      row.forEach((cell, ci) => {
        // 列引用支持超过 Z 的列（AA、AB…）
        let col = ci;
        let ref = '';
        do {
          ref = String.fromCharCode(65 + (col % 26)) + ref;
          col = Math.floor(col / 26) - 1;
        } while (col >= 0);
        ref += ri + 1;
        const num = cell !== '' && cell !== null && cell !== undefined && !isNaN(Number(cell)) && typeof cell !== 'boolean';
        if (cell === '' || cell === null || cell === undefined) {
          // 跳过空单元格
        } else if (num) {
          sheetXml += '<c r="' + ref + '"><v>' + Number(cell) + '</v></c>';
        } else {
          sheetXml += '<c r="' + ref + '" t="inlineStr"><is><t>' + esc(cell) + '</t></is></c>';
        }
      });
      sheetXml += '</row>';
    });
    sheetXml += '</sheetData></worksheet>';

    sheetOverrides.push('<Override PartName="/' + sheetFile + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
    // sheet 名做 XML 转义，且 Excel 工作表名不允许 : \ / ? * [ ]，保险替换
    const safeName = String(s.name || 'Sheet' + (si + 1)).replace(/[:\\/?*[\]]/g, '-');
    sheetTags.push('<sheet name="' + esc(safeName) + '" sheetId="' + (si + 1) + '" r:id="rId' + (si + 1) + '"/>');
    sheetRels.push('<Relationship Id="rId' + (si + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (si + 1) + '.xml"/>');
    zipEntries.push({ name: sheetFile, data: te.encode(sheetXml) });
  });

  const workbookXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' + sheetTags.join('') + '</sheets></workbook>';
  const wbRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheetRels.join('') +
    '</Relationships>';
  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheetOverrides.join('') +
    '</Types>';

  const entries = [
    { name: '[Content_Types].xml', data: te.encode(contentTypes) },
    { name: '_rels/.rels', data: te.encode(rootRels) },
    { name: 'xl/workbook.xml', data: te.encode(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: te.encode(wbRels) }
  ].concat(zipEntries);

  const zip = buildZip(entries);
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
}

module.exports = { readWorkbook, makeWorkbook, makeWorkbookSheets };
