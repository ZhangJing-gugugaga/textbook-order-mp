/**
 * 契约消费层：wx.request 的 Promise 封装
 *
 * 职责：envelope 解包、错误归一、401 挂接（单飞 refresh 由 auth.js 提供）。
 * 依据：docs/08-小程序端升级计划.md §3.3 + textbook-order-server/API.md §1.2
 *
 * 分流规则（以 code 为准，HTTP 状态兜底）：
 *   1) HTTP 2xx 且 body.code === '0'  → resolve(body.data)
 *   2) HTTP 204 或空 body             → resolve(null)
 *   3) 其余                           → reject({ code, message, httpStatus, data })
 */

const config = require('./config');

// 页面级并发闸门：wx.request 默认并发上限 10，避免同时超过 5 个在途请求
const MAX_INFLIGHT = 5;
let inflight = 0;
const waiters = [];

function acquireSlot() {
  if (inflight < MAX_INFLIGHT) {
    inflight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function releaseSlot() {
  const next = waiters.shift();
  if (next) {
    next();
    return;
  }
  inflight = Math.max(0, inflight - 1);
}

function buildError(code, message, extra) {
  return Object.assign(
    {
      code: code || 'UNKNOWN',
      message: message || '操作失败，请稍后重试',
      httpStatus: 0,
      data: null,
    },
    extra || {},
  );
}

/**
 * 归一化错误：优先用服务端 message（已按 PRD 文案规范），网络类给统一文案
 */
function normalizeError(res, body) {
  const httpStatus = res && typeof res.statusCode === 'number' ? res.statusCode : 0;

  if (!body || typeof body !== 'object') {
    // 非 envelope（如 5xx 网关页、空响应体）
    if (httpStatus === 0) {
      return buildError('NETWORK_ERROR', '网络异常，请检查网络后重试', { httpStatus });
    }
    return buildError('SERVER_ERROR', '服务开小差了，请稍后重试', { httpStatus });
  }

  const code = body.code ? String(body.code) : httpStatus >= 500 ? 'SERVER_ERROR' : 'UNKNOWN';
  const message = body.message || defaultMessageFor(code);
  return buildError(code, message, { httpStatus, data: body.data == null ? null : body.data });
}

function defaultMessageFor(code) {
  switch (code) {
    case 'SERVER_ERROR':
      return '服务开小差了，请稍后重试';
    case 'NETWORK_ERROR':
      return '网络异常，请检查网络后重试';
    case 'FORBIDDEN':
    case 'RESOURCE_FORBIDDEN':
      return '无权执行该操作';
    case 'NOT_FOUND':
      return '资源不存在';
    case 'STATE_CONFLICT':
      return '数据状态已变更，请刷新后重试';
    default:
      return '操作失败，请稍后重试';
  }
}

/**
 * 原始请求：返回 { statusCode, data(解析后的 body) }，不抛业务错误
 */
function raw(options) {
  return acquireSlot().then(
    () =>
      new Promise((resolve, reject) => {
        const header = Object.assign(
          { 'Content-Type': 'application/json' },
          options.header || {},
        );
        if (options.auth !== false) {
          const auth = require('./auth'); // 延迟 require：避免与 auth.js 循环依赖
          const token = auth.getAccessToken();
          if (token) header.Authorization = `Bearer ${token}`;
          const deviceId = auth.getDeviceId();
          if (deviceId) header['X-Device-Id'] = deviceId;
        }

        wx.request({
          url: config.baseUrl + options.path,
          method: options.method || 'GET',
          data: options.data,
          header,
          timeout: options.timeout || config.timeout,
          dataType: 'json',
          success: (res) => resolve({ statusCode: res.statusCode, body: res.data }),
          fail: (err) => {
            const msg = err && err.errMsg ? err.errMsg : '';
            const isTimeout = msg.indexOf('timeout') >= 0;
            reject(
              buildError(
                'NETWORK_ERROR',
                isTimeout ? '请求超时，请检查网络后重试' : '网络异常，请检查网络后重试',
                { httpStatus: 0, raw: msg },
              ),
            );
          },
        });
      }),
  ).then(
    (v) => {
      releaseSlot();
      return v;
    },
    (e) => {
      releaseSlot();
      throw e;
    },
  );
}

/**
 * 业务请求：解包 envelope，401 走单飞 refresh + 重放（每请求最多 1 次）
 */
function request(options) {
  return raw(options).then(
    (res) => {
      const { statusCode, body } = res;

      // 204 / 空 body → null（/api/notice/{taskId}/confirm 返回 204）
      if (statusCode === 204 || body === '' || body == null) {
        if (statusCode >= 200 && statusCode < 300) return null;
        throw normalizeError(res, null);
      }

      if (statusCode >= 200 && statusCode < 300 && body && String(body.code) === '0') {
        return body.data == null ? null : body.data;
      }

      const error = normalizeError(res, body);
      return handleAuthError(error, options);
    },
    (error) => {
      // 网络层错误：不是 401，直接抛
      throw error;
    },
  );
}

/**
 * 401/403 会话分流（§3.4 / 附录 B）
 */
function handleAuthError(error, options) {
  const auth = require('./auth');
  const code = error.code;

  // 登录页自身的错误（账号密码错、锁定）不触发 refresh
  if (options.skipAuthFlow) throw error;

  if (code === 'TOKEN_EXPIRED' && !options._retried) {
    return auth.refreshToken().then(
      () => request(Object.assign({}, options, { _retried: true })),
      () => {
        throw error; // refresh 失败已由 auth 内部强制登出
      },
    );
  }

  if (code === 'REFRESH_INVALID' || code === 'TOKEN_INVALID' || code === 'UNAUTHORIZED') {
    auth.forceLogout('登录已过期，请重新登录');
    throw error;
  }

  if (code === 'ACCOUNT_DISABLED') {
    auth.forceLogout('账号已停用，请联系教材室');
    throw error;
  }

  throw error;
}

module.exports = {
  request,
  raw,
  buildError,
  defaultMessageFor,
};
