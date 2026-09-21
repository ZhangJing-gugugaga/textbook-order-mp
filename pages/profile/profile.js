const auth = require('../../utils/auth');
const api = require('../../utils/api');
const config = require('../../utils/config');

const app = getApp();

const ROLE_SHORT = {
  STUDENT: '学生',
  TEACHER: '任课老师',
  ADMIN: '教材室超管',
  SECRETARY: '学院秘书',
  SUPPLIER: '供货商',
};

Page({
  data: {
    me: null,
    roleText: '',
    collegeText: '',
    openidBound: false,
    binding: false,
    subscribeText: '',

    roles: [],
    canSwitch: false,
    switching: false,

    // 改密弹层
    pwdShow: false,
    oldPassword: '',
    newPassword: '',
    newPassword2: '',
    pwdError: '',
    pwdSaving: false,

    version: '1.0.0',
    envText: '',
  },

  onLoad() {
    app.whenSessionReady().then((result) => {
      if (!result || !result.ok) {
        auth.redirectToLogin();
        return;
      }
      this.applyMe(result.me);
    });
    // N5：静默 refresh 可能重置 currentRole，此处跟随服务端结果刷新
    auth.onRoleChanged(() => {
      const cached = auth.getCachedMe();
      if (cached) this.applyMe(cached);
    });
  },

  onShow() {
    if (!this.data.me) return;
    // 进入页面重取 /api/me（缓存仅用于首屏渲染）
    app.refreshMe().then(
      (me) => this.applyMe(me),
      () => {},
    );
  },

  applyMe(me) {
    const normalized = auth.normalizeMe(me);
    if (!normalized) return;
    const roles = normalized.roles || [];
    const isTeacherOrStudent = roles.indexOf('TEACHER') >= 0 || roles.indexOf('STUDENT') >= 0;
    const subscribe = auth.getSubscribeResult();

    this.setData({
      me: normalized,
      roleText: auth.roleLabel(normalized.currentRole),
      collegeText: this.buildAffiliation(normalized),
      openidBound: !!normalized.openidBound,
      roles: roles.map((r) => ({ code: r, label: ROLE_SHORT[r] || r, current: r === normalized.currentRole })),
      canSwitch: roles.length > 1 && isTeacherOrStudent,
      subscribeText: normalized.openidBound
        ? subscribe && subscribe.result === 'rejected'
          ? '已绑定微信 · 最近一次订阅授权被拒绝，仅弹窗提醒'
          : '已绑定微信，可接收订阅提醒'
        : '未绑定微信，仅弹窗提醒',
      envText: config.baseUrl,
    });
  },

  buildAffiliation(me) {
    const parts = [];
    if (me.collegeName) parts.push(me.collegeName);
    if (me.className) parts.push(me.className);
    return parts.length ? parts.join(' · ') : '未分配';
  },

  /* ---------------- openid 绑定（复用 first-login/verify，§4.3-G4） ---------------- */
  onBindWx() {
    if (this.data.binding) return;
    this.setData({ binding: true });
    wx.login({
      success: (res) => {
        if (!res || !res.code) {
          this.setData({ binding: false });
          wx.showToast({ title: '微信授权不可用，请稍后重试', icon: 'none' });
          return;
        }
        api.auth.firstLoginVerify({ wxCode: res.code }).then(
          () => {
            this.setData({ binding: false, openidBound: true });
            wx.showToast({ title: '绑定成功', icon: 'success' });
            return app.refreshMe().then((me) => this.applyMe(me));
          },
          (err) => {
            // 绑定失败静默降级，不阻塞使用（§4.3-G4）
            this.setData({ binding: false });
            wx.showToast({
              title: err.message || '绑定失败，请稍后重试',
              icon: 'none',
              duration: 2500,
            });
          },
        );
      },
      fail: () => {
        this.setData({ binding: false });
        wx.showToast({ title: '微信授权不可用，请稍后重试', icon: 'none' });
      },
    });
  },

  /* ---------------- 切换身份 ---------------- */
  onSwitchRole(e) {
    const code = e.currentTarget.dataset.code;
    if (!code || this.data.switching) return;
    if (this.data.me && code === this.data.me.currentRole) return;

    this.setData({ switching: true });
    api.auth
      .switchRole(code)
      .then(
        (res) => {
          if (res && res.accessToken) auth.saveAuth(auth.normalizeAuth(res));
          // 切换后清 tx_me、重取 /api/me、重新落地（§5.5）
          auth.saveMe(null);
          return app.refreshMe();
        },
        (err) => {
          this.setData({ switching: false });
          wx.showToast({ title: err.message || '切换失败', icon: 'none' });
          return null;
        },
      )
      .then((me) => {
        this.setData({ switching: false });
        if (!me) return;
        this.applyMe(me);
        const mode = auth.homeMode(me);
        wx.showToast({
          title: mode === 'web' ? '该身份请使用 Web 端' : `已切换为${auth.roleLabel(me.currentRole)}`,
          icon: 'none',
        });
        setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 700);
      });
  },

  /* ---------------- 修改密码 ---------------- */
  openPwd() {
    this.setData({ pwdShow: true, oldPassword: '', newPassword: '', newPassword2: '', pwdError: '' });
  },
  closePwd() {
    if (this.data.pwdSaving) return;
    this.setData({ pwdShow: false });
  },
  noop() {},
  onOldPwdInput(e) {
    this.setData({ oldPassword: e.detail.value, pwdError: '' });
  },
  onNewPwdInput(e) {
    this.setData({ newPassword: e.detail.value, pwdError: '' });
  },
  onNewPwd2Input(e) {
    this.setData({ newPassword2: e.detail.value, pwdError: '' });
  },
  onSubmitPwd() {
    const { oldPassword, newPassword, newPassword2 } = this.data;
    if (!oldPassword) {
      this.setData({ pwdError: '请输入原密码' });
      return;
    }
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(newPassword || '')) {
      this.setData({ pwdError: '新密码需 8 位以上且含字母和数字' });
      return;
    }
    if (newPassword !== newPassword2) {
      this.setData({ pwdError: '两次输入的新密码不一致' });
      return;
    }
    if (this.data.pwdSaving) return;
    this.setData({ pwdSaving: true, pwdError: '' });
    api.me.changePassword(oldPassword, newPassword).then(
      (res) => {
        if (res && res.accessToken) auth.saveAuth(auth.normalizeAuth(res));
        this.setData({ pwdSaving: false, pwdShow: false });
        wx.showToast({ title: '密码修改成功', icon: 'success' });
      },
      (err) => {
        this.setData({
          pwdSaving: false,
          pwdError: err.code === 'PASSWORD_POLICY' ? '新密码需 8 位以上且含字母和数字' : err.message,
        });
      },
    );
  },

  /* ---------------- 关于 ---------------- */
  onAbout() {
    wx.showModal({
      title: '关于',
      content: `教材征订小程序 v${this.data.version}\n数据来自学校教材征订服务，登录状态与操作结果实时同步。`,
      showCancel: false,
      confirmText: '知道了',
    });
  },

  /* ---------------- 退出登录 ---------------- */
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
});
