/**
 * 端点收敛层：页面只调这里（替代 utils/store.js）
 *
 * 依据：docs/08-小程序端升级计划.md §3.1 / §4.1（MP 消费 19 端点）
 * 契约唯一来源：textbook-order-server/API.md
 *
 * 约定：
 *   - 所有方法返回 Promise，成功即 resolve 业务 data（envelope 已在 request.js 解包）
 *   - 列表端点返回裸数组（非 PageResponse）；/notice/mine 为 PageResponse
 *   - 时间出参为 ISO-8601（可能带微秒），格式化统一走 utils/format.js
 */

const request = require('./request');

/* ---------------- 认证与会话（5） ---------------- */
const authApi = {
  // 登录走 auth.login()（需落 token），此处不重复暴露
  logout: () => request.request({ path: '/auth/logout', method: 'POST' }),
  switchRole: (roleCode) => request.request({ path: '/auth/switch-role', method: 'POST', data: { roleCode: roleCode } }),
  // 首登校验：wxCode（换 openid 绑定）与 phoneTail 二选一
  firstLoginVerify: (payload) => request.request({ path: '/auth/first-login/verify', method: 'POST', data: payload }),
};

/* ---------------- 自身（3） ---------------- */
const meApi = {
  me: () => request.request({ path: '/me', method: 'GET' }),
  permissions: () => request.request({ path: '/me/permissions', method: 'GET' }),
  changePassword: (oldPassword, newPassword) =>
    request.request({ path: '/me/password', method: 'PUT', data: { oldPassword: oldPassword, newPassword: newPassword } }),
};

/* ---------------- 窗口（1） ---------------- */
const windowApi = {
  status: () => request.request({ path: '/semester/window/status', method: 'GET' }),
};

/* ---------------- 学生（4） ---------------- */
const studentApi = {
  bookList: () => request.request({ path: '/student/book-list', method: 'GET' }),
  order: () => request.request({ path: '/student/order', method: 'GET' }),
  submitOrder: (items) => request.request({ path: '/student/order/submit', method: 'POST', data: { items: items } }),
  orders: () => request.request({ path: '/student/orders', method: 'GET' }),
};

/* ---------------- 教师（5） ---------------- */
const teacherApi = {
  myCourses: () => request.request({ path: '/teacher/my-courses', method: 'GET' }),
  // 选书器：裸数组，单次封顶 50 条（前端不做翻页，§3.6）
  textbook: (keyword) =>
    request.request({ path: '/teacher/textbook', method: 'GET', data: keyword ? { keyword: keyword } : {} }),
  orderForm: () => request.request({ path: '/teacher/order-form', method: 'GET' }),
  submitOrderForm: (items) => request.request({ path: '/teacher/order-form/submit', method: 'POST', data: { items: items } }),
  orderForms: () => request.request({ path: '/teacher/order-forms', method: 'GET' }),
};

/* ---------------- 通知（3） ---------------- */
const noticeApi = {
  unconfirmed: () => request.request({ path: '/notice/unconfirmed', method: 'GET' }),
  mine: (page, size) =>
    request.request({ path: '/notice/mine', method: 'GET', data: { page: page || 1, size: size || 20 } }),
  // 确认「收到」→ HTTP 204 无 body（request.js 已处理）；body 可带 subscribeResult
  confirm: (taskId, subscribeResult) =>
    request.request({
      path: `/notice/${taskId}/confirm`,
      method: 'POST',
      data: subscribeResult ? { subscribeResult: subscribeResult } : {},
    }),
};

module.exports = {
  auth: authApi,
  me: meApi,
  window: windowApi,
  student: studentApi,
  teacher: teacherApi,
  notice: noticeApi,
};
