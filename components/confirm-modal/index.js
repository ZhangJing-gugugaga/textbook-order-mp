/**
 * 自绘居中确认弹层（§6 交互纪律：统一自绘 Modal，禁用 wx.showModal 承载明细表）
 *
 * 用法：
 *   <confirm-modal show="{{confirmShow}}" title="提交确认" note="价格和版本以最终出版单位供应为准"
 *                  confirm-text="确认提交" bind:confirm="onConfirm" bind:cancel="onCancel">
 *     <view>自定义明细内容</view>
 *   </confirm-modal>
 *
 * 遮罩用 catchtap 阻止穿透（MVP 已修 P1 级问题，保留该修复）。
 */
Component({
  options: {
    multipleSlots: false,
  },
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '确认' },
    note: { type: String, value: '' },
    confirmText: { type: String, value: '确认' },
    cancelText: { type: String, value: '取消' },
    confirmDisabled: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
  },
  methods: {
    noop() {},
    onConfirm() {
      if (this.data.confirmDisabled || this.data.loading) return;
      this.triggerEvent('confirm');
    },
    onCancel() {
      if (this.data.loading) return;
      this.triggerEvent('cancel');
    },
  },
});
