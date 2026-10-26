import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[flowforge] render error", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center p-8">
          <div className="ff-card max-w-xl p-6">
            <div className="ff-kicker text-[#f0a58f]">Runtime Error</div>
            <h1 className="ff-display mt-2 text-2xl text-paper">界面渲染失败</h1>
            <p className="mt-2 text-[12px] leading-6 text-forge-400">
              已捕获未处理异常，避免整页白屏。请刷新页面；若重复出现，请查看开发者控制台。
            </p>
            <pre className="mt-3 max-h-[160px] overflow-auto border border-forge-700 bg-forge-950 p-2 font-mono text-[10px] text-[#f0a58f]">
              {this.state.error.message}
            </pre>
            <button
              className="ff-btn ff-btn-primary mt-4"
              onClick={() => window.location.reload()}
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
