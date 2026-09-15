const store = require('../../utils/store');

Page({
  data: {
    session: { name: '', id: '', role: 'student' },
    roleText: '',
    orders: [],
    overview: { taskCount: 0, bookCount: 0, studentCount: 0, submittedCount: 0 }
  },

  onShow() {
    const session = store.getSession();
    if (!session) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    const roleText = session.role === 'admin'
      ? '教材管理员'
      : (function () {
          const info = session.classId ? store.getClassFull(session.classId) : null;
          return info ? info.collegeName + ' ' + info.className : '学生';
        })();
    this.setData({ session, roleText });
    if (session.role === 'admin') this.loadAdminData();
    this.loadOrders();
  },

  // 学生：本班相关任务；管理员：全部任务
  loadOrders() {
    const { session } = this.data;
    const orders = store.getOrders();
    const list = orders
      .filter((o) => session.role === 'admin' || o.scopeClassIds.indexOf(session.classId) >= 0)
      .map((o) => {
        const item = {
          id: o.id,
          title: o.title,
          status: o.status,
          deadline: o.deadline,
          submitted: false,
          itemCount: 0,
          total: 0,
          submittedCount: 0,
          rate: 0
        };
        if (session.role !== 'admin') {
          const sub = store.getSubmission(o.id, session.id);
          if (sub) {
            item.submitted = true;
            item.itemCount = (sub.items || []).length;
          }
        } else {
          const stats = store.getStats(o.id);
          if (stats) {
            item.total = stats.total;
            item.submittedCount = stats.submitted;
            item.rate = stats.total ? Math.round((stats.submitted / stats.total) * 100) : 0;
          }
        }
        return item;
      });
    this.setData({ orders: list });
  },

  loadAdminData() {
    const orders = store.getOrders();
    const books = store.getBooks();
    const students = store.getUsers().filter((u) => u.role === 'student');
    const subs = store.getSubmissions();
    let submittedCount = 0;
    orders.forEach((o) => {
      Object.keys(subs[o.id] || {}).forEach(() => { submittedCount += 1; });
    });
    this.setData({
      overview: {
        taskCount: orders.length,
        bookCount: books.length,
        studentCount: students.length,
        submittedCount
      }
    });
  },

  goOrder(e) {
    wx.navigateTo({ url: '/pages/order/order?id=' + e.currentTarget.dataset.id });
  },
  goStatsOne(e) {
    wx.navigateTo({ url: '/pages/admin-stats/admin-stats?id=' + e.currentTarget.dataset.id });
  },
  goPublish() { wx.navigateTo({ url: '/pages/admin-publish/admin-publish' }); },
  goBooks() { wx.navigateTo({ url: '/pages/admin-books/admin-books' }); },
  goStats() { wx.navigateTo({ url: '/pages/admin-stats/admin-stats' }); },
  goMessages() { wx.switchTab({ url: '/pages/messages/messages' }); },

  toggleStatus(e) {
    const { id, status } = e.currentTarget.dataset;
    const next = status === 'open' ? 'closed' : 'open';
    store.setOrderStatus(id, next);
    this.loadOrders();
    wx.showToast({ title: next === 'open' ? '已重新开放' : '已设为截止', icon: 'none' });
  }
});
