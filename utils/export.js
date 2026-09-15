// ============ 导出工具：生成 CSV 文本并复制到剪贴板 ============
// MVP 无后端，采用「生成 CSV → 复制剪贴板 → Excel 粘贴」方案。
// 后续接后端可换成云生成 xlsx 并下载。

function csvEscape(v) {
  const s = String(v === undefined || v === null ? '' : v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function rowsToCsv(rows) {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}

// 明细 + 汇总两张表
// stats: store.getStats 返回值；order: 征订任务
function buildOrderCsv(order, stats, subMap) {
  const books = {};
  const store = require('./store');
  store.getBooks().forEach((b) => { books[b.id] = b; });

  const detail = [['班级', '学号', '姓名', '教材', '版次', '单价', '数量', '提交时间']];
  Object.keys(subMap).forEach((uid) => {
    const users = store.getUsers();
    const u = users.find((x) => x.id === uid);
    if (!u) return;
    const cls = store.getClassFull(u.classId);
    const sub = subMap[uid];
    (sub.items || []).forEach((it) => {
      const b = books[it.bookId] || {};
      detail.push([
        cls ? cls.collegeName + ' / ' + cls.className : u.classId,
        u.id,
        u.name,
        b.title || it.bookId,
        b.edition || '',
        b.price || 0,
        it.qty,
        sub.submittedAt
      ]);
    });
  });

  const summary = [['维度', '名称', '应订人数', '已订人数', '比例']];
  stats.byCollege.forEach((c) => summary.push(['学院', c.name, c.total, c.submitted, c.rate + '%']));
  stats.byMajor.forEach((c) => summary.push(['专业', c.name, c.total, c.submitted, c.rate + '%']));
  stats.byClass.forEach((c) => summary.push(['班级', c.name, c.total, c.submitted, c.rate + '%']));
  summary.push([]);
  summary.push(['教材汇总']);
  summary.push(['书名', '单价', '征订数量', '金额']);
  stats.byBook.forEach((b) => summary.push([b.title, b.price, b.count, b.amount]));

  return (
    order.title + ' 征订明细\n' +
    rowsToCsv(detail) + '\n\n' +
    '统计汇总\n' +
    rowsToCsv(summary)
  );
}

function copyToClipboard(text) {
  wx.setClipboardData({
    data: text,
    success() {
      wx.showToast({ title: '已复制，可粘贴到Excel', icon: 'none', duration: 2500 });
    },
    fail() {
      wx.showToast({ title: '复制失败，请重试', icon: 'none' });
    }
  });
}

// ============ Excel 导出：构建多 sheet 工作簿（真机可直接转发/打开） ============
// 返回 [{ name: '工作表名', rows: [[...]] }, ...]，配合 xlsx.makeWorkbookSheets 生成 .xlsx
function buildOrderWorkbookSheets(order, stats, subMap) {
  const store = require('./store');
  const books = {};
  store.getBooks().forEach((b) => { books[b.id] = b; });

  // Sheet1：征订明细
  const detail = [['班级', '学号', '姓名', '教材', '版次', '单价', '数量', '提交时间']];
  Object.keys(subMap).forEach((uid) => {
    const u = store.getUsers().find((x) => x.id === uid);
    if (!u) return;
    const cls = store.getClassFull(u.classId);
    const sub = subMap[uid];
    (sub.items || []).forEach((it) => {
      const b = books[it.bookId] || {};
      detail.push([
        cls ? cls.collegeName + ' / ' + cls.className : u.classId,
        u.id,
        u.name,
        b.title || it.bookId,
        b.edition || '',
        b.price || 0,
        it.qty,
        sub.submittedAt
      ]);
    });
  });

  // Sheet2：统计汇总（学院/专业/班级 + 教材汇总）
  const summary = [['维度', '名称', '应订人数', '已订人数', '比例']];
  stats.byCollege.forEach((c) => summary.push(['学院', c.name, c.total, c.submitted, c.rate + '%']));
  stats.byMajor.forEach((c) => summary.push(['专业', c.name, c.total, c.submitted, c.rate + '%']));
  stats.byClass.forEach((c) => summary.push(['班级', c.name, c.total, c.submitted, c.rate + '%']));
  summary.push([]);
  summary.push(['教材汇总']);
  summary.push(['书名', '单价', '征订数量', '金额']);
  stats.byBook.forEach((b) => summary.push([b.title, b.price, b.count, b.amount]));

  return [
    { name: '征订明细', rows: detail },
    { name: '统计汇总', rows: summary }
  ];
}

module.exports = { buildOrderCsv, buildOrderWorkbookSheets, copyToClipboard, rowsToCsv };
