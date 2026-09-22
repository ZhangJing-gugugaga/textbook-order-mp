const auth = require('../../utils/auth');
const api = require('../../utils/api');
const format = require('../../utils/format');

const app = getApp();

/**
 * 教师提交记录（§5.4.3 + §5.4.4）
 *
 * 列表：GET /api/teacher/order-forms（跨学期，含 semesterName / status / itemCount / totalQuantity / reviewNote / correctDeadline）
 * 明细：当前学期用 GET /api/teacher/order-form（当前学期单条）；
 *       历史学期明细端点不存在（N11）→ V1 仅展示列表级信息（明确边界，避免验收争议）
 * 审查状态轨迹：与 Web 同口径，前端按 status + submittedAt / reviewAt 推导，不新增后端端点（MP6）
 * 无导出（教师无导出权限）
 */

const STATUS_META = {
  draft: { label: '草稿', tone: 'tag-optional' },
  submitted: { label: '已提交', tone: 'tag-blue' },
  pending_review: { label: '待审核', tone: 'tag-warning' },
  reviewed: { label: '已通过', tone: 'tag-success' },
  rejected: { label: '已驳回', tone: 'tag-required' },
  rejected_auto: { label: '字段审查未通过', tone: 'tag-required' },
};

Page({
  data: {
    loaded: false,
    error: '',
    records: [],
    currentSemesterId: null,
    detail: null,
    detailLoading: false,
  },

  onLoad() {
    app.whenSessionReady().then((result) => {
      if (!result || !result.ok) {
        auth.redirectToLogin();
        return;
      }
      this.load();
    });
  },

  onShow() {
    if (this.data.loaded) this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ error: '' });
    return Promise.all([
      api.teacher.orderForms().then((list) => (Array.isArray(list) ? list : []), (err) => {
        this.setData({ loaded: true, error: err.message || '记录加载失败' });
        return null;
      }),
      api.teacher.orderForm().then((f) => f, () => null),
    ]).then((res) => {
      // 注意：不使用数组解构 —— 原生小程序无 npm 构建，@babel/runtime helper 不可用
      const list = res[0];
      const current = res[1];
      if (list === null) return;
      const records = list.map((r) => this.decorate(r));
      const currentSemesterId = current ? current.semesterId : null;
      this.setData({
        loaded: true,
        records: records,
        currentSemesterId: currentSemesterId,
      });
      if (currentSemesterId) this.loadDetail(currentSemesterId);
    });
  },

  decorate(r) {
    const meta = STATUS_META[r.status] || { label: r.status || '未知', tone: 'tag-blue' };
    // reviewNote 在 pass 时承载「审核备注」（后端对 action=pass 也会写入 reason），
    // 只有驳回态才是「驳回理由」——已通过表单不得按驳回文案展示
    const rejected = r.status === 'rejected' || r.status === 'rejected_auto';
    return Object.assign({}, r, {
      statusLabel: meta.label,
      statusTone: meta.tone,
      submittedAtText: r.submittedAt ? format.formatDateTime(r.submittedAt) : '',
      reviewAtText: r.reviewAt ? format.formatDateTime(r.reviewAt) : '',
      reviewNoteText: rejected && r.reviewNote ? r.reviewNote : '',
      track: this.buildTrack(r),
    });
  },

  /**
   * 审查状态轨迹（§5.4.4，与 Web 同口径的前端推导）
   *   提交        恒有            submittedAt
   *   系统字段审查 恒有            结果取 fieldCheckResult；时间取 submittedAt（无独立字段）
   *   超管内容审核 status ∈ {pending_review, reviewed, rejected}
   *   结果        reviewed → 通过；rejected / rejected_auto → 驳回 + reviewNote
   */
  buildTrack(r) {
    const steps = [];
    steps.push({ name: '提交', time: r.submittedAt ? format.formatDateTime(r.submittedAt) : '', state: 'done' });

    let fieldText = '通过';
    let fieldState = 'done';
    if (Array.isArray(r.fieldCheckResult) && r.fieldCheckResult.length) {
      fieldText = `${r.fieldCheckResult.length} 项未通过`;
      fieldState = 'fail';
    } else if (r.status === 'rejected_auto') {
      fieldText = '未通过';
      fieldState = 'fail';
    }
    steps.push({
      name: '系统字段审查',
      time: r.submittedAt ? format.formatDateTime(r.submittedAt) : '',
      state: fieldState,
      note: fieldText,
    });

    const inReview = r.status === 'pending_review' || r.status === 'reviewed' || r.status === 'rejected';
    if (inReview) {
      steps.push({
        name: '教材室内容审核',
        time: r.status === 'pending_review' ? '待处理' : r.reviewAt ? format.formatDateTime(r.reviewAt) : '',
        state: r.status === 'pending_review' ? 'pending' : 'done',
      });
    }

    if (r.status === 'reviewed') {
      steps.push({ name: '结果', time: r.reviewAt ? format.formatDateTime(r.reviewAt) : '', state: 'done', note: '审核通过' });
    } else if (r.status === 'rejected' || r.status === 'rejected_auto') {
      steps.push({
        name: '结果',
        time: r.reviewAt ? format.formatDateTime(r.reviewAt) : '',
        state: 'fail',
        note: r.reviewNote ? `驳回：${r.reviewNote}` : '已驳回，可补正重提',
      });
    }
    return steps;
  },

  /** 当前学期明细（历史学期无明细端点，N11） */
  loadDetail(semesterId) {
    this.setData({ detailLoading: true });
    api.teacher.orderForm().then(
      (f) => {
        if (!f || f.semesterId !== semesterId) {
          this.setData({ detailLoading: false, detail: null });
          return;
        }
        const items = (f.items || []).map((it) => ({
          id: it.id,
          courseName: it.courseName,
          className: it.className,
          textbookTitle: it.textbookTitle,
          isbn: it.isbn,
          quantity: it.quantity,
        }));
        this.setData({
          detailLoading: false,
          detail: {
            semesterName: f.semesterName,
            status: f.status,
            statusLabel: (STATUS_META[f.status] || {}).label || f.status,
            itemCount: f.itemCount || items.length,
            totalQuantity: f.totalQuantity || 0,
            items: items,
          },
        });
      },
      () => this.setData({ detailLoading: false, detail: null }),
    );
  },

  toggleDetail(e) {
    const id = e.currentTarget.dataset.id;
    const rec = this.data.records.filter((r) => r.id === id)[0];
    if (!rec) return;
    this.expandedId = this.expandedId === id ? null : id;
    this.setData({
      records: this.data.records.map((r) =>
        Object.assign({}, r, { expanded: r.id === this.expandedId }),
      ),
    });
  },

  goForm() {
    wx.navigateTo({ url: '/pages/teacher-order-form/teacher-order-form' });
  },

  onRetry() {
    this.load();
  },

  /** 阻塞弹窗队列确认完（可在此刷新页面数据） */
  onNoticeCleared() {},
});
