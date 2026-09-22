const auth = require('../../utils/auth');
const api = require('../../utils/api');
const format = require('../../utils/format');

const app = getApp();

// 教师表单状态展示口径（API.md §1.7）
const FORM_STATUS = {
  draft: { label: '草稿', tone: 'tag-optional', hint: '尚未提交，请在征订窗口内完成填报' },
  submitted: { label: '已提交', tone: 'tag-blue', hint: '已提交，等待系统审查' },
  pending_review: { label: '待审核', tone: 'tag-warning', hint: '已提交，等待教材室审核' },
  reviewed: { label: '已通过', tone: 'tag-success', hint: '教材室已审核通过，已计入汇总' },
  rejected: { label: '已驳回', tone: 'tag-required', hint: '教材室驳回，请在补正截止前修改后重新提交' },
  rejected_auto: { label: '字段审查未通过', tone: 'tag-required', hint: '存在字段问题，请按提示修复后重新提交' },
};

Page({
  data: {
    mode: '', // teacher | student | web
    me: null,
    roleText: '',

    // 教师
    courseClassCount: 0,
    courseCount: 0,
    courseSummary: '',
    coursesLoaded: false,
    formStatus: null, // { label, tone, hint, timeText }
    correctDeadlineText: '',
    needCorrection: false,

    // 学生
    orderLoaded: false,
    hasOrder: false,
    orderStatusText: '',
    orderItemCount: 0,
    orderTotalQuantity: 0,
    orderTotalPrice: '0.00',
    orderSubmittedAt: '',

    windowCanSubmit: false,
    windowStatus: '',
  },

  onLoad() {
    app.whenSessionReady().then((result) => {
      if (!result || !result.ok) {
        auth.redirectToLogin();
        return;
      }
      this.applyMe(result.me);
    });
    // N5：静默 refresh 或切换身份后 currentRole 可能变化，跟随服务端结果重新分流
    auth.onRoleChanged(() => {
      const cached = auth.getCachedMe();
      if (cached) this.applyMe(cached);
    });
  },

  onShow() {
    // 切换身份后回到首页：以缓存的最新身份为准重算模式
    const cached = auth.getCachedMe() || app.globalData.me;
    if (cached) {
      const mode = auth.homeMode(cached);
      if (mode !== this.data.mode || (cached.currentRole || '') !== ((this.data.me && this.data.me.currentRole) || '')) {
        this.applyMe(cached);
        return;
      }
    }
    if (!this.data.mode) return;
    this.reload();
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh());
  },

  /** 登录页/切换身份后可显式指定模式 */
  applyMode(mode) {
    if (!mode) return;
    this.setData({ mode: mode });
    this.reload();
  },

  applyMe(me) {
    const normalized = auth.normalizeMe(me) || app.globalData.me;
    if (!normalized) {
      auth.redirectToLogin();
      return;
    }
    const mode = auth.homeMode(normalized);
    this.setData({
      me: normalized,
      mode: mode,
      roleText: auth.roleLabel(normalized.currentRole),
    });
    this.reload();
  },

  reload() {
    const mode = this.data.mode;
    if (mode === 'teacher') return this.loadTeacher();
    if (mode === 'student') return this.loadStudent();
    return Promise.resolve();
  },

  /* ---------------- 教师 ---------------- */
  loadTeacher() {
    return Promise.all([
      api.teacher.myCourses().then(
        (groups) => this.applyCourses(groups),
        () => this.setData({ coursesLoaded: true }),
      ),
      api.teacher.orderForm().then(
        (form) => this.applyForm(form),
        () => null,
      ),
    ]);
  },

  applyCourses(groups) {
    const list = Array.isArray(groups) ? groups : [];
    const courseCount = list.reduce((acc, g) => acc + ((g.courses || []).length), 0);
    this.setData({
      coursesLoaded: true,
      courseClassCount: list.length,
      courseCount: courseCount,
      courseSummary: list.length ? `${list.length} 个班级 · ${courseCount} 门课程` : '暂无任课关系',
    });
  },

  applyForm(form) {
    if (!form) {
      this.setData({
        formStatus: { label: '未提交', tone: 'tag-optional', hint: '本学期尚未填报，请进入填报页新增明细', actionText: '去填报' },
        correctDeadlineText: '',
        needCorrection: false,
      });
      return;
    }
    const meta = FORM_STATUS[form.status] || { label: form.status || '未知', tone: 'tag-blue', hint: '' };
    const needCorrection = form.status === 'rejected' || form.status === 'rejected_auto';

    let timeText = '';
    if (form.submittedAt) timeText = `提交于 ${format.formatDateTime(form.submittedAt)}`;
    if (form.reviewAt) timeText += `${timeText ? ' · ' : ''}审核于 ${format.formatDateTime(form.reviewAt)}`;

    let correctDeadlineText = '';
    if (needCorrection && form.correctDeadline) {
      correctDeadlineText = `补正截止 ${format.formatDateTime(form.correctDeadline)}`;
    }

    // reviewed 为终态（交接 A4）：填报页已锁定，入口文案不得再承诺「修改」
    const actionText = needCorrection
      ? '去补正重提'
      : form.status === 'reviewed'
        ? '查看填报'
        : '查看/修改填报';

    this.setData({
      formStatus: {
        label: meta.label,
        tone: meta.tone,
        hint: form.reviewNote && needCorrection ? `驳回理由：${form.reviewNote}` : meta.hint,
        timeText: timeText,
        actionText: actionText,
      },
      correctDeadlineText: correctDeadlineText,
      needCorrection: needCorrection,
    });
  },

  /* ---------------- 学生 ---------------- */
  loadStudent() {
    return api.student.order().then(
      (order) => this.applyOrder(order),
      () => this.setData({ orderLoaded: true }),
    );
  },

  applyOrder(order) {
    if (!order) {
      this.setData({
        orderLoaded: true,
        hasOrder: false,
        orderStatusText: '尚未提交',
        orderItemCount: 0,
        orderTotalQuantity: 0,
        orderTotalPrice: '0.00',
        orderSubmittedAt: '',
      });
      return;
    }
    const items = order.items || [];
    const totalPrice = items.reduce(
      (acc, it) => acc + Number(it.price || 0) * Number(it.quantity || 0),
      0,
    );
    this.setData({
      orderLoaded: true,
      hasOrder: true,
      orderStatusText: order.status === 'submitted' ? '已提交' : '草稿',
      orderItemCount: items.length,
      orderTotalQuantity: order.totalQuantity || format.sumBy(items, 'quantity'),
      orderTotalPrice: format.money(totalPrice),
      orderSubmittedAt: order.submittedAt ? format.formatDateTime(order.submittedAt) : '',
    });
  },

  /* ---------------- 窗口状态 ---------------- */
  onWindowChange(e) {
    const d = e.detail || {};
    this.setData({ windowCanSubmit: !!d.canSubmit, windowStatus: d.windowStatus || '' });
  },

  /* ---------------- 导航 ---------------- */
  goOrder() {
    wx.navigateTo({ url: '/pages/order/order' });
  },
  goTeacherCourses() {
    wx.navigateTo({ url: '/pages/teacher-courses/teacher-courses' });
  },
  goTeacherForm() {
    wx.navigateTo({ url: '/pages/teacher-order-form/teacher-order-form' });
  },
  goTeacherRecords() {
    wx.navigateTo({ url: '/pages/teacher-records/teacher-records' });
  },
  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      confirmColor: '#DC2626',
      success: (res) => {
        if (res.confirm) auth.logout();
      },
    });
  },

  /** 阻塞弹窗队列确认完（可在此刷新页面数据） */
  onNoticeCleared() {},
});
