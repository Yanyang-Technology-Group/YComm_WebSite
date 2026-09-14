/**
 * 全站路由级加载动画：页面（服务端组件）加载期间显示「图标 + 蓝色旋转圆环」，
 * 避免切页时白屏/卡住无反馈。
 */
export default function Loading() {
  return (
    <div className="loading-center">
      <div className="loading-ring">
        <img src="/logo.png" alt="" className="loading-icon" />
      </div>
      <p className="muted" style={{ margin: 0 }}>
        正在加载…
      </p>
    </div>
  );
}