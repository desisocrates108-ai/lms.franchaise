import React from "react";
import { Button } from "./ui/button";

/**
 * Global ErrorBoundary so unexpected render errors don't blank the page.
 * Renders a friendly fallback with a "Reload" action and shows the error
 * details in dev mode for debugging.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Servall</div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">
            A page-level error occurred. Your data is safe — try reloading.
          </p>
          {process.env.NODE_ENV !== "production" && this.state.error && (
            <pre className="text-[11px] text-left bg-muted/40 p-3 rounded border border-border overflow-auto max-h-48">
              {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
            </pre>
          )}
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={this.reset}>Try again</Button>
            <Button onClick={() => window.location.reload()}>Reload page</Button>
          </div>
        </div>
      </div>
    );
  }
}
