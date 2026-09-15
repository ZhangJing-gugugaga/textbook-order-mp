const store = require('../../utils/store');

Page({
  data: {
    order: null,
    classInfo: null,
    books: [],
    submittedAt: '',
    totalKinds: 0,
    totalQty: 0,
    totalAmount: '0.00'
  },

  orderId: '',

  onLoad(options) {
    this.orderId = options.id || '';
    const session = store.getSession();
    if (!session) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    const order = store.getOrder(this.orderId);
    if (!order) {
      wx.showToast({ title: '征订任务不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const classInfo = store.getClassFull(session.classId);
    this.setData({ order, classInfo });
    this.loadBooks(session);
  },

  loadBooks(session) {
    // 按学号所在班级自动带出关联教材
    const raw = store.getBooksForOrder(this.orderId, session.classId);
    const sub = store.getSubmission(this.orderId, session.id);
    const subMap = {};
    if (sub) (sub.items || []).forEach((it) => { subMap[it.bookId] = it.qty; });

    const books = raw.map((b) => {
      // 已提交过按提交回填；否则必修默认勾选 1 本
      if (sub) {
        return Object.assign({}, b, { checked: !!subMap[b.id], qty: subMap[b.id] || 0 });
      }
      return Object.assign({}, b, { checked: b.required, qty: b.required ? 1 : 0 });
    });
    this.setData({
      books,
      submittedAt: sub ? sub.submittedAt : ''
    });
    this.calcTotals();
  },

  findBook(id) {
    return this.data.books.find((b) => b.id === id);
  },

  updateBook(id, patch) {
    const books = this.data.books.map((b) => (b.id === id ? Object.assign({}, b, patch) : b));
    this.setData({ books });
    this.calcTotals();
  },

  // 截止任务整体只读：任何交互只提示，不修改数据
  checkClosed() {
    if (this.data.order && this.data.order.status !== 'open') {
      wx.showToast({ title: '该任务已截止，仅供查看', icon: 'none' });
      return true;
    }
    return false;
  },

  toggleCheck(e) {
    if (this.checkClosed()) return;
    const id = e.currentTarget.dataset.id;
    const b = this.findBook(id);
    if (!b) return;
    if (b.checked && b.qty === 0) {
      this.updateBook(id, { checked: false, qty: 0 });
    } else if (!b.checked) {
      this.updateBook(id, { checked: true, qty: 1 });
      // 一人一本原则：勾选第 2 种教材时温和提醒（不阻断）
      const kinds = this.data.books.filter((x) => x.checked && x.qty > 0).length;
      if (kinds >= 2) {
        wx.showToast({ title: '原则上每人只征订一本教材', icon: 'none', duration: 2000 });
      }
    } else {
      this.updateBook(id, { checked: false, qty: 0 });
    }
  },

  stepUp(e) {
    if (this.checkClosed()) return;
    const b = this.findBook(e.currentTarget.dataset.id);
    if (b && b.qty < 9) this.updateBook(b.id, { qty: b.qty + 1 });
  },

  stepDown(e) {
    if (this.checkClosed()) return;
    const b = this.findBook(e.currentTarget.dataset.id);
    if (!b) return;
    if (b.qty <= 1) {
      this.updateBook(b.id, { qty: 0, checked: false });
    } else {
      this.updateBook(b.id, { qty: b.qty - 1 });
    }
  },

  calcTotals() {
    const picked = this.data.books.filter((b) => b.checked && b.qty > 0);
    const totalKinds = picked.length;
    const totalQty = picked.reduce((s, b) => s + b.qty, 0);
    const amount = picked.reduce((s, b) => s + b.qty * b.price, 0);
    this.setData({
      totalKinds,
      totalQty,
      totalAmount: amount.toFixed(2)
    });
  },

  onSubmit() {
    if (this.checkClosed()) return;
    const picked = this.data.books.filter((b) => b.checked && b.qty > 0);
    if (picked.length === 0) {
      wx.showToast({ title: '请至少勾选一本教材', icon: 'none' });
      return;
    }
    // 一人一本原则：多本时不阻断，但明确提醒确认
    const doSave = () => {
      const session = store.getSession();
      const items = picked.map((b) => ({ bookId: b.id, qty: b.qty }));
      store.saveSubmission(this.orderId, session.id, items);
      const sub = store.getSubmission(this.orderId, session.id);
      this.setData({ submittedAt: sub.submittedAt });
      wx.showToast({ title: '提交成功', icon: 'success' });
      // 提交完成返回主页查看任务状态
      setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 800);
    };
    if (picked.length > 1) {
      wx.showModal({
        title: '征订确认',
        content: '您本次勾选了 ' + picked.length + ' 种教材。原则上建议每人只征订一本，是否确认提交？',
        confirmText: '确认提交',
        success: (res) => {
          if (res.confirm) doSave();
        }
      });
      return;
    }
    doSave();
  }
});
