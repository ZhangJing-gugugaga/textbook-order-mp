const store = require('../../utils/store');

Page({
  data: {
    messages: []
  },

  onShow() {
    if (!store.getSession()) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    this.setData({ messages: store.getMessages() });
  }
});
