const store = require('../../utils/store');

Page({
  data: {
    id: '',
    name: '',
    error: '',
    loading: false
  },

  onIdInput(e) { this.setData({ id: e.detail.value }); },
  onNameInput(e) { this.setData({ name: e.detail.value }); },

  fillStudent() { this.setData({ id: '20240101', name: '张敬', error: '' }); },
  fillAdmin() { this.setData({ id: 'T0001', name: '王教材', error: '' }); },

  onLogin() {
    const { id, name } = this.data;
    if (!id.trim() || !name.trim()) {
      this.setData({ error: '请填写学号/工号和姓名' });
      return;
    }
    this.setData({ loading: true });
    // mock 校验，模拟网络延迟
    setTimeout(() => {
      const session = store.login(id, name);
      this.setData({ loading: false });
      if (!session) {
        this.setData({ error: '未匹配到学籍信息，请核对学号与姓名（仅限在册师生）' });
        return;
      }
      wx.switchTab({ url: '/pages/home/home' });
    }, 300);
  }
});
