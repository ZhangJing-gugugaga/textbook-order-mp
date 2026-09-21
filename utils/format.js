/**
 * 格式化与倒计时工具（抽取自 MVP store.js 的 formatDate/formatTime）
 *
 * 依据：docs/08-小程序端升级计划.md §3.1 + API.md §5.10
 *
 * 两个必须处理的坑：
 *   1) 服务端时间出参是 ISO-8601 本地时间，可能带 6–7 位小数秒（2026-09-21T15:01:11.324253）。
 *      iOS 的 Date 解析只接受 ≤3 位小数秒，直接 new Date(str) 会得到 Invalid Date → 必须手工解析。
 *   2) 倒计时一律以服务端 serverTime 为锚点求差，不信本地时钟（§5.7 / PRD 功能 2）：
 *      记录「拉取时刻的 serverTime」与「本地单调时钟」，之后用本地流逝量做增量，绝对锚点仍来自服务端。
 */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?/;

/** 解析服务端时间字符串（兼容 6–7 位小数秒与空格分隔），失败返回 null */
function parseServerTime(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value);

  const m = String(value).match(ISO_RE);
  if (!m) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  const millis = m[7] ? Number((m[7] + '000').slice(0, 3)) : 0;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
    millis,
  );
}

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 2026-09-21 15:01 */
function formatDateTime(value) {
  const d = parseServerTime(value);
  if (!d) return '—';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 2026-09-21 */
function formatDate(value) {
  const d = parseServerTime(value);
  if (!d) return '—';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 15:01 */
function formatTime(value) {
  const d = parseServerTime(value);
  if (!d) return '—';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 金额：42 → '42.00' */
function money(value) {
  const n = Number(value);
  if (!isFinite(n)) return '0.00';
  return n.toFixed(2);
}

/** 金额带符号：42 → '¥42.00' */
function price(value) {
  return `¥${money(value)}`;
}

/** 数量/品种合计 */
function sumBy(list, key) {
  return (list || []).reduce((acc, item) => acc + Number(item[key] || 0), 0);
}

/** 剩余毫秒 → 'X 天 X 时 X 分' / 'X 时 X 分' / 'X 分' */
function countdownText(remainingMs) {
  if (remainingMs == null || !isFinite(remainingMs) || remainingMs <= 0) return '';
  const totalMinutes = Math.floor(remainingMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} 天 ${hours} 时 ${minutes} 分`;
  if (hours > 0) return `${hours} 时 ${minutes} 分`;
  return `${minutes} 分`;
}

/**
 * 以服务端时间为锚点的倒计时。
 *   const cd = createCountdown(status.windowEnd, status.serverTime);
 *   cd.remaining() // 剩余毫秒（随时间递减，不受本地时钟绝对值影响）
 */
function createCountdown(targetIso, serverTimeIso) {
  const target = parseServerTime(targetIso);
  const serverNow = parseServerTime(serverTimeIso);
  const localAt = Date.now();

  function remaining() {
    if (!target || !serverNow) return null;
    const elapsed = Date.now() - localAt; // 本地流逝量（增量可信，绝对值不可信）
    return target.getTime() - (serverNow.getTime() + elapsed);
  }

  return {
    valid: !!(target && serverNow),
    target: target,
    remaining: remaining,
    expired: () => {
      const r = remaining();
      return r != null && r <= 0;
    },
    text: () => countdownText(remaining()),
  };
}

/** 时长友好文案：'2 天' / '3 时' / '5 分'（用于补正截止提示） */
function durationText(remainingMs) {
  if (remainingMs == null || !isFinite(remainingMs) || remainingMs <= 0) return '';
  const totalMinutes = Math.floor(remainingMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  if (days > 0) return `${days} 天`;
  if (hours > 0) return `${hours} 时`;
  return `${totalMinutes} 分`;
}

module.exports = {
  parseServerTime,
  formatDateTime,
  formatDate,
  formatTime,
  money,
  price,
  sumBy,
  countdownText,
  durationText,
  createCountdown,
};
