const auth = require('./utils/auth');
const api = require('./utils/api');
const config = require('./utils/config');

App({
  onLaunch() {
    // 冷启动会话恢复：有 refreshToken 则直连业务接口（401 走单飞 refresh），
    // 失败才跳登录页 —— 修复 MVP P3 #8（有会话仍显示登录页）
    this.globalData.sessionPromise = this.initSession();
  },

  initSession() {
    const app = this;
    return auth.bootstrap().then(
      (result) => {
        if (!result.ok) {
          app.globalData.sessionReady = false;
          return { ok: false, reason: result.reason };
        }
        return auth.fetchMe().then(
          (me) => {
            const normalized = auth.saveMe(me);
            app.globalData.me = normalized;
            app.globalData.sessionReady = true;
            return { ok: true, me: normalized };
          },
          () => {
            app.globalData.sessionReady = false;
            return { ok: false, reason: 'ME_FAILED' };
          },
        );
      },
      () => {
        app.globalData.sessionReady = false;
        return { ok: false, reason: 'BOOTSTRAP_FAILED' };
      },
    );
  },

  /** 会话就绪 Promise（页面等待它再决定渲染/跳转） */
  whenSessionReady() {
    if (!this.globalData.sessionPromise) {
      this.globalData.sessionPromise = this.initSession();
    }
    const app = this;
    return this.globalData.sessionPromise.then((result) => {
      // 登录页登录成功后，启动时缓存的 {ok:false} 结果已作废：
      // 只要本地已有令牌，就按当前令牌重新判定一次，避免首页/我的页被弹回登录页。
      if ((!result || !result.ok) && auth.getAccessToken()) {
        app.globalData.sessionPromise = app.initSession();
        return app.globalData.sessionPromise;
      }
      return result;
    });
  },

  /** 登录/改密/切换身份成功后刷新会话缓存（供页面调用） */
  setSession(me) {
    const normalized = me ? auth.saveMe(me) : null;
    this.globalData.me = normalized;
    this.globalData.sessionReady = true;
    this.globalData.sessionPromise = Promise.resolve({ ok: true, me: normalized });
    return normalized;
  },

  /** 重新拉取 /api/me 并落缓存（切换身份、改密后调用） */
  refreshMe() {
    const app = this;
    return auth.fetchMe().then((me) => {
      const normalized = auth.saveMe(me);
      app.globalData.me = normalized;
      return normalized;
    });
  },

  globalData: {
    sessionPromise: null,
    sessionReady: false,
    me: null,
    config: config,
    // 窗口状态缓存：由首页拉取，其他页进入时可直接用（仍会各自重取）
    windowStatus: null,
  },
});
