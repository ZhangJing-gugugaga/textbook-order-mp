// ============ 数据层：storage 封装 + 业务逻辑 ============
// MVP 阶段全部数据存本地 storage；后续接后端时，替换本文件内的实现即可，
// 页面只依赖这里的函数签名。

const mock = require('./mock');

const KEY = {
  SEEDED: 'tx_seeded_v1',
  COLLEGES: 'tx_colleges',
  MAJORS: 'tx_majors',
  CLASSES: 'tx_classes',
  USERS: 'tx_users',
  BOOKS: 'tx_books',
  ORDERS: 'tx_orders',
  SUBMISSIONS: 'tx_submissions',
  MESSAGES: 'tx_messages',
  SESSION: 'tx_session'
};

function get(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function set(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (e) {
    console.error('storage set fail', key, e);
  }
}

// ---------- 初始化 ----------
function init() {
  if (get(KEY.SEEDED, false)) return;
  set(KEY.COLLEGES, mock.COLLEGES);
  set(KEY.MAJORS, mock.MAJORS);
  set(KEY.CLASSES, mock.CLASSES);
  set(KEY.USERS, mock.USERS);
  set(KEY.BOOKS, mock.BOOKS);
  set(KEY.ORDERS, mock.ORDERS);
  set(KEY.SUBMISSIONS, mock.SUBMISSIONS);
  set(KEY.MESSAGES, mock.MESSAGES);
  set(KEY.SEEDED, true);
}

// 重置演示数据（调试用）
function resetAll() {
  wx.clearStorageSync();
  init();
}

// ---------- 会话 ----------
function login(id, name) {
  const users = get(KEY.USERS, []);
  const u = users.find(
    (x) => x.id === String(id).trim() && x.name === String(name).trim()
  );
  if (!u) return null;
  const session = { id: u.id, name: u.name, role: u.role, classId: u.classId || '', collegeId: u.collegeId || '', loginAt: Date.now() };
  set(KEY.SESSION, session);
  return session;
}

function getSession() {
  return get(KEY.SESSION, null);
}

function logout() {
  wx.removeStorageSync(KEY.SESSION);
}

// ---------- 基础字典 ----------
function getColleges() { return get(KEY.COLLEGES, []); }
function getMajors() { return get(KEY.MAJORS, []); }
function getClasses() { return get(KEY.CLASSES, []); }
function getUsers() { return get(KEY.USERS, []); }

function getClassFull(classId) {
  const cls = getClasses().find((c) => c.id === classId);
  if (!cls) return null;
  const major = getMajors().find((m) => m.id === cls.majorId);
  const college = major ? getColleges().find((c) => c.id === major.collegeId) : null;
  // 班级 = 专业 + 年级 + 班号（借鉴 tb_grade 建模：major + year + number）
  const className = major
    ? major.name + (cls.grade || '') + '级' + (cls.name || '')
    : classId;
  return {
    id: classId,
    className: className,
    grade: cls.grade || '',
    classNo: cls.name || '',
    majorId: major ? major.id : '',
    majorName: major ? major.name : '',
    collegeId: college ? college.id : '',
    collegeName: college ? college.name : ''
  };
}

// ---------- 教材 ----------
function getBooks() { return get(KEY.BOOKS, []); }
function getBook(bookId) { return getBooks().find((b) => b.id === bookId); }

function addBook(book) {
  const books = getBooks();
  const id = 'B' + String(Date.now()).slice(-6);
  books.unshift(Object.assign({ id, classIds: [] }, book));
  set(KEY.BOOKS, books);
  return id;
}

function deleteBook(bookId) {
  set(KEY.BOOKS, getBooks().filter((b) => b.id !== bookId));
}

// 文本粘贴导入（兼容入口）：拆行后走统一的 rows 导入
function importBooks(text) {
  const lines = String(text).split('\n').map((s) => s.trim()).filter(Boolean);
  const rows = lines.map((line) => line.split(/\t|\|/).map((s) => s.trim()));
  return importBooksFromRows(rows);
}

// Excel 导入（主入口）：rows 为二维数组，自动跳过含「书名」的表头行
// 严格按模板校验（10 列：书名、ISBN、版次、作者、出版社、单价、课程名、选用教师、适用班级ID、必修；
// 粘贴模式兼容 9 列无 ISBN 格式），返回 { added: [], errors: ['第N行：原因', ...] }
// 注：模板列定义以 TEMPLATE_ROWS 为准，后续模板更新时同步调整此处校验
function importBooksFromRows(rows) {
  const added = [];
  const errors = [];
  const books = getBooks();
  const classIdsAll = getClasses().map((c) => c.id);
  const isbnSet = {};
  books.forEach((b) => { if (b.isbn) isbnSet[String(b.isbn).replace(/[-\s]/g, '')] = true; });
  const existingIdsInBatch = {};

  rows.forEach((cols, rowIdx) => {
    const rowNo = rowIdx + 1; // 与 Excel 行号一致（第 1 行为表头）
    cols = (cols || []).map((s) => String(s === undefined || s === null ? '' : s).trim());
    // 跳过表头：首列含「书名」字样
    if (!cols[0] || cols[0].indexOf('书名') >= 0) return;
    if (cols.every((c) => !c)) return; // 整行为空直接忽略

    // 列数校验：10 列（含 ISBN，Excel 模板标准）或 9 列（粘贴模式无 ISBN）
    if (cols.length !== 10 && cols.length !== 9) {
      errors.push('第' + rowNo + '行：列数为 ' + cols.length + '，应为 10 列（模板）或 9 列（无ISBN）');
      return;
    }
    const hasIsbn = cols.length === 10;
    const isbn = hasIsbn ? cols[1] : '';
    const c = hasIsbn ? [cols[0]].concat(cols.slice(2)) : cols;
    // c = [书名, 版次, 作者, 出版社, 单价, 课程名, 选用教师, 适用班级ID, 必修]
    const [title, edition, author, press, priceStr, course, teacher, classStr, requiredStr] = c;

    if (!title) { errors.push('第' + rowNo + '行：书名不能为空'); return; }
    let isbnPlain = '';
    if (hasIsbn && isbn) {
      // ISBN 允许为空，填写时须为 9-13 位数字（可含连字符/空格）
      isbnPlain = isbn.replace(/[-\s]/g, '');
      if (!/^\d{9,13}$/.test(isbnPlain)) {
        errors.push('第' + rowNo + '行：ISBN「' + isbn + '」格式不正确，应为 9-13 位数字');
        return;
      }
      if (isbnSet[isbnPlain] || existingIdsInBatch[isbnPlain]) {
        errors.push('第' + rowNo + '行：ISBN「' + isbnPlain + '」已存在，请勿重复导入');
        return;
      }
      existingIdsInBatch[isbnPlain] = true;
    }
    const price = parseFloat(priceStr);
    if (priceStr === '' || isNaN(price) || price < 0) {
      errors.push('第' + rowNo + '行：单价「' + (priceStr || '空') + '」不是有效金额');
      return;
    }
    if (requiredStr !== '是' && requiredStr !== '否') {
      errors.push('第' + rowNo + '行：必修「' + (requiredStr || '空') + '」应为「是」或「否」');
      return;
    }
    const classIds = classStr.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (classIds.length === 0) {
      errors.push('第' + rowNo + '行：适用班级ID不能为空（多个用英文逗号分隔，如 CST2401,CST2402）');
      return;
    }
    const badClass = classIds.filter((cid) => classIdsAll.indexOf(cid) < 0);
    if (badClass.length) {
      errors.push('第' + rowNo + '行：班级ID不存在「' + badClass.join('、') + '」，可用：' + classIdsAll.join('/'));
      return;
    }

    const b = {
      id: 'B' + String(Date.now()) + String(added.length),
      isbn: isbnPlain || '',
      title: title,
      edition: edition,
      author: author,
      press: press,
      price: price,
      course: course,
      teacher: teacher,
      classIds: classIds,
      required: requiredStr === '是'
    };
    books.unshift(b);
    added.push(b);
  });
  set(KEY.BOOKS, books);
  return { added: added, errors: errors };
}

// ============ 学生批量导入（一键建链） ============
// 每行一个学生，字段用 | 或 Tab 分隔：学号|姓名|学院名称|专业名称|班级全称(如 2024级1班)
// 按「名称」自动匹配或创建 学院→专业→班级 链（借鉴层级外键模型：Class→Major→College）
function findOrCreateCollege(name) {
  const list = getColleges();
  let hit = list.find((x) => x.name === name);
  if (hit) return hit.id;
  const id = 'C' + Date.now() + list.length;
  list.push({ id, name });
  set(KEY.COLLEGES, list);
  return id;
}

function findOrCreateMajor(name, collegeId) {
  const list = getMajors();
  let hit = list.find((x) => x.name === name && x.collegeId === collegeId);
  if (hit) return hit.id;
  const id = 'M' + Date.now() + list.length;
  list.push({ id, collegeId, name });
  set(KEY.MAJORS, list);
  return id;
}

function findOrCreateClass(majorId, grade, name) {
  const list = getClasses();
  let hit = list.find((x) => x.majorId === majorId && x.grade === grade && x.name === name);
  if (hit) return hit.id;
  // 兜底：兼容旧格式/字段缺失的存量班级数据（如 name 含「2024级」前缀、grade 为空），
  // 按组合班级全称（专业名+年级+班号）二次匹配，避免导入时重复建班
  const major = getMajors().find((m) => m.id === majorId);
  if (major) {
    const expected = major.name + grade + '级' + name;
    hit = list.find((x) => {
      if (x.majorId !== majorId) return false;
      const g = x.grade || (String(x.name || '').match(/^(\d{4})级/) || [])[1] || '';
      const n = x.grade ? (x.name || '') : String(x.name || '').replace(/^\d{4}级/, '');
      return major.name + g + '级' + n === expected;
    });
    if (hit) {
      // 顺手迁移旧格式为标准格式，下次可走精确匹配
      if (!hit.grade || hit.name !== name) {
        hit.grade = grade;
        hit.name = name;
        set(KEY.CLASSES, list);
      }
      return hit.id;
    }
  }
  const id = 'K' + Date.now() + list.length;
  list.push({ id, majorId, grade, name });
  set(KEY.CLASSES, list);
  return id;
}

function addStudent(id, name, classId) {
  const users = getUsers();
  if (users.some((u) => u.id === id)) return false; // 学号已存在
  users.push({ id, name, role: 'student', classId, collegeId: '' });
  set(KEY.USERS, users);
  return true;
}

function deleteStudent(id) {
  set(KEY.USERS, getUsers().filter((u) => !(u.id === id && u.role === 'student')));
}

// 文本粘贴导入（兼容入口）
function importStudents(text) {
  const lines = String(text).split('\n').map((s) => s.trim()).filter(Boolean);
  const rows = lines.map((line) => line.split(/\t|\|/).map((s) => s.trim()));
  return importStudentsFromRows(rows);
}

// Excel 导入（主入口）：rows 为二维数组，自动跳过含「学号」的表头行
// 严格按模板校验（5 列：学号、姓名、学院名称、专业名称、班级全称），
// 返回 { added: [], skipped: ['第N行：原因', ...] }
function importStudentsFromRows(rows) {
  const ok = [];
  const skipped = [];
  const existingIds = {};
  getUsers().forEach((u) => { existingIds[u.id] = true; });
  rows.forEach((cols, rowIdx) => {
    const rowNo = rowIdx + 1; // 与 Excel 行号一致（第 1 行为表头）
    cols = (cols || []).map((s) => String(s === undefined || s === null ? '' : s).trim());
    // 跳过表头：首列含「学号」字样
    if (!cols[0] || cols[0].indexOf('学号') >= 0) return;
    if (cols.every((c) => !c)) return; // 整行为空直接忽略

    if (cols.length !== 5) {
      skipped.push('第' + rowNo + '行：列数为 ' + cols.length + '，模板应为 5 列（学号|姓名|学院名称|专业名称|班级全称）');
      return;
    }
    const [id, name, collegeName, majorName, className] = cols;
    if (!id) { skipped.push('第' + rowNo + '行：学号不能为空'); return; }
    if (!/^[A-Za-z0-9]{4,20}$/.test(id)) { skipped.push('第' + rowNo + '行：学号「' + id + '」格式不正确（4-20 位字母或数字）'); return; }
    if (!name) { skipped.push('第' + rowNo + '行(' + id + ')：姓名不能为空'); return; }
    if (!collegeName) { skipped.push('第' + rowNo + '行(' + id + ')：学院名称不能为空'); return; }
    if (!majorName) { skipped.push('第' + rowNo + '行(' + id + ')：专业名称不能为空'); return; }
    if (!className) { skipped.push('第' + rowNo + '行(' + id + ')：班级全称不能为空（如 2024级1班）'); return; }
    if (!/^\d{4}级.+\S$/.test(className)) {
      skipped.push('第' + rowNo + '行(' + id + ')：班级全称「' + className + '」格式不正确，应为「年级+班号」如 2024级1班');
      return;
    }
    // 先查重再建链，避免跳过行留下垃圾组织数据
    if (existingIds[id]) { skipped.push('第' + rowNo + '行：学号 ' + id + ' ' + name + '（学号已存在）'); return; }
    existingIds[id] = true;
    // 班级全称解析：2024级1班 → 年级 2024 + 班号 1班
    const m = className.match(/^(\d{4})级(.+)$/);
    const grade = m ? m[1] : '';
    const classNo = m ? m[2] : className;
    const collegeId = findOrCreateCollege(collegeName);
    const majorId = findOrCreateMajor(majorName, collegeId);
    const classId = findOrCreateClass(majorId, grade, classNo);
    if (addStudent(id, name, classId)) {
      ok.push({ id, name });
    } else {
      skipped.push('第' + rowNo + '行：学号 ' + id + ' ' + name + '（学号已存在）');
    }
  });
  return { added: ok, skipped };
}

function getStudents() {
  return getUsers().filter((u) => u.role === 'student');
}

// ---------- 征订任务 ----------
function getOrders() { return get(KEY.ORDERS, []); }
function getOrder(orderId) { return getOrders().find((o) => o.id === orderId); }

function publishOrder(order) {
  const orders = getOrders();
  const id = 'O' + Date.now();
  orders.unshift({
    id,
    title: order.title,
    status: 'open',
    deadline: order.deadline,
    createdAt: formatDate(new Date()),
    creatorId: order.creatorId,
    scopeClassIds: order.scopeClassIds,
    bookIds: order.bookIds
  });
  set(KEY.ORDERS, orders);
  return id;
}

function setOrderStatus(orderId, status) {
  const orders = getOrders();
  const o = orders.find((x) => x.id === orderId);
  if (o) {
    o.status = status;
    set(KEY.ORDERS, orders);
  }
}

// ---------- 学生提交 ----------
function getSubmissions() { return get(KEY.SUBMISSIONS, {}); }

function getSubmission(orderId, userId) {
  const all = getSubmissions();
  return (all[orderId] && all[orderId][userId]) || null;
}

function saveSubmission(orderId, userId, items) {
  const all = getSubmissions();
  if (!all[orderId]) all[orderId] = {};
  const now = new Date();
  all[orderId][userId] = {
    items,
    submittedAt: formatDate(now) + ' ' + formatTime(now)
  };
  set(KEY.SUBMISSIONS, all);
}

// 学生视角：本班 + 该任务范围内的教材
function getBooksForOrder(orderId, classId) {
  const order = getOrder(orderId);
  if (!order) return [];
  return getBooks().filter(
    (b) => order.bookIds.indexOf(b.id) >= 0 && b.classIds.indexOf(classId) >= 0
  );
}

// ---------- 统计（管理员） ----------
// 返回：{ total, submitted, byClass[], byMajor[], byCollege[], byBook[] }
function getStats(orderId) {
  const order = getOrder(orderId);
  if (!order) return null;
  const subs = getSubmissions()[orderId] || {};
  const users = getUsers().filter((u) => u.role === 'student' && order.scopeClassIds.indexOf(u.classId) >= 0);
  const classes = getClasses();
  const majors = getMajors();
  const colleges = getColleges();

  // 班级维度（name 用组合班级全称，如「计算机科学与技术级2024级1班」，避免只显示「1班」）
  const byClass = order.scopeClassIds.map((cid) => {
    const cls = classes.find((c) => c.id === cid);
    const stu = users.filter((u) => u.classId === cid);
    const done = stu.filter((u) => subs[u.id]);
    const full = cls ? getClassFull(cid) : null;
    return {
      id: cid,
      name: full ? full.className : cid,
      total: stu.length,
      submitted: done.length,
      rate: stu.length ? Math.round((done.length / stu.length) * 100) : 0
    };
  });

  // 专业 / 学院维度：基于班级聚合
  function aggregate(levelKey) {
    // collegeId → collegeName / majorId → majorName（动态拼接字段名在 getClassFull 中不存在，改为显式映射）
    const nameField = levelKey === 'collegeId' ? 'collegeName' : 'majorName';
    const map = {};
    byClass.forEach((c) => {
      const info = getClassFull(c.id);
      const key = info[levelKey] || '未知';
      if (!map[key]) map[key] = { id: key, name: info[nameField] || '未知', total: 0, submitted: 0 };
      map[key].total += c.total;
      map[key].submitted += c.submitted;
    });
    return Object.keys(map).map((k) => {
      const v = map[k];
      v.rate = v.total ? Math.round((v.submitted / v.total) * 100) : 0;
      return v;
    }).sort((a, b) => b.rate - a.rate);
  }

  const byMajor = aggregate('majorId');
  const byCollege = aggregate('collegeId');

  // 教材维度：每种书订出多少本
  const bookCount = {};
  Object.keys(subs).forEach((uid) => {
    (subs[uid].items || []).forEach((it) => {
      bookCount[it.bookId] = (bookCount[it.bookId] || 0) + it.qty;
    });
  });
  const byBook = order.bookIds.map((bid) => {
    const b = getBook(bid);
    return {
      id: bid,
      title: b ? b.title : bid,
      price: b ? b.price : 0,
      count: bookCount[bid] || 0,
      amount: ((bookCount[bid] || 0) * (b ? b.price : 0)).toFixed(2)
    };
  }).sort((a, b) => b.count - a.count);

  const total = users.length;
  const submitted = users.filter((u) => subs[u.id]).length;

  return { total, submitted, byClass, byMajor, byCollege, byBook };
}

// ---------- 消息 ----------
function getMessages() { return get(KEY.MESSAGES, []); }

// ---------- 未提交催办名单（漏订） ----------
function getMissingStudents(orderId) {
  const order = getOrder(orderId);
  if (!order) return [];
  const subs = getSubmissions()[orderId] || {};
  return getUsers().filter(
    (u) => u.role === 'student' && order.scopeClassIds.indexOf(u.classId) >= 0 && !subs[u.id]
  );
}

// ---------- 工具 ----------
function formatDate(d) {
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function formatTime(d) {
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

module.exports = {
  init,
  resetAll,
  login,
  getSession,
  logout,
  getColleges,
  getMajors,
  getClasses,
  getUsers,
  getClassFull,
  getBooks,
  getBook,
  addBook,
  deleteBook,
  importBooks,
  importBooksFromRows,
  findOrCreateCollege,
  findOrCreateMajor,
  findOrCreateClass,
  addStudent,
  deleteStudent,
  importStudents,
  importStudentsFromRows,
  getStudents,
  getOrders,
  getOrder,
  publishOrder,
  setOrderStatus,
  getSubmissions,
  getSubmission,
  saveSubmission,
  getBooksForOrder,
  getStats,
  getMessages,
  getMissingStudents,
  formatDate,
  formatTime
};
