const store = require('./utils/store');

App({
  onLaunch() {
    // 首次启动注入 mock 种子数据
    store.init();
  },
  globalData: {}
});
