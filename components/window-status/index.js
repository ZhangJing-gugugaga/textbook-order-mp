/**
 * 窗口三态组件（§5.7 / §5.2）
 *
 * 职责：拉取 GET /api/semester/window/status，按 serverTime 与 windowStart/windowEnd 求差渲染三态与倒计时；
 *      60s 轮询 + 进入页面重取；状态变化通过 bind:change 抛给页面（页面据此做只读/门禁）。
 *
 * 契约要点：
 *   - 倒计时一律用 serverTime 求差，不信本地时钟
 *   - 无 active 学期时仅返回 {serverTime, semesterId:null, windowStatus:null}
 *   - 提交类硬门禁 = windowStatus === 'open' && channelOpen === 1（channelOpen 是第二道闸）
 */

const api = require('../../utils/api');
const config = require('../../utils/config');
const format = require('../../utils/format');

Component({
  properties: {
    // 紧凑模式（用于选购/填报页顶部）
    compact: { type: Boolean, value: false },
    // 是否自动轮询
    autoPoll: { type: Boolean, value: true },
  },

  data: {
    loaded: false,
    error: '',
    hasSemester: false,
    semesterName: '',
    windowStatus: '', // not_open | open | closed
    channelOpen: 1,
    statusText: '',
    countdownText: '',
    tone: 'indigo', // indigo | green | gray
    // 提交门禁（页面直接用）
    canSubmit: false,
  },

  lifetimes: {
    attached() {
      this.countdown = null;
      this.ticker = null;
      this.fetchStatus();
      if (this.data.autoPoll) {
        this.poller = setInterval(() => this.fetchStatus(), config.WINDOW_POLL_MS);
      }
    },
    detached() {
      if (this.poller) clearInterval(this.poller);
      if (this.ticker) clearInterval(this.ticker);
      this.poller = null;
      this.ticker = null;
    },
  },

  methods: {
    /** 供页面主动重取（如收到 WINDOW_CLOSED 后） */
    refresh() {
      return this.fetchStatus();
    },

    fetchStatus() {
      return api.window.status().then(
        (status) => {
          this.applyStatus(status);
          return status;
        },
        (err) => {
          this.setData({ loaded: true, error: err.message || '窗口状态获取失败' });
          this.emitChange();
          return null;
        },
      );
    },

    applyStatus(status) {
      if (!status || !status.windowStatus) {
        this.setData({
          loaded: true,
          error: '',
          hasSemester: false,
          semesterName: '',
          windowStatus: '',
          statusText: '当前没有进行中的学期',
          countdownText: '',
          tone: 'gray',
          canSubmit: false,
        });
        this.emitChange();
        return;
      }

      const windowStatus = status.windowStatus;
      const channelOpen = Number(status.channelOpen == null ? 1 : status.channelOpen);
      const canSubmit = windowStatus === 'open' && channelOpen === 1;

      let tone = 'indigo';
      let statusText = '';
      let target = null;
      let prefix = '';

      if (windowStatus === 'open') {
        tone = canSubmit ? 'green' : 'indigo';
        statusText = '本期征订进行中';
        target = status.windowEnd;
        prefix = '将于 ';
      } else if (windowStatus === 'not_open') {
        tone = 'indigo';
        statusText = '征订尚未开始';
        target = status.windowStart;
        prefix = '距离开始还有 ';
      } else {
        tone = 'gray';
        statusText = '本期征订已截止，可查看历史记录';
      }

      // 倒计时以服务端时间为锚点（§5.7）
      this.countdown = target ? format.createCountdown(target, status.serverTime) : null;
      if (this.ticker) clearInterval(this.ticker);
      if (this.countdown) {
        this.ticker = setInterval(() => this.tick(), 1000);
      }

      this.setData(
        {
          loaded: true,
          error: '',
          hasSemester: true,
          semesterName: status.semesterName || '',
          windowStatus: windowStatus,
          channelOpen: channelOpen,
          statusText: statusText,
          tone: tone,
          canSubmit: canSubmit,
        },
        () => this.tick(prefix),
      );
      this.emitChange();
    },

    tick(prefix) {
      if (!this.countdown) {
        if (this.data.countdownText) this.setData({ countdownText: '' });
        return;
      }
      const text = this.countdown.text();
      const next = text ? `${prefix == null ? this.lastPrefix || '' : prefix}${text}` : '即将结束';
      this.lastPrefix = prefix == null ? this.lastPrefix : prefix;
      if (next !== this.data.countdownText) this.setData({ countdownText: next });
      if (this.countdown.expired() && this.ticker) {
        clearInterval(this.ticker);
        this.ticker = null;
        // 到点后重取真实状态（服务端状态机裁决）
        setTimeout(() => this.fetchStatus(), 1500);
      }
    },

    emitChange() {
      this.triggerEvent('change', {
        hasSemester: this.data.hasSemester,
        windowStatus: this.data.windowStatus,
        channelOpen: this.data.channelOpen,
        canSubmit: this.data.canSubmit,
        semesterName: this.data.semesterName,
        status: this.data,
      });
    },

    onRetry() {
      this.setData({ error: '' });
      this.fetchStatus();
    },
  },
});
