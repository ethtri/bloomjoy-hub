import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { clearChunkReloadMarkers, isChunkLoadError } from "@/lib/lazyRoute";

type RouteErrorBoundaryProps = {
  children: ReactNode;
};

type RouteErrorBoundaryState = {
  error: unknown;
};

class RouteErrorBoundaryInner extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: unknown): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("Route render failed", error, errorInfo);
  }

  handleRefresh = () => {
    if (isChunkLoadError(this.state.error)) {
      clearChunkReloadMarkers();
    }

    window.location.reload();
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const isUpdateError = isChunkLoadError(this.state.error);
    const title = isUpdateError ? "App update required" : "Page failed to load";
    const message = isUpdateError
      ? "This tab needs the latest Bloomjoy app files. Refresh once to load the current version."
      : "Refresh the page to try this route again. If it keeps failing, capture the URL and console error.";

    return (
      <div className="container-page py-10">
        <div className="max-w-xl rounded-lg border border-border bg-background p-5 shadow-sm">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
          <Button className="mt-4" size="sm" onClick={this.handleRefresh}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>
    );
  }
}

export const RouteErrorBoundary = ({ children }: RouteErrorBoundaryProps) => {
  const location = useLocation();

  return (
    <RouteErrorBoundaryInner key={`${location.pathname}${location.search}`}>
      {children}
    </RouteErrorBoundaryInner>
  );
};
