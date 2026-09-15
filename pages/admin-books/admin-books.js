const store = require('../../utils/store');

const DEMO_IMPORT =
  '大学英语（综合教程4）|第四版|李荫华|上海外语教育出版社|56|大学英语|刘丽|CST2401,CST2402,SE2401,EN2401,BM2401|是\n' +
  '软件工程导论|第6版|张海藩|清华大学出版社|49.5|软件工程|王建国|SE2401|是';

Page({
  data: {
    keyword: '',
    books: [],
    showAdd: false,
    showImport: false,
    importText: '',
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
    // 班级下拉数据（带标签）
    const classes = store.getClasses().map((c) => {
      const info = store.getClassFull(c.id);
      return { id: c.id, label: info.majorName + info.className };
    });
    this.setData({ allClasses: classes });
    this.loadBooks();
  },

  loadBooks() {
    const kw = this.data.keyword.trim();
    const classes = store.getClasses();
    const majors = store.getMajors();
    let books = store.getBooks().map((b) => {
      // 适用班级显示为「专业+班名」
      const names = (b.classIds || []).map((cid) => {
        const cls = classes.find((x) => x.id === cid);
        if (!cls) return cid;
        const m = majors.find((x) => x.id === cls.majorId);
        return (m ? m.name : '') + cls.name;
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
  openImport() { this.setData({ showImport: true }); },
  closeImport() { this.setData({ showImport: false }); },
  onImportInput(e) { this.setData({ importText: e.detail.value }); },
  fillDemo() { this.setData({ importText: DEMO_IMPORT }); },

  doImport() {
    const text = this.data.importText.trim();
    if (!text) { wx.showToast({ title: '请先粘贴或填入示例', icon: 'none' }); return; }
    const added = store.importBooks(text);
    if (added.length === 0) {
      wx.showToast({ title: '未解析到有效数据，请检查格式', icon: 'none', duration: 2500 });
      return;
    }
    this.setData({ showImport: false, importText: '' });
    this.loadBooks();
    wx.showToast({ title: '成功导入 ' + added.length + ' 本', icon: 'success' });
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
