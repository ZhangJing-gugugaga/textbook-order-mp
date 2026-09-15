const store = require('../../utils/store');
const xlsx = require('../../utils/xlsx-lite.js');

const DEMO_IMPORT =
  '20240901|王小明|计算机科学与工程学院|计算机科学与技术|2024级1班\n' +
  '20240902|李小红|外国语学院|英语|2024级1班\n' +
  '20240903|陈小刚|经济管理学院|工商管理|2024级1班';

// 学生导入模板（表头 + 示例行）
const TEMPLATE_ROWS = [
  ['学号', '姓名', '学院名称', '专业名称', '班级全称'],
  ['20240901', '王小明', '计算机科学与工程学院', '计算机科学与技术', '2024级1班'],
  ['20240902', '李小红', '外国语学院', '英语', '2024级1班']
];

Page({
  data: {
    keyword: '',
    students: [],
    showAdd: false,
    showImport: false,
    pasteMode: false,
    parsing: false,
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

  // ---------- 空处理器：阻止弹层内容点击冒泡关闭（catchtap="noop"） ----------
  noop() {},

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

  // Excel 文件导入（主入口）：从微信会话选择 xlsx → 解析 → 按行导入
  chooseExcel() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        this.setData({ parsing: true });
        try {
          const fs = wx.getFileSystemManager();
          const buf = fs.readFileSync(file.path);
          const wb = xlsx.readWorkbook(buf);
          const result = store.importStudentsFromRows(wb.rows);
          this.setData({ parsing: false, importResult: result });
          this.loadStudents();
          if (result.added.length > 0) {
            wx.showToast({ title: '导入 ' + result.added.length + ' 人', icon: 'success' });
          } else {
            wx.showToast({ title: '未导入有效数据，请查看校验结果', icon: 'none', duration: 2500 });
          }
        } catch (e) {
          this.setData({ parsing: false });
          wx.showToast({ title: '解析失败：' + e.message, icon: 'none', duration: 3000 });
        }
      }
    });
  },

  // 生成并打开导入模板（xlsx），打开后可通过右上角菜单转发到电脑
  downloadTemplate() {
    try {
      const buf = xlsx.makeWorkbook(TEMPLATE_ROWS, '学生导入模板');
      const path = wx.env.USER_DATA_PATH + '/student-template.xlsx';
      const fs = wx.getFileSystemManager();
      fs.writeFileSync(path, buf, 'binary');
      wx.openDocument({
        filePath: path,
        fileType: 'xlsx',
        showMenu: true,
        fail() {
          wx.showToast({ title: '模板已生成：' + path, icon: 'none', duration: 3000 });
        }
      });
      wx.showToast({ title: '模板已生成，可转发到电脑', icon: 'none', duration: 2500 });
    } catch (e) {
      wx.showToast({ title: '生成失败：' + e.message, icon: 'none' });
    }
  },

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
