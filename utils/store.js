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
  return {
    id: classId,
    className: cls.name,
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

// 粘贴批量导入：每行一本，字段用 | 或 Tab 分隔
// 顺序：书名|版次|作者|出版社|单价|课程名|选用教师|适用班级(逗号分隔班级id)|必修(是/否)
function importBooks(text) {
  const lines = String(text).split('\n').map((s) => s.trim()).filter(Boolean);
  const added = [];
  const books = getBooks();
  lines.forEach((line) => {
    const cols = line.split(/\t|\|/).map((s) => s.trim());
    if (cols.length < 7) return;
    const price = parseFloat(cols[4]);
    if (isNaN(price)) return;
    const classIds = (cols[7] || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    const b = {
      id: 'B' + String(Date.now()) + String(added.length),
      title: cols[0],
      edition: cols[1],
      author: cols[2],
      press: cols[3],
      price: price,
      course: cols[5],
      teacher: cols[6],
      classIds: classIds,
      required: (cols[8] || '是') !== '否'
    };
    books.unshift(b);
    added.push(b);
  });
  set(KEY.BOOKS, books);
  return added;
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

  // 班级维度
  const byClass = order.scopeClassIds.map((cid) => {
    const cls = classes.find((c) => c.id === cid);
    const stu = users.filter((u) => u.classId === cid);
    const done = stu.filter((u) => subs[u.id]);
    return {
      id: cid,
      name: cls ? cls.name : cid,
      total: stu.length,
      submitted: done.length,
      rate: stu.length ? Math.round((done.length / stu.length) * 100) : 0
    };
  });

  // 专业 / 学院维度：基于班级聚合
  function aggregate(levelKey) {
    const map = {};
    byClass.forEach((c) => {
      const info = getClassFull(c.id);
      const key = info[levelKey];
      if (!map[key]) map[key] = { id: key, name: info[levelKey + 'Name'], total: 0, submitted: 0 };
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
