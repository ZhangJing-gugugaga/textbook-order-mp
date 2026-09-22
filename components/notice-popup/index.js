const api = require('../../utils/api');
const auth = require('../../utils/auth');
const config = require('../../utils/config');
const format = require('../../utils/format');

/**
 * 阻塞弹窗通知组件（§5.6 / MP5 / MP12）
 *
 * 流程：
 *   进入任一页面（attached）→ GET /api/notice/unconfirmed
 *   → 失败 = fail-open（放行进入，下次进入重查）
 *   → 有未确认 → 自绘居中阻塞 Modal，按 createdAt DESC 取最新 5 条（POPUP_QUEUE_MAX）排队
 *   → 逐条展示，点「收到」→ ① wx.requestSubscribeMessage（必须在点击回调内）→ ② POST /api/notice/{taskId}/confirm
 *   → 确认失败 → 保持弹窗阻塞 + 错误提示（不出队）
 *   → 展示的 5 条全部确认完 → 放行（第 6 条起不阻塞，在「我的」页可查）
 *
 * 要点：
 *   - 禁用 wx.showModal 作为阻塞通道，自绘居中 Modal；遮罩 catchtap 阻止穿透
 *   - 确认接口返回 204 无 body（request.js 已处理）；幂等，重复确认仍 204
 *   - 404 NOT_FOUND / 409 STATE_CONFLICT → 视为已确认，出队继续
 *   - roundStopped=true → 展示「该通知已停止重复推送，仍需确认」，仍必须确认
 *   - 订阅消息降级：未配模板 id（个人主体类目不可报 / WX_SUBSCRIBE_TEMPLATE_ID 未配）→ 纯弹窗
 *   - 首登顺序：未完成首登校验/改密不拉通知（由调用方 ensureSession 门禁保证）
 */

// 模块级状态：同一账号、同一次前台停留内，队列确认完就不再重复拉取（跨页面实例共享）。
// 该标记必须能失效，否则一旦被置位就再不复位：
//   ① 退出登录换账号 → 新账号的阻塞通知永远不弹；
//   ② app 常驻期间后端新发通知 → 回到小程序也不弹（违反「弹窗为主触达」）。
// 键 = 用户 id + 前台纪元（app.onShow 推进）：换账号或重新回到前台即自动失效。
let clearedKey = '';
let inflight = null;

/** 当前「账号 + 前台纪元」标识 */
function sessionKey() {
  const me = auth.getCachedMe();
  if (!me) return '';
  let epoch = 0;
  try {
    const app = getApp();
    if (app && app.globalData && app.globalData.noticeEpoch) epoch = app.globalData.noticeEpoch;
  } catch (e) {
    /* getApp 在极早期不可用，按 0 处理 */
  }
  const id = me.userId != null ? me.userId : me.userNo;
  return `${id}#${epoch}`;
}

Component({
  options: { multipleSlots: false },

  properties: {
    // 是否在 attached 时自动拉取（页面可传 false 自行控制时机）
    auto: { type: Boolean, value: true },
  },

  data: {
    show: false,
    queue: [],
    current: null,
    total: 0,
    done: 0,
    confirming: false,
    error: '',
    progressText: '',
    createdAtText: '',
    roundStopped: false,
    subscribeTip: '',
  },

  lifetimes: {
    attached() {
      if (this.data.auto) this.ensureFetch();
    },
  },

  methods: {
    /** 供页面显式触发（如登录成功后） */
    ensureFetch(force) {
      if (inflight) return inflight;

      // 未登录 / 未完成首登 → 不拉通知
      const me = auth.getCachedMe();
      if (!me || me.mustChangePassword) return Promise.resolve(null);

      // 本账号在本次前台停留内已确认清空 → 不再重复拉取（第 6 条起不阻塞，T4.1）
      const key = sessionKey();
      if (clearedKey && clearedKey === key && !force) return Promise.resolve(null);

      inflight = api.notice
        .unconfirmed()
        .then(
          (list) => {
            inflight = null;
            const all = Array.isArray(list) ? list : [];
            // 空队列不置 clearedKey：空 ≠ 用户已确认，后端新发通知后进入页面仍要弹
            if (!all.length) return null;
            // createdAt DESC 取最新 POPUP_QUEUE_MAX 条（其余在「我的」页可查，不阻塞）
            const queue = all
              .slice()
              .sort((a, b) => {
                const ta = format.parseServerTime(a.createdAt);
                const tb = format.parseServerTime(b.createdAt);
                return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
              })
              .slice(0, config.POPUP_QUEUE_MAX);
            this.applyQueue(queue);
            return queue;
          },
          () => {
            // fail-open：接口失败放行进入，下次进入重查
            inflight = null;
            return null;
          },
        )
        .then(
          (v) => {
            inflight = null;
            return v;
          },
          () => {
            inflight = null;
            return null;
          },
        );
      return inflight;
    },

    applyQueue(queue) {
      const current = queue[0] || null;
      this.setData({
        show: queue.length > 0,
        queue: queue,
        total: queue.length,
        done: 0,
        current: current,
        error: '',
        confirming: false,
        createdAtText: current && current.createdAt ? format.formatDateTime(current.createdAt) : '',
        roundStopped: !!(current && current.roundStopped),
        progressText: this.buildProgress(0, queue.length),
        subscribeTip: '',
      });
    },

    buildProgress(done, total) {
      const remain = total - done;
      if (remain <= 1) return '最后一条通知，确认后即可继续';
      return `还有 ${remain} 条通知待确认`;
    },

    /** 点「收到」：① 订阅授权（点击回调内）→ ② 确认落库 */
    onReceive() {
      if (this.data.confirming) return;
      const current = this.data.current;
      if (!current) return;

      this.setData({ confirming: true, error: '' });

      this.requestSubscribe()
        .then((subscribeResult) => this.confirmCurrent(current, subscribeResult))
        .catch((err) => {
          // 确认失败 → 保持阻塞 + 错误提示（不出队）
          this.setData({
            confirming: false,
            error: (err && err.message) || '确认失败，请重试',
          });
        });
    },

    /**
     * 订阅授权：必须在「收到」点击回调内触发（微信要求授权由用户点击触发，禁止进入即调用）。
     * 未配置模板 id（降级：个人主体类目不可报 / 未申请）→ 跳过，返回 null（不阻塞）。
     */
    requestSubscribe() {
      const tmplId = config.SUBSCRIBE_TEMPLATE_ID;
      if (!tmplId) {
        this.setData({ subscribeTip: '订阅提醒未开通，本次以应用内通知为准' });
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        wx.requestSubscribeMessage({
          tmplIds: [tmplId],
          success: (res) => {
            const accepted = res && res[tmplId] === 'accept';
            const result = accepted ? 'accepted' : 'rejected';
            auth.setSubscribeResult(result);
            this.setData({
              subscribeTip: accepted ? '已开启订阅提醒' : '未开启订阅提醒，不影响确认',
            });
            resolve(result);
          },
          fail: () => {
            // 授权失败不阻塞确认（§11 降级）
            auth.setSubscribeResult('rejected');
            this.setData({ subscribeTip: '订阅授权未完成，不影响确认' });
            resolve('rejected');
          },
        });
      });
    },

    confirmCurrent(current, subscribeResult) {
      return api.notice.confirm(current.taskId, subscribeResult).then(
        () => this.dequeue(),
        (err) => {
          const code = err && err.code;
          // 任务已关闭 / 已不存在 → 视为已确认，出队继续
          if (code === 'NOT_FOUND' || code === 'STATE_CONFLICT') {
            this.dequeue();
            return null;
          }
          throw err;
        },
      );
    },

    dequeue() {
      const queue = this.data.queue.slice(1);
      const done = this.data.done + 1;
      if (!queue.length) {
        // 展示的 5 条全部确认完 → 放行（记下「本账号本次前台」已清空）
        clearedKey = sessionKey();
        this.setData({ show: false, queue: [], current: null, confirming: false, error: '' });
        this.triggerEvent('cleared', { confirmed: done });
        return;
      }
      const current = queue[0];
      this.setData({
        queue: queue,
        current: current,
        done: done,
        confirming: false,
        error: '',
        createdAtText: current.createdAt ? format.formatDateTime(current.createdAt) : '',
        roundStopped: !!current.roundStopped,
        progressText: this.buildProgress(done, this.data.total),
      });
    },

    /** 遮罩与卡片都吞掉点击，阻止穿透（阻塞语义） */
    noop() {},

    /** 供页面在「我的」页确认后同步队列 */
    refresh() {
      clearedKey = '';
      return this.ensureFetch(true);
    },
  },
});
