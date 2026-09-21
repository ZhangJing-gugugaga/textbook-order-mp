const auth = require('../../utils/auth');
const api = require('../../utils/api');
const config = require('../../utils/config');
const format = require('../../utils/format');

const app = getApp();

Page({
  data: {
    loaded: false,
    error: '',

    me: null,

    // 窗口门禁（由 window-status 组件驱动）
    canSubmit: false,
    windowStatus: '',

    // 清单（每次进入重拉，不缓存 —— N6）
    books: [],
    submittedAt: '',
    orderStatus: '',

    // 合计
    totalKinds: 0,
    totalQty: 0,
    totalAmount: '0.00',

    // 确认弹层
    confirmShow: false,
    confirmItems: [],
    confirmNote: '价格和版本以最终出版单位供应为准',
    submitting: false,
    emptyConfirm: false,
    qtyMax: config.STUDENT_QTY_MAX,
  },

  onLoad() {
    app.whenSessionReady().then((result) => {
      if (!result || !result.ok) {
        auth.redirectToLogin();
        return;
      }
      this.setData({ me: result.me });
      this.loadAll();
    });
  },

  onShow() {
    // 清单随教师表单状态实时变化（required/delisted），每次进入重拉
    if (this.data.loaded) this.loadAll();
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh());
  },

  /* ---------------- 数据加载 ---------------- */
  loadAll() {
    this.setData({ error: '' });
    return Promise.all([
      api.student.bookList().then((list) => list || [], () => null),
      api.student.order().then((order) => order, () => null),
    ]).then((res) => {
      // 注意：不使用数组解构 —— 原生小程序无 npm 构建，@babel/runtime helper 不可用
      const books = res[0];
      const order = res[1];
      if (books === null) {
        this.setData({ loaded: true, error: '教材清单加载失败，请下拉刷新重试' });
        return;
      }
      this.applyData(books, order);
    });
  },

  applyData(rawBooks, order) {
    const picked = {};
    let submittedAt = '';
    let orderStatus = '';
    if (order && order.items) {
      order.items.forEach((it) => {
        picked[it.textbookId] = Number(it.quantity || 0);
      });
      submittedAt = order.submittedAt ? format.formatDateTime(order.submittedAt) : '';
      orderStatus = order.status || '';
    }
    const hasOrder = Object.keys(picked).length > 0;

    const delistedPicked = [];
    const books = (rawBooks || []).map((b) => {
      const id = b.textbookId;
      const delisted = !!b.delisted;
      let checked;
      let qty;

      if (hasOrder) {
        // 已提交过 → 按提交回填（覆盖语义）
        qty = picked[id] || 0;
        checked = qty > 0;
      } else {
        // 首次 → 必修默认勾选 1 本
        checked = !!b.required;
        qty = b.required ? 1 : 0;
      }

      if (delisted) {
        // 下架置灰不可选；若本地已选则取消勾选并提示（§5.3）
        if (checked) delistedPicked.push(b.title);
        checked = false;
        qty = 0;
      }

      return Object.assign({}, b, { checked: checked, qty: qty });
    });

    this.setData({ loaded: true, books: books, submittedAt: submittedAt, orderStatus: orderStatus });
    this.calcTotals();

    if (delistedPicked.length) {
      wx.showToast({
        title: `《${delistedPicked[0]}》已下架，已取消勾选`,
        icon: 'none',
        duration: 2500,
      });
    }
  },

  /* ---------------- 窗口状态 ---------------- */
  onWindowChange(e) {
    const d = e.detail || {};
    this.setData({ canSubmit: !!d.canSubmit, windowStatus: d.windowStatus || '' });
  },

  /** 只读态拦截：窗口未开放或通道关闭 */
  guardReadonly() {
    if (this.data.canSubmit) return false;
    wx.showToast({
      title: this.data.windowStatus === 'not_open' ? '征订尚未开始' : '本期征订已截止，仅供查看',
      icon: 'none',
    });
    return true;
  },

  /* ---------------- 勾选与数量 ---------------- */
  findBook(id) {
    return this.data.books.filter((b) => b.textbookId === id)[0];
  },

  updateBook(id, patch) {
    const books = this.data.books.map((b) =>
      b.textbookId === id ? Object.assign({}, b, patch) : b,
    );
    this.setData({ books: books });
    this.calcTotals();
  },

  toggleCheck(e) {
    if (this.guardReadonly()) return;
    const id = e.currentTarget.dataset.id;
    const b = this.findBook(id);
    if (!b || b.delisted) return;

    if (b.checked) {
      this.updateBook(id, { checked: false, qty: 0 });
      return;
    }
    this.updateBook(id, { checked: true, qty: 1 });
    // 一人一本提醒：勾选第 2 种时 toast（不阻断，§5.3 / MP9）
    const kinds = this.data.books.filter((x) => x.checked && x.qty > 0).length;
    if (kinds >= 2) {
      wx.showToast({ title: '原则上每人只征订一本教材', icon: 'none', duration: 2000 });
    }
  },

  stepUp(e) {
    if (this.guardReadonly()) return;
    const b = this.findBook(e.currentTarget.dataset.id);
    if (!b) return;
    if (b.qty >= config.STUDENT_QTY_MAX) {
      // 不做上限预校验（接口不返回班级人数），仅提示步进上限
      wx.showToast({ title: `单个品种最多 ${config.STUDENT_QTY_MAX} 本`, icon: 'none' });
      return;
    }
    this.updateBook(b.textbookId, { checked: true, qty: b.qty + 1 });
  },

  stepDown(e) {
    if (this.guardReadonly()) return;
    const b = this.findBook(e.currentTarget.dataset.id);
    if (!b) return;
    if (b.qty <= 1) {
      this.updateBook(b.textbookId, { qty: 0, checked: false });
      return;
    }
    this.updateBook(b.textbookId, { qty: b.qty - 1 });
  },

  calcTotals() {
    const picked = this.data.books.filter((b) => b.checked && b.qty > 0);
    const totalQty = picked.reduce((s, b) => s + Number(b.qty || 0), 0);
    const amount = picked.reduce((s, b) => s + Number(b.qty || 0) * Number(b.price || 0), 0);
    this.setData({
      totalKinds: picked.length,
      totalQty: totalQty,
      totalAmount: format.money(amount),
    });
  },

  /* ---------------- 提交 ---------------- */
  onSubmit() {
    if (this.guardReadonly()) return;
    const picked = this.data.books.filter((b) => b.checked && b.qty > 0);

    if (picked.length === 0) {
      // 空 items = 清空全部选择（覆盖语义），仍需二次确认（N10 / §5.3）
      this.setData({
        confirmShow: true,
        emptyConfirm: true,
        confirmItems: [],
      });
      return;
    }

    this.setData({
      confirmShow: true,
      emptyConfirm: false,
      confirmItems: picked.map((b) => ({
        textbookId: b.textbookId,
        title: b.title,
        isbn: b.isbn,
        qty: b.qty,
        amount: format.money(Number(b.qty) * Number(b.price || 0)),
      })),
    });
  },

  onConfirmCancel() {
    if (this.data.submitting) return;
    this.setData({ confirmShow: false });
  },

  onConfirmSubmit() {
    if (this.data.submitting) return;
    const items = this.data.confirmItems.map((it) => ({
      textbookId: it.textbookId,
      quantity: it.qty,
    }));

    this.setData({ submitting: true });
    api.student.submitOrder(items).then(
      () => {
        this.setData({ submitting: false, confirmShow: false });
        wx.showToast({ title: '提交成功', icon: 'success' });
        setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 800);
      },
      (err) => {
        this.setData({ submitting: false, confirmShow: false });
        this.handleSubmitError(err);
      },
    );
  },

  /** 提交错误文案（§5.3 / 附录 B） */
  handleSubmitError(err) {
    const code = err.code;
    if (code === 'WINDOW_CLOSED') {
      wx.showToast({ title: '本期征订已截止', icon: 'none', duration: 2500 });
      this.refreshWindow();
      this.loadAll();
      return;
    }
    if (code === 'WINDOW_NOT_OPEN') {
      wx.showToast({ title: '征订尚未开始', icon: 'none', duration: 2500 });
      this.refreshWindow();
      return;
    }
    if (code === 'BOOK_DELISTED') {
      wx.showToast({ title: '部分教材已下架，请核对后重新提交', icon: 'none', duration: 2500 });
      this.loadAll();
      return;
    }
    // PARAM_INVALID 直显 message（含「第 N 行：…」）；BIZ_ERROR 直显服务端 message
    wx.showToast({ title: err.message || '提交失败，请稍后重试', icon: 'none', duration: 2800 });
  },

  refreshWindow() {
    const comp = this.selectComponent('#windowStatus');
    if (comp && comp.refresh) comp.refresh();
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  /** 阻塞弹窗队列确认完（可在此刷新页面数据） */
  onNoticeCleared() {},
});
