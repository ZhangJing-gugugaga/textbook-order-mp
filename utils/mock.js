// ============ Mock 种子数据（演示用，后续接后端时整体替换） ============
// 学号规则：2024 + 4位序号；教师工号：T + 4位

const COLLEGES = [
  { id: 'CS', name: '计算机科学与工程学院' },
  { id: 'FL', name: '外国语学院' },
  { id: 'EM', name: '经济管理学院' }
];

const MAJORS = [
  { id: 'CST', collegeId: 'CS', name: '计算机科学与技术' },
  { id: 'SE', collegeId: 'CS', name: '软件工程' },
  { id: 'EN', collegeId: 'FL', name: '英语' },
  { id: 'BM', collegeId: 'EM', name: '工商管理' }
];

const CLASSES = [
  { id: 'CST2401', majorId: 'CST', name: '2024级1班' },
  { id: 'CST2402', majorId: 'CST', name: '2024级2班' },
  { id: 'SE2401', majorId: 'SE', name: '2024级1班' },
  { id: 'EN2401', majorId: 'EN', name: '2024级1班' },
  { id: 'BM2401', majorId: 'BM', name: '2024级1班' }
];

// 用户名单：登录时按 id + name 严格匹配
const USERS = [
  // ---- 管理员（教材管理员，演示账号）----
  { id: 'T0001', name: '王教材', role: 'admin', collegeId: 'CS' },
  { id: 'T0002', name: '李管理员', role: 'admin', collegeId: 'CS' },
  // ---- 计算机 2024级1班（演示主角班）----
  { id: '20240101', name: '张敬', role: 'student', classId: 'CST2401' },
  { id: '20240102', name: '陈晓明', role: 'student', classId: 'CST2401' },
  { id: '20240103', name: '刘雨欣', role: 'student', classId: 'CST2401' },
  { id: '20240104', name: '王浩然', role: 'student', classId: 'CST2401' },
  { id: '20240105', name: '赵婷婷', role: 'student', classId: 'CST2401' },
  { id: '20240106', name: '孙宇轩', role: 'student', classId: 'CST2401' },
  // ---- 计算机 2024级2班 ----
  { id: '20240201', name: '周子墨', role: 'student', classId: 'CST2402' },
  { id: '20240202', name: '吴佳琪', role: 'student', classId: 'CST2402' },
  { id: '20240203', name: '郑凯文', role: 'student', classId: 'CST2402' },
  { id: '20240204', name: '冯思远', role: 'student', classId: 'CST2402' },
  { id: '20240205', name: '许诺', role: 'student', classId: 'CST2402' },
  { id: '20240206', name: '何雨桐', role: 'student', classId: 'CST2402' },
  // ---- 软工 2024级1班 ----
  { id: '20240301', name: '林一鸣', role: 'student', classId: 'SE2401' },
  { id: '20240302', name: '黄诗涵', role: 'student', classId: 'SE2401' },
  { id: '20240303', name: '徐志远', role: 'student', classId: 'SE2401' },
  { id: '20240304', name: '马晓东', role: 'student', classId: 'SE2401' },
  { id: '20240305', name: '曹雨薇', role: 'student', classId: 'SE2401' },
  // ---- 英语 2024级1班 ----
  { id: '20240401', name: '宋雅静', role: 'student', classId: 'EN2401' },
  { id: '20240402', name: '唐俊杰', role: 'student', classId: 'EN2401' },
  { id: '20240403', name: '韩梦洁', role: 'student', classId: 'EN2401' },
  { id: '20240404', name: '邓子豪', role: 'student', classId: 'EN2401' },
  { id: '20240405', name: '肖诗雨', role: 'student', classId: 'EN2401' },
  // ---- 工商管理 2024级1班 ----
  { id: '20240501', name: '程嘉怡', role: 'student', classId: 'BM2401' },
  { id: '20240502', name: '罗天佑', role: 'student', classId: 'BM2401' },
  { id: '20240503', name: '梁静怡', role: 'student', classId: 'BM2401' },
  { id: '20240504', name: '高梓萱', role: 'student', classId: 'BM2401' }
];

// 教材库：classIds 为适用班级
const BOOKS = [
  { id: 'B001', title: '高等数学（上册）', edition: '第七版', author: '同济大学数学系', press: '高等教育出版社', price: 45.0, course: '高等数学', teacher: '张伟', classIds: ['CST2401', 'CST2402', 'SE2401'], required: true },
  { id: 'B002', title: '数据结构（C语言版）', edition: '第2版', author: '严蔚敏 李冬梅', press: '清华大学出版社', price: 39.0, course: '数据结构', teacher: '李强', classIds: ['CST2401', 'CST2402'], required: true },
  { id: 'B003', title: '计算机科学导论', edition: '第4版', author: '贝赫鲁兹·佛罗赞', press: '机械工业出版社', price: 79.0, course: '专业导论', teacher: '李强', classIds: ['CST2401', 'CST2402', 'SE2401'], required: true },
  { id: 'B004', title: '线性代数', edition: '第六版', author: '同济大学数学系', press: '高等教育出版社', price: 36.0, course: '线性代数', teacher: '陈红', classIds: ['CST2401', 'CST2402', 'SE2401'], required: true },
  { id: 'B005', title: 'C语言程序设计', edition: '第五版', author: '谭浩强', press: '清华大学出版社', price: 36.0, course: '程序设计基础', teacher: '王建国', classIds: ['CST2401', 'CST2402', 'SE2401'], required: false },
  { id: 'B006', title: '大学英语（综合教程3）', edition: '第三版', author: '李荫华', press: '上海外语教育出版社', price: 52.0, course: '大学英语', teacher: '刘丽', classIds: ['CST2401', 'CST2402', 'SE2401', 'EN2401', 'BM2401'], required: true },
  { id: 'B007', title: '英语语音学教程', edition: '第2版', author: '张冠林', press: '外语教学与研究出版社', price: 29.9, course: '英语语音', teacher: '刘丽', classIds: ['EN2401'], required: true },
  { id: 'B008', title: '英汉翻译教程', edition: '第3版', author: '张培基', press: '上海外语教育出版社', price: 42.0, course: '翻译理论与实践', teacher: '赵敏', classIds: ['EN2401'], required: false },
  { id: 'B009', title: '管理学原理', edition: '第8版', author: '斯蒂芬·罗宾斯', press: '中国人民大学出版社', price: 68.0, course: '管理学', teacher: '孙明', classIds: ['BM2401'], required: true },
  { id: 'B010', title: '微观经济学', edition: '第九版', author: '平狄克', press: '中国人民大学出版社', price: 88.0, course: '微观经济学', teacher: '孙明', classIds: ['BM2401'], required: true },
  { id: 'B011', title: '市场营销学', edition: '第7版', author: '吴健安', press: '清华大学出版社', price: 55.0, course: '市场营销', teacher: '周华', classIds: ['BM2401'], required: false },
  { id: 'B012', title: '思想道德与法治', edition: '2023年版', author: '本书编写组', press: '高等教育出版社', price: 22.0, course: '思政', teacher: '教务处', classIds: ['CST2401', 'CST2402', 'SE2401', 'EN2401', 'BM2401'], required: true }
];

// 征订任务：status open=进行中 closed=已截止
const ORDERS = [
  {
    id: 'O2025A',
    title: '2025-2026学年第一学期教材征订',
    status: 'open',
    deadline: '2026-09-30',
    createdAt: '2026-09-10',
    creatorId: 'T0001',
    scopeClassIds: ['CST2401', 'CST2402', 'SE2401', 'EN2401', 'BM2401'],
    bookIds: ['B001', 'B002', 'B003', 'B004', 'B005', 'B006', 'B007', 'B008', 'B009', 'B010', 'B011', 'B012']
  },
  {
    id: 'O2025S',
    title: '2025年春季学期补订（已截止）',
    status: 'closed',
    deadline: '2026-03-15',
    createdAt: '2026-03-01',
    creatorId: 'T0001',
    scopeClassIds: ['CST2401', 'CST2402'],
    bookIds: ['B005', 'B012']
  }
];

// 已有提交记录（让统计页一进来就有数据可看）
// 结构：{ [orderId]: { [userId]: { items: [{bookId, qty}], submittedAt } } }
const SUBMISSIONS = {
  O2025A: {
    // 计算机2401班已提交 5/6 人
    20240102: { items: [{ bookId: 'B001', qty: 1 }, { bookId: 'B002', qty: 1 }, { bookId: 'B003', qty: 1 }, { bookId: 'B004', qty: 1 }, { bookId: 'B006', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-12 10:20' },
    20240103: { items: [{ bookId: 'B001', qty: 1 }, { bookId: 'B002', qty: 1 }, { bookId: 'B003', qty: 1 }, { bookId: 'B004', qty: 1 }, { bookId: 'B005', qty: 1 }, { bookId: 'B006', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-12 11:05' },
    20240104: { items: [{ bookId: 'B001', qty: 1 }, { bookId: 'B002', qty: 1 }, { bookId: 'B003', qty: 1 }, { bookId: 'B004', qty: 1 }, { bookId: 'B006', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-13 09:40' },
    20240105: { items: [{ bookId: 'B001', qty: 1 }, { bookId: 'B002', qty: 1 }, { bookId: 'B004', qty: 1 }, { bookId: 'B006', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-13 14:22' },
    20240106: { items: [{ bookId: 'B001', qty: 1 }, { bookId: 'B002', qty: 1 }, { bookId: 'B003', qty: 1 }, { bookId: 'B006', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-14 08:15' },
    // 计算机2402班已提交 4/6 人
    20240201: { items: [{ bookId: 'B001', qty: 1 }, { bookId: 'B002', qty: 1 }, { bookId: 'B003', qty: 1 }, { bookId: 'B004', qty: 1 }, { bookId: 'B006', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-12 15:30' },
    20240202: { items: [{ bookId: 'B001', qty: 1 }, { bookId: 'B002', qty: 1 }, { bookId: 'B004', qty: 1 }, { bookId: 'B005', qty: 1 }, { bookId: 'B006', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-13 10:10' },
    20240203: { items: [{ bookId: 'B001', qty: 1 }, { bookId: 'B002', qty: 1 }, { bookId: 'B003', qty: 1 }, { bookId: 'B004', qty: 1 }, { bookId: 'B006', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-13 16:45' },
    20240204: { items: [{ bookId: 'B001', qty: 1 }, { bookId: 'B002', qty: 1 }, { bookId: 'B006', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-14 09:00' },
    // 软工2401班已提交 3/5 人
    20240301: { items: [{ bookId: 'B001', qty: 1 }, { bookId: 'B003', qty: 1 }, { bookId: 'B004', qty: 1 }, { bookId: 'B005', qty: 1 }, { bookId: 'B006', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-12 09:12' },
    20240302: { items: [{ bookId: 'B001', qty: 1 }, { bookId: 'B003', qty: 1 }, { bookId: 'B004', qty: 1 }, { bookId: 'B006', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-13 13:50' },
    20240303: { items: [{ bookId: 'B001', qty: 1 }, { bookId: 'B004', qty: 1 }, { bookId: 'B006', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-14 11:28' },
    // 英语2401班已提交 3/5 人
    20240401: { items: [{ bookId: 'B006', qty: 1 }, { bookId: 'B007', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-12 14:08' },
    20240402: { items: [{ bookId: 'B006', qty: 1 }, { bookId: 'B007', qty: 1 }, { bookId: 'B008', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-13 10:32' },
    20240403: { items: [{ bookId: 'B006', qty: 1 }, { bookId: 'B007', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-14 15:18' },
    // 工商管理2401班已提交 2/4 人
    20240501: { items: [{ bookId: 'B006', qty: 1 }, { bookId: 'B009', qty: 1 }, { bookId: 'B010', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-13 09:55' },
    20240502: { items: [{ bookId: 'B006', qty: 1 }, { bookId: 'B009', qty: 1 }, { bookId: 'B010', qty: 1 }, { bookId: 'B011', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-09-13 17:40' }
  },
  O2025S: {
    20240102: { items: [{ bookId: 'B005', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-03-05 10:00' },
    20240103: { items: [{ bookId: 'B005', qty: 1 }], submittedAt: '2026-03-06 11:00' },
    20240201: { items: [{ bookId: 'B005', qty: 1 }, { bookId: 'B012', qty: 1 }], submittedAt: '2026-03-07 09:30' }
  }
};

// 站内消息（通知推送待定，先用站内信占位）
const MESSAGES = [
  { id: 'M1', type: 'open', title: '教材征订开始了', content: '2025-2026学年第一学期教材征订已开始，请在本班教材列表中勾选并提交，截止 9 月 30 日。', time: '2026-09-10 09:00' },
  { id: 'M2', type: 'deadline', title: '征订即将截止提醒', content: '第一学期教材征订将于 9 月 30 日截止，尚未提交的同学请尽快完成勾选。', time: '2026-09-14 09:00' },
  { id: 'M3', type: 'info', title: '到书领取通知（示例）', content: '上学期补订教材已到货，请以班级为单位到教材科领取。', time: '2026-04-02 10:00' }
];

module.exports = {
  COLLEGES,
  MAJORS,
  CLASSES,
  USERS,
  BOOKS,
  ORDERS,
  SUBMISSIONS,
  MESSAGES
};
