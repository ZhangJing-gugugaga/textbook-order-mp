const auth = require('../../utils/auth');
const api = require('../../utils/api');

const app = getApp();

// 演示账号（后端种子数据，§10.3）
const DEMO = [
  { key: 'teacher', role: '任课老师', label: '700101 · 教师甲', userNo: '700101', password: 'Tea@12345', icon: '📘', tone: 'icon-indigo' },
  { key: 'student', role: '学生', label: '20230101 · 学生甲', userNo: '20230101', password: 'Stu@12345', icon: '🎓', tone: 'icon-green' },
  { key: 'first', role: '首登待改密 · 走首登流程', label: '700102 · 教师乙', userNo: '700102', password: '700102', icon: '🔑', tone: 'icon-orange' },
];

// 登录错误码文案（§5.1 / 附录 B）
const LOGIN_ERROR_TEXT = {
  LOGIN_FAILED: '账号或密码不正确',
  ACCOUNT_LOCKED: '账号已锁定，请稍后再试',
  ACCOUNT_DISABLED: '账号已停用，请联系教材室',
  RATE_LIMITED: '操作过于频繁，请稍后再试',
  NETWORK_ERROR: '网络异常，请检查网络后重试',
};

/** 角色 → 默认权限码（仅用于 /api/me 不可用时的降级落地） */
function permissionsOfRole(role) {
  switch (role) {
    case 'TEACHER':
      return ['semester:window:view', 'order:form:submit', 'order:form:view:self'];
    case 'STUDENT':
      return ['semester:window:view', 'student:order:submit', 'student:order:view:self'];
    default:
      return [];
  }
}

Page({
  data: {
    step: 'checking', // checking | form | verify | password
    demoAccounts: DEMO,

    userNo: '',
    password: '',
    error: '',
    loading: false,

    // 首登校验
    verifying: false,
    verifyError: '',
    phoneTail: '',
    wxTrying: false,
    verifyHint: '',

    // 改密
    oldPassword: '',
    newPassword: '',
    newPassword2: '',
    pwdError: '',
    pwdSaving: false,
  },

  onLoad() {
    this.pendingAuth = null;
    app.whenSessionReady().then((result) => {
      if (result && result.ok) {
        // 冷启动有有效会话 → 直接落地，不显示登录页（修复 MVP P3 #8）
        this.land(result.me);
        return;
      }
      this.setData({ step: 'form' });
    });
  },

  /* ---------------- 登录 ---------------- */
  onUserNoInput(e) {
    this.setData({ userNo: e.detail.value, error: '' });
  },
  onPasswordInput(e) {
    this.setData({ password: e.detail.value, error: '' });
  },

  fillDemo(e) {
    const key = e.currentTarget.dataset.key;
    const item = DEMO.filter((d) => d.key === key)[0];
    if (!item) return;
    this.setData({ userNo: item.userNo, password: item.password, error: '' });
  },

  onLogin() {
    const userNo = (this.data.userNo || '').trim();
    const password = this.data.password || '';
    if (!userNo) {
      this.setData({ error: '请输入学号或工号' });
      return;
    }
    if (!password) {
      this.setData({ error: '请输入密码' });
      return;
    }
    if (this.data.loading) return;

    this.setData({ loading: true, error: '' });
    auth
      .login(userNo, password)
      .then((authData) => {
        this.pendingAuth = authData;
        this.setData({ loading: false });

        if (authData.mustChangePassword || !authData.firstLoginVerified) {
          // 首登流程不可跳过（§5.1-③）
          this.setData({ step: 'verify', verifyError: '', verifyHint: '' });
          this.tryWxVerify();
          return null;
        }
        return this.afterLogin();
      })
      .catch((err) => {
        this.setData({
          loading: false,
          error: LOGIN_ERROR_TEXT[err.code] || err.message || '登录失败，请稍后重试',
        });
      });
  },

  /** 登录成功（无需首登）→ 取 /api/me → 落地 */
  afterLogin() {
    return auth.fetchMe().then(
      (me) => {
        const normalized = auth.saveMe(me);
        if (normalized && normalized.mustChangePassword) {
          this.setData({ step: 'verify', verifyError: '', verifyHint: '' });
          this.tryWxVerify();
          return null;
        }
        this.land(normalized);
        return normalized;
      },
      (err) => {
        if (err && err.code === 'FIRST_LOGIN_REQUIRED') {
          // 403 兜底：任何业务接口命中首登拦截都回到首登流程（§5.1-④）
          this.setData({ step: 'verify', verifyError: '', verifyHint: '' });
          this.tryWxVerify();
          return null;
        }
        // /api/me 失败不阻断：仍按登录响应落地，首页会重取
        this.landFromAuth();
        return null;
      },
    );
  },

  /* ---------------- 首登校验 ---------------- */
  /** 首选 wx.login → wxCode（换取并绑定 openid）；失败降级为手机号后 4 位（§5.1-③.1 / §4.3-G4） */
  tryWxVerify() {
    if (this.data.wxTrying) return;
    this.setData({ wxTrying: true, verifyHint: '正在通过微信校验…' });
    wx.login({
      success: (res) => {
        if (!res || !res.code) {
          this.setData({ wxTrying: false, verifyHint: '微信校验不可用，请改用手机号后 4 位' });
          return;
        }
        api.auth.firstLoginVerify({ wxCode: res.code }).then(
          () => {
            this.setData({ wxTrying: false, verifyHint: '' });
            this.goPasswordStep();
          },
          () => {
            this.setData({ wxTrying: false, verifyHint: '微信校验未通过，请改用手机号后 4 位' });
          },
        );
      },
      fail: () => {
        this.setData({ wxTrying: false, verifyHint: '微信校验不可用，请改用手机号后 4 位' });
      },
    });
  },

  onPhoneTailInput(e) {
    this.setData({ phoneTail: e.detail.value, verifyError: '' });
  },

  onVerifyPhone() {
    const tail = (this.data.phoneTail || '').trim();
    if (!/^\d{4}$/.test(tail)) {
      this.setData({ verifyError: '请输入手机号后 4 位数字' });
      return;
    }
    if (this.data.verifying) return;
    this.setData({ verifying: true, verifyError: '' });
    api.auth.firstLoginVerify({ phoneTail: tail }).then(
      () => {
        this.setData({ verifying: false });
        this.goPasswordStep();
      },
      (err) => {
        this.setData({
          verifying: false,
          verifyError:
            err.code === 'FIRST_LOGIN_VERIFY_FAILED' ? '校验信息不正确，请联系教材室' : err.message,
        });
      },
    );
  },

  goPasswordStep() {
    this.setData({
      step: 'password',
      pwdError: '',
      oldPassword: this.data.password || '',
      newPassword: '',
      newPassword2: '',
    });
  },

  /* ---------------- 改密 ---------------- */
  onOldPwdInput(e) {
    this.setData({ oldPassword: e.detail.value, pwdError: '' });
  },
  onNewPwdInput(e) {
    this.setData({ newPassword: e.detail.value, pwdError: '' });
  },
  onNewPwd2Input(e) {
    this.setData({ newPassword2: e.detail.value, pwdError: '' });
  },

  onChangePassword() {
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
        // 改密成功返回新令牌（AuthResponse），会话不中断
        if (res && res.accessToken) auth.saveAuth(auth.normalizeAuth(res));
        this.setData({ pwdSaving: false });
        wx.showToast({ title: '密码修改成功', icon: 'success' });
        this.afterLogin();
      },
      (err) => {
        this.setData({
          pwdSaving: false,
          pwdError:
            err.code === 'PASSWORD_POLICY'
              ? '新密码需 8 位以上且含字母和数字'
              : err.code === 'FIRST_LOGIN_VERIFY_FAILED'
                ? '请先完成首登校验'
                : err.message,
        });
      },
    );
  },

  /* ---------------- 落地 ---------------- */
  land(me) {
    const mode = auth.homeMode(me);
    // 刷新会话缓存，避免首页/我的页沿用启动时的「未登录」结论被弹回登录页
    app.setSession(me);
    app.globalData.homeMode = mode;
    wx.switchTab({ url: '/pages/home/home' });
  },

  /** 登录响应已含角色信息，/api/me 不可用时的降级落地 */
  landFromAuth() {
    const a = this.pendingAuth;
    const pseudo = a
      ? { permissions: permissionsOfRole(a.currentRole), currentRole: a.currentRole }
      : null;
    this.land(pseudo);
  },
});
