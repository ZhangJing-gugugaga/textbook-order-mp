const store = require('../../utils/store');
const xlsx = require('../../utils/xlsx-lite.js');

const DEMO_IMPORT =
  '大学英语（综合教程4）|第四版|李荫华|上海外语教育出版社|56|大学英语|刘丽|CST2401,CST2402,SE2401,EN2401,BM2401|是\n' +
  '软件工程导论|第6版|张海藩|清华大学出版社|49.5|软件工程|王建国|SE2401|是';

// 教材导入模板（表头 + 示例行）
const TEMPLATE_ROWS = [
  ['书名', 'ISBN', '版次', '作者', '出版社', '单价', '课程名', '选用教师', '适用班级ID', '必修'],
  ['高等数学（上册）', '9787040396614', '第七版', '同济大学数学系', '高等教育出版社', 45, '高等数学', '张伟', 'CST2401,CST2402', '是'],
  ['数据结构（C语言版）', '9787302214048', '第2版', '严蔚敏', '清华大学出版社', 39, '数据结构', '李强', 'CST2401', '是']
];

Page({
  data: {
    keyword: '',
    books: [],
    showAdd: false,
    showImport: false,
    pasteMode: false,
    parsing: false,
    importText: '',
    importResult: null,
    form: { title: '', edition: '', author: '', press: '', price: '', course: '', teacher: '', required: true, classIds: [] },
    allClasses: []
  },

  onShow() {
    const session = store.getSession();
    if (!session || session.role !== 'admin') {
      wx.showToast({ title: '仅教材管理员可操作', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    // 班级下拉数据（className 已组合「专业+年级+班号」）
    const classes = store.getClasses().map((c) => {
      const info = store.getClassFull(c.id);
      return { id: c.id, label: info.className };
    });
    this.setData({ allClasses: classes });
    this.loadBooks();
  },

  loadBooks() {
    const kw = this.data.keyword.trim();
    let books = store.getBooks().map((b) => {
      // 适用班级显示为完整班级名（专业+年级+班号）
      const names = (b.classIds || []).map((cid) => {
        const info = store.getClassFull(cid);
        return info ? info.className : cid;
      });
      return Object.assign({}, b, { classNames: names.length ? names.join('、') : '未指定' });
    });
    if (kw) {
      books = books.filter(
        (b) =>
          b.title.indexOf(kw) >= 0 ||
          (b.course || '').indexOf(kw) >= 0 ||
          (b.teacher || '').indexOf(kw) >= 0
      );
    }
    this.setData({ books });
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value });
    this.loadBooks();
  },

  // ---------- 空处理器：阻止弹层内容点击冒泡关闭（catchtap="noop"） ----------
  noop() {},

  // ---------- 手动添加 ----------
  openAdd() { this.setData({ showAdd: true }); },
  closeAdd() { this.setData({ showAdd: false }); },

  onFormInput(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ ['form.' + k]: e.detail.value });
  },
  onFormSwitch(e) {
    this.setData({ 'form.required': e.detail.value });
  },
  toggleFormClass(e) {
    const id = e.currentTarget.dataset.id;
    const ids = this.data.form.classIds.slice();
    const i = ids.indexOf(id);
    if (i >= 0) ids.splice(i, 1);
    else ids.push(id);
    this.setData({ 'form.classIds': ids });
  },

  saveAdd() {
    const f = this.data.form;
    const price = parseFloat(f.price);
    if (!f.title.trim()) { wx.showToast({ title: '请填写书名', icon: 'none' }); return; }
    if (isNaN(price)) { wx.showToast({ title: '请填写正确单价', icon: 'none' }); return; }
    store.addBook({
      title: f.title.trim(),
      edition: f.edition || '第1版',
      author: f.author || '',
      press: f.press || '',
      price,
      course: f.course || '',
      teacher: f.teacher || '',
      classIds: f.classIds.slice(),
      required: f.required
    });
    this.setData({ showAdd: false, form: { title: '', edition: '', author: '', press: '', price: '', course: '', teacher: '', required: true, classIds: [] } });
    this.loadBooks();
    wx.showToast({ title: '已添加', icon: 'success' });
  },

  // ---------- 批量导入 ----------
  openImport() { this.setData({ showImport: true, pasteMode: false, importResult: null }); },
  closeImport() { this.setData({ showImport: false }); },
  togglePaste() { this.setData({ pasteMode: !this.data.pasteMode }); },
  onImportInput(e) { this.setData({ importText: e.detail.value }); },
  fillDemo() { this.setData({ importText: DEMO_IMPORT }); },

  // Excel 文件导入（主入口）
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
          const result = store.importBooksFromRows(wb.rows);
          this.setData({ parsing: false, importResult: result });
          this.loadBooks();
          if (result.added.length > 0) {
            wx.showToast({ title: '成功导入 ' + result.added.length + ' 本', icon: 'success' });
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

  // 生成并打开教材导入模板
  downloadTemplate() {
    try {
      const buf = xlsx.makeWorkbook(TEMPLATE_ROWS, '教材导入模板');
      const path = wx.env.USER_DATA_PATH + '/book-template.xlsx';
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
    if (!text) { wx.showToast({ title: '请先粘贴或填入示例', icon: 'none' }); return; }
    const result = store.importBooks(text);
    if (result.added.length === 0 && result.errors.length === 0) {
      wx.showToast({ title: '未解析到有效数据，请检查格式', icon: 'none', duration: 2500 });
      return;
    }
    // 保留弹层展示结果（成功条数 + 校验失败原因），与文件导入行为一致
    this.setData({ importResult: result, importText: '' });
    this.loadBooks();
    if (result.added.length > 0) {
      wx.showToast({ title: '成功导入 ' + result.added.length + ' 本', icon: 'success' });
    }
  },

  onDelete(e) {
    const { id, title } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除教材',
      content: '确定删除《' + title + '》吗？',
      confirmColor: '#DC2626',
      success: (res) => {
        if (res.confirm) {
          store.deleteBook(id);
          this.loadBooks();
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  }
});
