const store = require('../../utils/store');

const DEMO_IMPORT =
  '20240901|王小明|计算机科学与工程学院|计算机科学与技术|2024级1班\n' +
  '20240902|李小红|外国语学院|英语|2024级1班\n' +
  '20240903|陈小刚|经济管理学院|工商管理|2024级1班';

Page({
  data: {
    keyword: '',
    students: [],
    showAdd: false,
    showImport: false,
    importText: '',
    importResult: null,
    form: { id: '', name: '', classId: '' },
    allClasses: []
  },

  onShow() {
    const session = store.getSession();
    if (!session || session.role !== 'admin') {
      wx.showToast({ title: '仅教材管理员可操作', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.setData({
      allClasses: store.getClasses().map((c) => {
        const info = store.getClassFull(c.id);
        return { id: c.id, label: info.className };
      })
    });
    this.loadStudents();
  },

  loadStudents() {
    const kw = this.data.keyword.trim();
    let list = store.getStudents().map((u) => {
      const info = u.classId ? store.getClassFull(u.classId) : null;
      return {
        id: u.id,
        name: u.name,
        className: info ? info.className : '未分班',
        collegeName: info ? info.collegeName : '-'
      };
    });
    if (kw) {
      list = list.filter(
        (s) =>
          s.id.indexOf(kw) >= 0 ||
          s.name.indexOf(kw) >= 0 ||
          s.className.indexOf(kw) >= 0
      );
    }
    this.setData({ students: list });
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value });
    this.loadStudents();
  },

  // ---------- 手动添加 ----------
  openAdd() { this.setData({ showAdd: true, importResult: null }); },
  closeAdd() { this.setData({ showAdd: false }); },
  onFormInput(e) {
    this.setData({ ['form.' + e.currentTarget.dataset.k]: e.detail.value });
  },
  pickClass(e) {
    this.setData({ 'form.classId': e.currentTarget.dataset.id });
  },
  saveAdd() {
    const f = this.data.form;
    if (!f.id.trim() || !f.name.trim()) {
      wx.showToast({ title: '请填写学号和姓名', icon: 'none' });
      return;
    }
    if (!f.classId) {
      wx.showToast({ title: '请选择班级', icon: 'none' });
      return;
    }
    const ok = store.addStudent(f.id.trim(), f.name.trim(), f.classId);
    if (!ok) {
      wx.showToast({ title: '学号已存在', icon: 'none' });
      return;
    }
    this.setData({ showAdd: false, form: { id: '', name: '', classId: '' } });
    this.loadStudents();
    wx.showToast({ title: '已添加', icon: 'success' });
  },

  // ---------- 批量导入 ----------
  openImport() { this.setData({ showImport: true, importResult: null }); },
  closeImport() { this.setData({ showImport: false }); },
  onImportInput(e) { this.setData({ importText: e.detail.value }); },
  fillDemo() { this.setData({ importText: DEMO_IMPORT }); },

  doImport() {
    const text = this.data.importText.trim();
    if (!text) {
      wx.showToast({ title: '请先粘贴或填入示例', icon: 'none' });
      return;
    }
    const result = store.importStudents(text);
    this.setData({ importResult: result });
    this.loadStudents();
    if (result.added.length > 0) {
      wx.showToast({ title: '导入 ' + result.added.length + ' 人', icon: 'success' });
    }
  },

  onDelete(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除学生',
      content: '确定删除 ' + name + '（' + id + '）吗？',
      confirmColor: '#DC2626',
      success: (res) => {
        if (res.confirm) {
          store.deleteStudent(id);
          this.loadStudents();
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  }
});
