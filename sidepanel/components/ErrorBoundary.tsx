// Error boundary for the incrementally-mounted Preact subtrees.
//
// Each Preact component in this side panel is rendered into its own detached
// root (see mount.tsx). Without a boundary, an exception thrown during render
// of any one component unmounts that entire root, leaving a blank slot with no
// diagnostic. Wrapping every mount in <ErrorBoundary> contains the failure to
// the offending subtree, logs it once, and renders nothing in its place so the
// rest of the UI keeps working.
//
// Preact supports both `getDerivedStateFromError` (to flip into the error
// state) and `componentDidCatch` (for the side-effecting log), mirroring React.
import { Component, type ComponentChildren } from 'preact';

interface ErrorBoundaryProps {
  /** Identifies the wrapped subtree in console output. */
  label?: string;
  children?: ComponentChildren;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    const tag = this.props.label ? `[ErrorBoundary:${this.props.label}]` : '[ErrorBoundary]';
    console.error(tag, error);
  }

  render() {
    // Fail safe: hide the broken subtree rather than crash the whole panel.
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
