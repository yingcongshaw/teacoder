import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, color: "#e0e0e0", background: "#1e2229", minHeight: "100vh" }}>
          <h2 style={{ color: "#ff4d4f" }}>渲染错误</h2>
          <pre style={{ fontSize: 12, color: "#cccccc", whiteSpace: "pre-wrap" }}>
            {this.state.error?.message}
          </pre>
          <pre style={{ fontSize: 11, color: "#888888", whiteSpace: "pre-wrap" }}>
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: 16, padding: "8px 16px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
