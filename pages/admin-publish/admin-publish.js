const store = require('../../utils/store');

Page({
  data: {
    title: '',
    deadline: '',
    today: '',
    classGroups: [],
    pickedClassCount: 0,
    bookOptions: [],
    pickedBookCount: 0
  },

  pickedClasses: {},
  pickedBooks: {},

  onLoad() {
    const session = store.getSession();
    if (!session || session.role !== 'admin') {
      wx.showToast({ title: '仅教材管理员可操作', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const today = store.formatDate(new Date());
    this.setData({ today });
    this.buildClassGroups();
    this.buildBookOptions();
  },

  buildClassGroups() {
    const colleges = store.getColleges();
    const majors = store.getMajors();
    const classes = store.getClasses();
    const groups = colleges.map((col) => ({
      collegeId: col.id,
      collegeName: col.name,
      classes: classes
        .filter((c) => {
          const m = majors.find((x) => x.id === c.majorId);
          return m && m.collegeId === col.id;
        })
        .map((c) => {
          const m = majors.find((x) => x.id === c.majorId);
          return {
            id: c.id,
            name: (c.grade || '') + '级' + (c.name || ''),
            majorName: m.name,
            picked: !!this.pickedClasses[c.id]
          };
        })
    }));
    this.setData({ classGroups: groups, pickedClassCount: Object.keys(this.pickedClasses).length });
  },

  buildBookOptions() {
    const options = store.getBooks().map((b) => ({
      id: b.id,
      title: b.title,
      course: b.course,
      price: b.price,
      classCount: (b.classIds || []).length,
      picked: !!this.pickedBooks[b.id]
    }));
    this.setData({ bookOptions: options, pickedBookCount: Object.keys(this.pickedBooks).length });
  },

  onTitleInput(e) { this.setData({ title: e.detail.value }); },
  onDeadlineChange(e) { this.setData({ deadline: e.detail.value }); },

  toggleClass(e) {
    const id = e.currentTarget.dataset.id;
    if (this.pickedClasses[id]) delete this.pickedClasses[id];
    else this.pickedClasses[id] = true;
    this.buildClassGroups();
  },

  toggleBook(e) {
    const id = e.currentTarget.dataset.id;
    if (this.pickedBooks[id]) delete this.pickedBooks[id];
    else this.pickedBooks[id] = true;
    this.buildBookOptions();
  },

  onPublish() {
    const { title, deadline } = this.data;
    const classIds = Object.keys(this.pickedClasses);
    const bookIds = Object.keys(this.pickedBooks);
    if (!title.trim()) { wx.showToast({ title: '请填写任务名称', icon: 'none' }); return; }
    if (!deadline) { wx.showToast({ title: '请选择截止日期', icon: 'none' }); return; }
    if (classIds.length === 0) { wx.showToast({ title: '请选择征订班级', icon: 'none' }); return; }
    if (bookIds.length === 0) { wx.showToast({ title: '请勾选征订教材', icon: 'none' }); return; }

    const session = store.getSession();
    store.publishOrder({
      title: title.trim(),
      deadline,
      creatorId: session.id,
      scopeClassIds: classIds,
      bookIds
    });
    wx.showToast({ title: '发布成功', icon: 'success' });
    setTimeout(() => {
      wx.switchTab({ url: '/pages/home/home' });
    }, 600);
  }
});
