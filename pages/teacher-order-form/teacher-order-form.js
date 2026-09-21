const auth = require('../../utils/auth');
const api = require('../../utils/api');
const config = require('../../utils/config');
const format = require('../../utils/format');

const app = getApp();

/**
 * 教师填报页（§5.4.2）—— 明细行编辑器
 *
 * 明细模型 = 课程 × 班级 × 教材 × 数量（非学生端勾选清单，X5）
 * 关键口径：
 *   - 课程×班级 只能取自 my-courses（服务端校验 COURSE_OWNER / CLASS_LINK）
 *   - 数量仅校验 ≥1；教师上限 = 班级人数（回退 999），不可复用学生端 9 的上限（N7）
 *   - 字段审查 400 FIELD_CHECK_FAILED → data[{field,rule,message}]，field 形如 items[0].quantity → 解析下标定位到行
 *   - 关窗锁定 + 补正豁免：被驳回表单在 correctDeadline 前仍可提交（不得用「窗口 closed」一刀切禁用，W4）
 */

// 字段审查 6 规则（API.md §3.6）
const RULE_LABEL = {
  REQUIRED: '必填完整',
  QTY_RANGE: '数量超范围',
  BOOK_ACTIVE: '教材已下架',
  COURSE_OWNER: '课程非本人',
  CLASS_LINK: '课程与班级不匹配',
  ISBN_FORMAT: 'ISBN 校验不通过',
};

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
    saving: false,

    form: null,
    status: '',
    statusLabel: '',
    statusTone: 'tag-blue',
    reviewNote: '',
    submittedAtText: '',
    reviewAtText: '',

    // 可编辑性
    windowCanSubmit: false,
    windowStatus: '',
    needCorrection: false,
    readonly: true,
    lockHint: '',
    correctDeadlineText: '',
    correctionExpired: false,

    // 明细
    items: [],
    courseOptions: [], // [{label, courseId, classId, courseName, className}]
    itemCount: 0,
    totalQuantity: 0,
    totalAmount: '0.00',

    // 字段审查回显
    fieldErrors: [],
    fieldErrorSummary: '',

    // 教材选择器
    selectorShow: false,
    selectorKeyword: '',
    selectorLoading: false,
    selectorResults: [],
    selectorEmpty: false,
    selectorTargetKey: '',

    // 提交确认
    confirmShow: false,

    qtyMin: config.TEACHER_QTY_MIN,
    qtyMaxHint: '班级人数',
  },

  onLoad(options) {
    this.focus = {
      courseId: options && options.courseId ? Number(options.courseId) : null,
      classId: options && options.classId ? Number(options.classId) : null,
    };
    this.seq = 0;
    app.whenSessionReady().then((result) => {
      if (!result || !result.ok) {
        auth.redirectToLogin();
        return;
      }
      this.loadAll();
    });
  },

  onShow() {
    if (this.data.loaded) this.loadAll();
  },

  /* ---------------- 加载 ---------------- */
  loadAll() {
    this.setData({ error: '' });
    return Promise.all([
      api.teacher.myCourses().then((g) => (Array.isArray(g) ? g : []), () => []),
      api.teacher.orderForm().then((f) => f, (err) => {
        if (err && err.code === 'FIRST_LOGIN_REQUIRED') return null;
        return null;
      }),
    ]).then((res) => {
      // 注意：不使用数组解构 —— 原生小程序无 npm 构建，@babel/runtime helper 不可用
      const groups = res[0];
      const form = res[1];
      this.applyCourses(groups);
      this.applyForm(form);
      this.setData({ loaded: true });
    });
  },

  applyCourses(groups) {
    const options = [];
    (groups || []).forEach((g) => {
      (g.courses || []).forEach((c) => {
        options.push({
          label: `${g.className} · ${c.courseName}`,
          courseId: c.courseId,
          classId: g.classId,
          courseName: c.courseName,
          className: g.className,
        });
      });
    });
    this.setData({ courseOptions: options });
  },

  applyForm(form) {
    const status = form ? form.status : '';
    const meta = STATUS_META[status] || { label: form ? status : '未提交', tone: 'tag-optional' };
    const needCorrection = status === 'rejected' || status === 'rejected_auto';

    let items = [];
    if (form && form.items) {
      items = form.items.map((it) => this.toRow({
        courseId: it.courseId,
        classId: it.classId,
        courseName: it.courseName,
        className: it.className,
        textbookId: it.textbookId,
        textbookTitle: it.textbookTitle,
        isbn: it.isbn,
        quantity: it.quantity,
      }));
    }

    // 补正截止倒计时：correctDeadline 直接用后端返回字段（§4.3-G3），
    // 倒计时锚点用窗口状态里的 serverTime（不信本地时钟），无锚点时退化为绝对时间展示
    this.correctDeadline = form && form.correctDeadline ? form.correctDeadline : '';
    this.correctionExpired = false;

    // 字段审查错误：优先用本次提交的服务端回显（pendingFieldErrors，含用户刚编辑但服务端未落库的行），
    // 否则用表单自带的 fieldCheckResult（rejected_auto 表单再次进入时仍能显示问题行）
    const errs = this.pendingFieldErrors || this.parseFieldCheck(form && form.fieldCheckResult);
    this.pendingFieldErrors = errs;

    this.setData({
      form: form,
      status: status,
      statusLabel: meta.label,
      statusTone: meta.tone,
      reviewNote: (form && form.reviewNote) || '',
      submittedAtText: form && form.submittedAt ? format.formatDateTime(form.submittedAt) : '',
      reviewAtText: form && form.reviewAt ? format.formatDateTime(form.reviewAt) : '',
      needCorrection: needCorrection,
      items: errs ? items.map((row, i) => Object.assign({}, row, { errors: errs.byIndex[i] || [] })) : items,
      fieldErrors: errs ? errs.general : [],
      fieldErrorSummary: errs ? errs.summary : '',
    });
    this.recalc();
    this.applyReadonly();
    this.tickCorrection();
    this.startCorrectionTicker();
  },

  /** 仅刷新表单状态（不重建明细行，保留用户正在编辑的行与行级错误） */
  refreshStatusOnly() {
    return api.teacher.orderForm().then(
      (form) => {
        const status = form ? form.status : 'rejected_auto';
        const meta = STATUS_META[status] || { label: status, tone: 'tag-required' };
        const needCorrection = status === 'rejected' || status === 'rejected_auto';
        this.correctDeadline = form && form.correctDeadline ? form.correctDeadline : '';
        this.setData({
          form: form,
          status: status,
          statusLabel: meta.label,
          statusTone: meta.tone,
          reviewNote: (form && form.reviewNote) || '',
          submittedAtText: form && form.submittedAt ? format.formatDateTime(form.submittedAt) : '',
          reviewAtText: form && form.reviewAt ? format.formatDateTime(form.reviewAt) : '',
          needCorrection: needCorrection,
        });
        this.applyReadonly();
        this.tickCorrection();
        this.startCorrectionTicker();
      },
      () => {
        // 拉取失败时按契约本地推定：字段审查未通过 → rejected_auto（可补正重提）
        this.setData({
          status: 'rejected_auto',
          statusLabel: STATUS_META.rejected_auto.label,
          statusTone: STATUS_META.rejected_auto.tone,
          needCorrection: true,
        });
        this.applyReadonly();
      },
    );
  },

  /** 解析 {field,rule,message}[] → {byIndex, general, summary} */
  parseFieldCheck(details) {
    if (!Array.isArray(details) || !details.length) return null;
    const byIndex = {};
    const general = [];
    details.forEach((d) => {
      const m = /^items\[(\d+)\](?:\.(\w+))?$/.exec(String(d.field || ''));
      if (m) {
        const idx = Number(m[1]);
        byIndex[idx] = byIndex[idx] || [];
        byIndex[idx].push({ field: m[2] || '', rule: d.rule, message: d.message });
        return;
      }
      general.push({ field: d.field, rule: d.rule, message: d.message });
    });
    return {
      byIndex: byIndex,
      general: general.map((g) => Object.assign({}, g, { ruleLabel: RULE_LABEL[g.rule] || g.rule })),
      summary: `存在 ${details.length} 项问题，请按提示修复后重新提交`,
    };
  },

  /** 补正倒计时文案（needCorrection 时展示） */
  tickCorrection() {
    const deadline = this.correctDeadline;
    if (!deadline || !this.data.needCorrection) {
      if (this.data.correctDeadlineText) this.setData({ correctDeadlineText: '' });
      return;
    }
    const cd = format.createCountdown(deadline, this.serverTime || deadline);
    const remain = cd.remaining();
    const expired = remain != null && remain <= 0;
    const text = expired
      ? `补正窗口已过（${format.formatDateTime(deadline)}）`
      : `补正截止 ${format.formatDateTime(deadline)}（剩余 ${format.durationText(remain)}）`;
    if (expired !== this.correctionExpired) {
      this.correctionExpired = expired;
      this.setData({ correctDeadlineText: text, correctionExpired: expired });
      this.applyReadonly();
      return;
    }
    if (text !== this.data.correctDeadlineText) this.setData({ correctDeadlineText: text });
  },

  startCorrectionTicker() {
    if (this.correctionTimer) clearInterval(this.correctionTimer);
    if (!this.correctDeadline || !this.data.needCorrection) return;
    this.correctionTimer = setInterval(() => this.tickCorrection(), 30000);
  },

  onUnload() {
    if (this.correctionTimer) clearInterval(this.correctionTimer);
  },

  /** 构造可编辑行 */
  toRow(src) {
    this.seq += 1;
    const opt = this.findOption(src.courseId, src.classId);
    return {
      key: `row-${this.seq}`,
      courseId: src.courseId || null,
      classId: src.classId || null,
      courseLabel: opt ? opt.label : (src.className && src.courseName ? `${src.className} · ${src.courseName}` : ''),
      courseIndex: opt ? this.data.courseOptions.indexOf(opt) : -1,
      textbookId: src.textbookId || null,
      textbookTitle: src.textbookTitle || '',
      isbn: src.isbn || '',
      quantity: Number(src.quantity || 1),
      errors: [],
    };
  },

  clearPendingErrors() {
    this.pendingFieldErrors = null;
  },

  findOption(courseId, classId) {
    const list = this.data.courseOptions || [];
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].courseId === courseId && list[i].classId === classId) return list[i];
    }
    return null;
  },

  /* ---------------- 可编辑性（关窗锁定 + 补正豁免，W4） ---------------- */
  onWindowChange(e) {
    const d = e.detail || {};
    this.serverTime = d.serverTime || this.serverTime;
    this.setData({ windowCanSubmit: !!d.canSubmit, windowStatus: d.windowStatus || '' });
    this.applyReadonly();
    this.tickCorrection();
  },

  applyReadonly() {
    const needCorrection = this.data.needCorrection;
    const correctionExpired = !!this.correctionExpired;
    const windowCanSubmit = this.data.windowCanSubmit;
    let readonly = true;
    let lockHint = '';

    if (needCorrection) {
      // 被驳回表单：correctDeadline 前仍可提交（服务端 @WithinWindow(Exemption.CORRECTION) 放行）
      if (correctionExpired) {
        readonly = true;
        lockHint = '补正窗口已过，请联系教材室';
      } else {
        readonly = false;
        lockHint = windowCanSubmit ? '' : '本期征订已截止，补正窗口内仍可提交';
      }
    } else if (windowCanSubmit) {
      readonly = false;
    } else {
      readonly = true;
      lockHint =
        this.data.windowStatus === 'not_open' ? '征订尚未开始' : '本期征订已截止，表单已锁定';
    }

    this.setData({ readonly: readonly, lockHint: lockHint });
  },

  /* ---------------- 明细行编辑 ---------------- */
  guardReadonly() {
    if (!this.data.readonly) return false;
    wx.showToast({ title: this.data.lockHint || '当前不可编辑', icon: 'none' });
    return true;
  },

  addRow() {
    if (this.guardReadonly()) return;
    // 从 my-courses 带出定位（点课程进来时优先该行）
    const focus = this.focus;
    let preset = null;
    if (focus && focus.courseId) {
      preset = this.findOption(focus.courseId, focus.classId);
      this.focus = null;
    }
    if (!preset && this.data.courseOptions.length === 1) preset = this.data.courseOptions[0];

    const row = {
      key: `row-${(this.seq += 1)}`,
      courseId: preset ? preset.courseId : null,
      classId: preset ? preset.classId : null,
      courseLabel: preset ? preset.label : '',
      courseIndex: preset ? this.data.courseOptions.indexOf(preset) : -1,
      textbookId: null,
      textbookTitle: '',
      isbn: '',
      quantity: 1,
      errors: [],
    };
    const items = this.data.items.concat([row]);
    this.clearPendingErrors();
    this.setData({ items: items, fieldErrors: [], fieldErrorSummary: '' });
    this.recalc();
  },

  removeRow(e) {
    if (this.guardReadonly()) return;
    const key = e.currentTarget.dataset.key;
    const items = this.data.items.filter((r) => r.key !== key);
    this.clearPendingErrors();
    this.setData({ items: items, fieldErrors: [], fieldErrorSummary: '' });
    this.recalc();
  },

  onCourseChange(e) {
    if (this.guardReadonly()) return;
    const key = e.currentTarget.dataset.key;
    const idx = Number(e.detail.value);
    const opt = this.data.courseOptions[idx];
    if (!opt) return;
    this.patchRow(key, {
      courseId: opt.courseId,
      classId: opt.classId,
      courseLabel: opt.label,
      courseIndex: idx,
    });
  },

  onQtyInput(e) {
    if (this.guardReadonly()) return;
    const key = e.currentTarget.dataset.key;
    const raw = String(e.detail.value || '').replace(/[^\d]/g, '');
    this.patchRow(key, { quantity: raw === '' ? '' : Number(raw) });
  },

  onQtyBlur(e) {
    const key = e.currentTarget.dataset.key;
    const row = this.findRow(key);
    if (!row) return;
    let qty = Number(row.quantity);
    if (!isFinite(qty) || qty < config.TEACHER_QTY_MIN) qty = config.TEACHER_QTY_MIN;
    this.patchRow(key, { quantity: qty });
  },

  patchRow(key, patch) {
    const items = this.data.items.map((r) => (r.key === key ? Object.assign({}, r, patch) : r));
    this.setData({ items: items });
    this.recalc();
  },

  findRow(key) {
    return this.data.items.filter((r) => r.key === key)[0];
  },

  recalc() {
    const items = this.data.items || [];
    let totalQty = 0;
    items.forEach((r) => {
      totalQty += Number(r.quantity || 0);
    });
    // 教师填报按「行数 / 册数」计量（§5.4.2 明细模型），不展示金额：
    // 教材单价需额外检索才能取全，金额合计可能失真，故不显示。
    this.setData({
      itemCount: items.length,
      totalQuantity: totalQty,
    });
  },

  /* ---------------- 教材选择器（GET /api/teacher/textbook，裸数组 ≤50） ---------------- */
  openSelector(e) {
    if (this.guardReadonly()) return;
    const key = e.currentTarget.dataset.key;
    this.setData({
      selectorShow: true,
      selectorTargetKey: key,
      selectorKeyword: '',
      selectorResults: [],
      selectorEmpty: false,
    });
    this.searchTextbook('');
  },

  closeSelector() {
    this.setData({ selectorShow: false });
  },

  noop() {},

  onSelectorKeyword(e) {
    this.setData({ selectorKeyword: e.detail.value });
  },

  onSelectorSearch() {
    this.searchTextbook(this.data.selectorKeyword);
  },

  searchTextbook(keyword) {
    this.setData({ selectorLoading: true, selectorEmpty: false });
    api.teacher.textbook(keyword).then(
      (list) => {
        const results = Array.isArray(list) ? list : [];
        this.selectorCache = results;
        this.setData({
          selectorLoading: false,
          selectorResults: results,
          selectorEmpty: results.length === 0,
        });
        this.recalc();
      },
      (err) => {
        this.setData({
          selectorLoading: false,
          selectorResults: [],
          selectorEmpty: true,
        });
        wx.showToast({ title: err.message || '教材检索失败', icon: 'none' });
      },
    );
  },

  pickTextbook(e) {
    const id = e.currentTarget.dataset.id;
    const book = (this.data.selectorResults || []).filter((t) => t.textbookId === id)[0];
    if (!book) return;
    this.patchRow(this.data.selectorTargetKey, {
      textbookId: book.textbookId,
      textbookTitle: book.title,
      isbn: book.isbn,
      errors: [],
    });
    this.clearPendingErrors();
    this.setData({ selectorShow: false, fieldErrors: [], fieldErrorSummary: '' });
  },

  /* ---------------- 提交 ---------------- */
  onSubmit() {
    if (this.data.readonly) {
      wx.showToast({ title: this.data.lockHint || '当前不可提交', icon: 'none' });
      return;
    }
    if (!this.data.items.length) {
      wx.showToast({ title: '请至少新增一条明细', icon: 'none' });
      return;
    }
    // 本地只做「必填齐全」的轻校验，其余交服务端字段审查
    const incomplete = this.data.items.filter((r) => !r.courseId || !r.textbookId || !r.quantity);
    if (incomplete.length) {
      this.setData({
        fieldErrorSummary: `存在 ${incomplete.length} 行未填写完整（需选择课程与教材、填写数量）`,
      });
      wx.showToast({ title: '请先补全明细行', icon: 'none' });
      return;
    }
    this.setData({ confirmShow: true });
  },

  onConfirmCancel() {
    if (this.data.saving) return;
    this.setData({ confirmShow: false });
  },

  onConfirmSubmit() {
    if (this.data.saving) return;
    const items = this.data.items.map((r) => ({
      courseId: r.courseId,
      classId: r.classId,
      textbookId: r.textbookId,
      quantity: Number(r.quantity),
    }));

    this.setData({ saving: true });
    api.teacher.submitOrderForm(items).then(
      (res) => {
        this.clearPendingErrors();
        this.setData({ saving: false, confirmShow: false, fieldErrors: [], fieldErrorSummary: '' });
        wx.showToast({ title: '提交成功', icon: 'success' });
        // 提交后回到状态展示（全通过 → pending_review）
        setTimeout(() => {
          this.loadAll();
          if (res && res.status) this.setData({ status: res.status });
        }, 600);
      },
      (err) => {
        this.setData({ saving: false, confirmShow: false });
        this.handleSubmitError(err);
      },
    );
  },

  handleSubmitError(err) {
    const code = err.code;

    if (code === 'FIELD_CHECK_FAILED') {
      // data = [{field,rule,message}]，field 形如 items[0].quantity → 解析下标定位到行
      // 服务端不落库审查未过的行，因此这里保留用户当前编辑的明细行（含错误），
      // 只把「状态 + 补正截止」拉回（refreshStatusOnly 不重建行，避免行序错位丢错误）
      const errs = this.parseFieldCheck(err.data) || { byIndex: {}, general: [], summary: '' };
      this.pendingFieldErrors = errs;
      this.setData({
        items: this.data.items.map((r, i) => Object.assign({}, r, { errors: errs.byIndex[i] || [] })),
        fieldErrors: errs.general,
        fieldErrorSummary: errs.summary,
        status: 'rejected_auto',
        statusLabel: STATUS_META.rejected_auto.label,
        statusTone: STATUS_META.rejected_auto.tone,
        needCorrection: true,
      });
      this.applyReadonly();
      this.refreshStatusOnly();
      wx.showToast({
        title: errs.summary || '存在字段问题，请修复后重新提交',
        icon: 'none',
        duration: 2500,
      });
      return;
    }

    if (code === 'CORRECTION_EXPIRED') {
      wx.showToast({ title: '补正窗口已过，请联系教材室', icon: 'none', duration: 2500 });
      this.correctionExpired = true;
      this.setData({ correctionExpired: true });
      this.applyReadonly();
      this.loadAll();
      return;
    }

    if (code === 'WINDOW_CLOSED') {
      wx.showToast({ title: '本期征订已截止', icon: 'none', duration: 2500 });
      this.refreshWindow();
      return;
    }

    if (code === 'WINDOW_NOT_OPEN') {
      wx.showToast({ title: '征订尚未开始', icon: 'none', duration: 2500 });
      this.refreshWindow();
      return;
    }

    // PARAM_INVALID / BIZ_ERROR / STATE_CONFLICT 等直显服务端 message
    wx.showToast({ title: err.message || '提交失败，请稍后重试', icon: 'none', duration: 2800 });
    if (code === 'STATE_CONFLICT') this.loadAll();
  },

  refreshWindow() {
    const comp = this.selectComponent('#windowStatus');
    if (comp && comp.refresh) comp.refresh();
  },

  goRecords() {
    wx.navigateTo({ url: '/pages/teacher-records/teacher-records' });
  },
});
