const store = require('../../utils/store');
const csvUtil = require('../../utils/export');
const xlsx = require('../../utils/xlsx-lite.js');

const COLORS = ['#4F46E5', '#16A34A', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6'];

Page({
  data: {
    orders: [],
    orderNames: [],
    orderIndex: 0,
    stats: null,
    overallRate: 0,
    missing: [],
    colors: COLORS
  },

  currentOrderId: '',

  onShow() {
    const session = store.getSession();
    if (!session || session.role !== 'admin') {
      wx.showToast({ title: '仅教材管理员可操作', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.loadOrders();
  },

  loadOrders() {
    const orders = store.getOrders();
    // 任务标题已含状态字样时不再重复拼接（如「xx（已截止）」+「（已截止）」）
    const names = orders.map((o) => {
      const suffix = o.status === 'open' ? '（进行中）' : '（已截止）';
      return o.title.indexOf(suffix) >= 0 ? o.title : o.title + suffix;
    });
    let idx = this.data.orderIndex;
    if (idx >= orders.length) idx = 0;
    this.setData({ orders, orderNames: names, orderIndex: idx });
    if (orders.length === 0) {
      this.setData({ stats: null, missing: [] });
      return;
    }
    // 支持从首页「查看统计」带 id 进入
    const pending = this.pendingOrderId;
    if (pending) {
      const i = orders.findIndex((o) => o.id === pending);
      if (i >= 0) idx = i;
      this.pendingOrderId = '';
      this.setData({ orderIndex: idx });
    }
    this.renderStats(orders[idx]);
  },

  onLoad(options) {
    if (options && options.id) this.pendingOrderId = options.id;
  },

  onOrderChange(e) {
    const idx = Number(e.detail.value);
    this.setData({ orderIndex: idx });
    this.renderStats(this.data.orders[idx]);
  },

  renderStats(order) {
    if (!order) return;
    this.currentOrderId = order.id;
    const stats = store.getStats(order.id);
    const overallRate = stats.total ? Math.round((stats.submitted / stats.total) * 100) : 0;
    const missing = store.getMissingStudents(order.id).map((u) => {
      const info = store.getClassFull(u.classId);
      // className 已含专业与年级，不再重复拼接 majorName
      return { id: u.id, name: u.name, className: info ? info.className : u.classId };
    });
    this.setData({ stats, overallRate, missing });
    // canvas 2d 节点挂载晚于首次 setData，延迟绘制并带一次重试
    setTimeout(() => this.drawPie(stats.byCollege), 350);
  },

  // canvas 2d 饼图
  drawPie(byCollege, retry) {
    const query = wx.createSelectorQuery();
    query.select('#pieCanvas').fields({ node: true, size: true }).exec((res) => {
      // 节点未挂载或布局尺寸为 0 时重试（size=0 会导致 canvas.width=0，绘制全部无效）
      if (!res || !res[0] || !res[0].node || !res[0].width || !res[0].height) {
        if ((retry || 0) < 5) {
          setTimeout(() => this.drawPie(byCollege, (retry || 0) + 1), 400);
        }
        return;
      }
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2;
      canvas.width = res[0].width * dpr;
      canvas.height = res[0].height * dpr;
      ctx.scale(dpr, dpr);

      const w = res[0].width;
      const h = res[0].height;
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(w, h) / 2 - 4;

      ctx.clearRect(0, 0, w, h);

      const data = byCollege.filter((c) => c.submitted > 0);
      const totalSum = data.reduce((s, c) => s + c.submitted, 0);
      // 无人提交：画灰环
      if (totalSum === 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, r - 16, 0, Math.PI * 2);
        ctx.strokeStyle = '#E9EDF5';
        ctx.lineWidth = 32;
        ctx.stroke();
        return;
      }

      let start = -Math.PI / 2;
      data.forEach((c, i) => {
        const angle = (c.submitted / totalSum) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, start, start + angle);
        ctx.closePath();
        ctx.fillStyle = COLORS[i % COLORS.length];
        ctx.fill();
        start += angle;
      });

      // 中心白圆做环形效果
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      // 中心文字
      ctx.fillStyle = '#1A2233';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(totalSum + ' 人', cx, cy);
    });
  },

  remindOne(e) {
    const name = e.currentTarget.dataset.name;
    wx.showToast({
      title: '已向 ' + name + ' 发送催办提醒（站内演示）',
      icon: 'none',
      duration: 2000
    });
  },

  onExport() {
    const order = store.getOrder(this.currentOrderId);
    const stats = this.data.stats;
    if (!order || !stats) return;
    const subMap = store.getSubmissions()[this.currentOrderId] || {};
    const text = csvUtil.buildOrderCsv(order, stats, subMap);
    csvUtil.copyToClipboard(text);
  },

  // 导出 Excel 文件（.xlsx，两个工作表：征订明细 + 统计汇总）
  // 真机优先调起微信转发（可直接发给文件传输助手/同事），失败回退到文档预览
  onExportExcel() {
    const order = store.getOrder(this.currentOrderId);
    const stats = this.data.stats;
    if (!order || !stats) return;
    const subMap = store.getSubmissions()[this.currentOrderId] || {};
    let buf;
    try {
      const sheets = csvUtil.buildOrderWorkbookSheets(order, stats, subMap);
      buf = xlsx.makeWorkbookSheets(sheets);
    } catch (e) {
      wx.showToast({ title: '生成失败：' + e.message, icon: 'none' });
      return;
    }
    const safeTitle = order.title.replace(/[\\/:*?"<>|]/g, '-');
    const path = wx.env.USER_DATA_PATH + '/' + safeTitle + '.xlsx';
    try {
      wx.getFileSystemManager().writeFileSync(path, buf, 'binary');
    } catch (e) {
      wx.showToast({ title: '文件写入失败：' + e.message, icon: 'none', duration: 3000 });
      return;
    }
    wx.showLoading({ title: '已生成，准备发送…' });
    wx.shareFileMessage({
      filePath: path,
      fileName: safeTitle + '.xlsx',
      success() {
        wx.hideLoading();
        wx.showToast({ title: '已发出，可在聊天中打开', icon: 'none', duration: 2500 });
      },
      fail() {
        wx.hideLoading();
        // 模拟器/不支持转发场景：回退为文档预览（预览页右上角菜单也可转发）
        wx.openDocument({
          filePath: path,
          fileType: 'xlsx',
          showMenu: true,
          fail() {
            wx.showToast({ title: '已生成：' + path, icon: 'none', duration: 3000 });
          }
        });
      }
    });
  }
});
