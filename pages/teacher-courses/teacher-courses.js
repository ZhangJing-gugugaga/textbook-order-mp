const auth = require('../../utils/auth');
const api = require('../../utils/api');

const app = getApp();

/**
 * 我的课程（§5.4.1）
 * 数据：GET /api/teacher/my-courses → 已按班级分组，直接渲染「班级 → 课程」两级列表
 * 空态：暂无任课关系，请联系教材室导入（征订范围 = 已导入的 teacher_course）
 * 点课程 → 进入填报页并定位该 课程×班级 行
 */
Page({
  data: {
    loaded: false,
    error: '',
    groups: [],
    classCount: 0,
    courseCount: 0,
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
    return api.teacher.myCourses().then(
      (groups) => {
        const list = Array.isArray(groups) ? groups : [];
        const courseCount = list.reduce((acc, g) => acc + ((g.courses || []).length), 0);
        this.setData({
          loaded: true,
          groups: list,
          classCount: list.length,
          courseCount: courseCount,
        });
      },
      (err) => {
        this.setData({ loaded: true, error: err.message || '课程加载失败' });
      },
    );
  },

  /** 点课程 → 填报页并定位该 课程×班级 行 */
  goForm(e) {
    const { courseId, classId } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/teacher-order-form/teacher-order-form?courseId=${courseId}&classId=${classId}`,
    });
  },

  goRecords() {
    wx.navigateTo({ url: '/pages/teacher-records/teacher-records' });
  },

  onRetry() {
    this.load();
  },

  /** 阻塞弹窗队列确认完（可在此刷新页面数据） */
  onNoticeCleared() {},
});
