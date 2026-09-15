const store = require('../../utils/store');

Page({
  data: {
    session: { name: '', id: '', role: 'student' },
    roleText: '',
    mySubs: []
  },

  onShow() {
    const session = store.getSession();
    if (!session) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    let roleText = '学生';
    if (session.role === 'admin') {
      roleText = '教材管理员';
    } else {
      const info = session.classId ? store.getClassFull(session.classId) : null;
      roleText = info ? info.className : '学生';
    }
    this.setData({ session, roleText });
    if (session.role !== 'admin') this.loadMySubs(session);
  },

  // 学生：全部任务的提交记录
  loadMySubs(session) {
    const orders = store.getOrders();
    const subs = store.getSubmissions();
    const list = [];
    orders.forEach((o) => {
      const sub = subs[o.id] && subs[o.id][session.id];
      if (!sub) return;
      let amount = 0;
      const items = (sub.items || []).map((it) => {
        const b = store.getBook(it.bookId);
        amount += it.qty * (b ? b.price : 0);
        return { bookId: it.bookId, title: b ? b.title : it.bookId, qty: it.qty };
      });
      list.push({
        orderId: o.id,
        orderTitle: o.title,
        status: o.status,
        submittedAt: sub.submittedAt,
        items,
        amount: amount.toFixed(2)
      });
    });
    this.setData({ mySubs: list });
  },

  goPublish() { wx.navigateTo({ url: '/pages/admin-publish/admin-publish' }); },
  goBooks() { wx.navigateTo({ url: '/pages/admin-books/admin-books' }); },
  goStats() { wx.navigateTo({ url: '/pages/admin-stats/admin-stats' }); },
  goMessages() { wx.switchTab({ url: '/pages/messages/messages' }); },

  onAbout() {
    wx.showModal({
      title: '关于',
      content: '教材征订小程序 MVP 演示版。数据为本地 mock，仅用于需求演示与流程验证。',
      showCancel: false
    });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定退出当前账号吗？',
      success: (res) => {
        if (res.confirm) {
          store.logout();
          wx.redirectTo({ url: '/pages/login/login' });
        }
      }
    });
  }
});
