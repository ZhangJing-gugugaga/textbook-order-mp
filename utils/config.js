/**
 * 环境与常量单点配置
 *
 * 切环境只改本文件的 baseUrl：
 *   本地联调   http://localhost:8080/api   （后端 ./mvnw spring-boot:run，开发者工具关闭域名校验）
 *   试运行/移交 https://<域名>/api          （需已备案 + HTTPS + 微信后台合法域名）
 *
 * 依据：docs/08-小程序端升级计划.md §3.2 / §4.3-G3
 */
module.exports = {
  baseUrl: 'http://localhost:8080/api',
  timeout: 15000,

  // 非 admin 可读配置端点不存在（§4.3-G3），以下为与后端一致的默认值
  POPUP_QUEUE_MAX: 5, // notice.popup_queue_max 默认值：弹窗队列保留最新 5 条
  STUDENT_QTY_MAX: 9, // 学生数量步进上限（服务端为 min(9, 班级人数)）

  // 学生数量不做上限预校验（接口不返回班级人数，§5.3 / MP4），仅按 1–9 步进
  TEACHER_QTY_MIN: 1, // 教师明细仅校验 ≥1（上限 = 班级人数，回退 999，§5.4.2 / N7）

  // 窗口状态轮询间隔（首页 60s，§5.2）
  WINDOW_POLL_MS: 60000,

  // 会话存储键
  STORAGE_KEYS: {
    auth: 'tx_auth',
    me: 'tx_me',
    deviceId: 'tx_device_id',
    subscribeResult: 'tx_subscribe_result',
  },

  // MVP 遗留业务键前缀：首启迁移时清空（§3.5-4）
  LEGACY_KEYS: ['tx_session', 'tx_seeded_v1', 'tx_students', 'tx_books', 'tx_tasks', 'tx_subs', 'tx_messages'],

  // access token 提前刷新阈值（秒）：剩余不足该值时主动 refresh
  REFRESH_AHEAD_SECONDS: 60,
};
