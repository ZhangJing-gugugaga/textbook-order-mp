/**
 * 会话层：token 存取、单飞 refresh、并发排队、强制登出、会话恢复
 *
 * 依据：docs/08-小程序端升级计划.md §3.4（MP10 默认值）+ §5.1 首登流程
 *
 * 关键实现约束（§13 新发现）：
 *   N4 · mustChangePassword / firstLoginVerified 在 AuthResponse 为布尔、在 /api/me 为 0/1 整数 → 统一归一为布尔
 *   N5 · refresh 会重置 currentRole = roles[0] → refresh 成功后重取 /api/me 并以服务端 currentRole 为准
 */

const config = require('./config');
const request = require('./request');

const K = config.STORAGE_KEYS;

/* ------------------------------------------------------------------ *
 * 内存态（避免每次读 Storage）
 * ------------------------------------------------------------------ */
let tokens = null; // { accessToken, refreshToken, expiresAt, deviceId }
let meCache = null;
let refreshPromise = null; // 单飞：并发 401 共用同一个 refresh
const roleListeners = [];

function emitRoleChanged(role) {
  roleListeners.forEach((cb) => {
    try {
      cb(role);
    } catch (e) {
      /* 监听器异常不影响主流程 */
    }
  });
}

function onRoleChanged(cb) {
  if (typeof cb === 'function') roleListeners.push(cb);
}

/* ------------------------------------------------------------------ *
 * deviceId
 * ------------------------------------------------------------------ */
function getDeviceId() {
  if (tokens && tokens.deviceId) return tokens.deviceId;
  let deviceId = wx.getStorageSync(K.deviceId);
  if (!deviceId) {
    deviceId = `mp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    wx.setStorageSync(K.deviceId, deviceId);
  }
  return deviceId;
}

/* ------------------------------------------------------------------ *
 * token 存取
 * ------------------------------------------------------------------ */
function getAccessToken() {
  const t = getTokens();
  return t ? t.accessToken : '';
}

function getRefreshTokenValue() {
  const t = getTokens();
  return t ? t.refreshToken : '';
}

function getTokens() {
  if (tokens) return tokens;
  const saved = wx.getStorageSync(K.auth);
  if (saved && saved.accessToken) {
    tokens = saved;
    return tokens;
  }
  return null;
}

function saveAuth(authResponse) {
  const expiresIn = Number(authResponse.expiresIn || 900);
  tokens = {
    accessToken: authResponse.accessToken,
    refreshToken: authResponse.refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    deviceId: getDeviceId(),
  };
  wx.setStorageSync(K.auth, tokens);
  return tokens;
}

function saveMe(me) {
  meCache = me ? normalizeMe(me) : null;
  if (meCache) wx.setStorageSync(K.me, meCache);
  else wx.removeStorageSync(K.me);
  return meCache;
}

function getCachedMe() {
  if (meCache) return meCache;
  const saved = wx.getStorageSync(K.me);
  if (saved) {
    meCache = saved;
    return meCache;
  }
  return null;
}

function clearSession() {
  tokens = null;
  meCache = null;
  refreshPromise = null;
  wx.removeStorageSync(K.auth);
  wx.removeStorageSync(K.me);
}

/* ------------------------------------------------------------------ *
 * 类型归一（N4）
 * ------------------------------------------------------------------ */
function toBool(v) {
  if (v === true || v === false) return v;
  if (v === 1 || v === '1') return true;
  if (v === 0 || v === '0') return false;
  return !!v;
}

function normalizeMe(me) {
  if (!me) return null;
  return Object.assign({}, me, {
    mustChangePassword: toBool(me.mustChangePassword),
    firstLoginVerified: toBool(me.firstLoginVerified),
    openidBound: toBool(me.openidBound),
    permissions: Array.isArray(me.permissions) ? me.permissions : [],
    roles: Array.isArray(me.roles) ? me.roles : [],
  });
}

function normalizeAuth(auth) {
  if (!auth) return null;
  return Object.assign({}, auth, {
    mustChangePassword: toBool(auth.mustChangePassword),
    firstLoginVerified: toBool(auth.firstLoginVerified),
  });
}

/* ------------------------------------------------------------------ *
 * 角色与落地判定（§1.2：按权限码，不写死角色名）
 * ------------------------------------------------------------------ */
const PERM_TEACHER = 'order:form:submit';
const PERM_STUDENT = 'student:order:submit';

function hasPerm(me, code) {
  return !!(me && Array.isArray(me.permissions) && me.permissions.indexOf(code) >= 0);
}

function isTeacher(me) {
  return hasPerm(me, PERM_TEACHER);
}

function isStudent(me) {
  return hasPerm(me, PERM_STUDENT);
}

/**
 * 落地页模式：'teacher' | 'student' | 'web'
 * 两者都有 → 以 currentRole 为准；都没有 → Web 端引导
 */
function homeMode(me) {
  const t = isTeacher(me);
  const s = isStudent(me);
  if (t && s) {
    if (me && me.currentRole === 'STUDENT') return 'student';
    return 'teacher';
  }
  if (t) return 'teacher';
  if (s) return 'student';
  return 'web';
}

const ROLE_LABEL = {
  STUDENT: '学生',
  TEACHER: '任课老师',
  ADMIN: '教材室超管',
  SECRETARY: '学院秘书',
  SUPPLIER: '供货商',
};

function roleLabel(code) {
  return ROLE_LABEL[code] || code || '未知身份';
}

/* ------------------------------------------------------------------ *
 * 首启迁移：清空 MVP 遗留业务键（§3.5-4）
 * ------------------------------------------------------------------ */
function migrateLegacyStorage() {
  const legacyHits = config.LEGACY_KEYS.filter((key) => {
    try {
      return wx.getStorageSync(key) !== '' && wx.getStorageSync(key) != null;
    } catch (e) {
      return false;
    }
  });
  if (!legacyHits.length) return false;
  config.LEGACY_KEYS.forEach((key) => wx.removeStorageSync(key));
  wx.removeStorageSync(K.auth);
  wx.removeStorageSync(K.me);
  tokens = null;
  meCache = null;
  return true;
}

/* ------------------------------------------------------------------ *
 * 冷启动会话恢复（修复 MVP P3 #8：有会话仍显示登录页）
 * ------------------------------------------------------------------ */
function bootstrap() {
  migrateLegacyStorage();

  const saved = getTokens();
  if (!saved || !saved.accessToken) {
    return Promise.resolve({ ok: false, reason: 'NO_SESSION' });
  }

  // access 未过期 → 直连业务接口（不必先 refresh）
  const ahead = config.REFRESH_AHEAD_SECONDS * 1000;
  if (saved.expiresAt && saved.expiresAt - Date.now() > ahead) {
    return Promise.resolve({ ok: true, mode: 'access' });
  }

  // access 已过期/临期 → 用 refresh 换新；失败才跳登录页
  if (!saved.refreshToken) {
    clearSession();
    return Promise.resolve({ ok: false, reason: 'NO_REFRESH' });
  }
  return refreshToken().then(
    () => ({ ok: true, mode: 'refresh' }),
    () => ({ ok: false, reason: 'REFRESH_FAILED' }),
  );
}

/* ------------------------------------------------------------------ *
 * 单飞 refresh（并发排队共用同一 Promise）
 * ------------------------------------------------------------------ */
function refreshToken() {
  if (refreshPromise) return refreshPromise;

  const rt = getRefreshTokenValue();
  if (!rt) {
    forceLogout('登录已过期，请重新登录');
    return Promise.reject(request.buildError('REFRESH_INVALID', '登录已过期，请重新登录'));
  }

  refreshPromise = request
    .raw({
      path: '/auth/refresh',
      method: 'POST',
      data: { refreshToken: rt },
      auth: false,
    })
    .then((res) => {
      const body = res && res.body;
      if (res.statusCode >= 200 && res.statusCode < 300 && body && String(body.code) === '0') {
        saveAuth(body.data);
        return afterRefresh(body.data);
      }
      const code = body && body.code ? String(body.code) : 'REFRESH_INVALID';
      const message = (body && body.message) || '登录已过期，请重新登录';
      clearSession();
      redirectToLogin(message);
      throw request.buildError(code, message, { httpStatus: res.statusCode });
    })
    .then(
      (v) => {
        refreshPromise = null;
        return v;
      },
      (e) => {
        refreshPromise = null;
        throw e;
      },
    );

  return refreshPromise;
}

/**
 * N5：refresh 会把 currentRole 重置为 roles[0]。
 * 这里重取 /api/me，以服务端返回的 currentRole 为准；与本地缓存不一致时广播变更，
 * 由页面重新渲染（不得静默沿用旧值）。
 */
function afterRefresh(authData) {
  const before = getCachedMe();
  return fetchMe({ skipRefresh: true }).then(
    (me) => {
      const normalized = saveMe(me);
      if (authData) {
        // 服务端已按 roles[0] 重置，本地以 /api/me 为准
        if (before && normalized && before.currentRole !== normalized.currentRole) {
          emitRoleChanged(normalized.currentRole);
        }
      }
      return normalized;
    },
    () => {
      // /api/me 拉取失败不阻断 refresh 结果（下次进页面会重取）
      if (authData) saveAuth(authData);
      return getCachedMe();
    },
  );
}

/* ------------------------------------------------------------------ *
 * /api/me（带缓存，进页面后重取）
 * ------------------------------------------------------------------ */
function fetchMe(options) {
  return request.request({
    path: '/me',
    method: 'GET',
    skipAuthFlow: !!(options && options.skipAuthFlow),
  });
}

/* ------------------------------------------------------------------ *
 * 登录 / 登出
 * ------------------------------------------------------------------ */
function login(userNo, password) {
  return request
    .raw({
      path: '/auth/login',
      method: 'POST',
      data: { userNo: userNo, password: password },
      auth: false,
    })
    .then((res) => {
      const body = res && res.body;
      if (res.statusCode >= 200 && res.statusCode < 300 && body && String(body.code) === '0') {
        const auth = normalizeAuth(body.data);
        saveAuth(auth);
        return auth;
      }
      throw request.buildError(
        body && body.code ? String(body.code) : 'LOGIN_FAILED',
        (body && body.message) || '账号或密码不正确',
        { httpStatus: res.statusCode, data: body && body.data },
      );
    });
}

function forceLogout(message) {
  clearSession();
  redirectToLogin(message);
}

function logout() {
  return request
    .raw({ path: '/auth/logout', method: 'POST', auth: true })
    .then(
      () => null,
      () => null, // 尽力登出，失败忽略
    )
    .then(() => {
      clearSession();
      redirectToLogin();
    });
}

let redirecting = false;
function redirectToLogin(message) {
  if (message) {
    wx.showToast({ title: message, icon: 'none', duration: 2500 });
  }
  if (redirecting) return;
  const pages = getCurrentPages();
  const current = pages.length ? pages[pages.length - 1].route : '';
  if (current === 'pages/login/login') return;
  redirecting = true;
  setTimeout(() => {
    wx.reLaunch({
      url: '/pages/login/login',
      complete: () => {
        redirecting = false;
      },
    });
  }, message ? 800 : 0);
}

/* ------------------------------------------------------------------ *
 * 订阅授权本地结果（微信不提供授权状态查询接口，§5.5）
 * ------------------------------------------------------------------ */
function setSubscribeResult(result) {
  wx.setStorageSync(K.subscribeResult, { result: result, at: Date.now() });
}

function getSubscribeResult() {
  return wx.getStorageSync(K.subscribeResult) || null;
}

module.exports = {
  // storage
  getAccessToken,
  getTokens,
  getDeviceId,
  saveAuth,
  saveMe,
  getCachedMe,
  clearSession,
  // 归一
  normalizeMe,
  normalizeAuth,
  toBool,
  // 角色
  hasPerm,
  isTeacher,
  isStudent,
  homeMode,
  roleLabel,
  onRoleChanged,
  // 生命周期
  bootstrap,
  refreshToken,
  fetchMe,
  login,
  logout,
  forceLogout,
  redirectToLogin,
  // 订阅
  setSubscribeResult,
  getSubscribeResult,
};
