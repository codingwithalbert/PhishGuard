import { Component } from "react";

/*
 * Application-level React error boundary (Phase 0A).
 *
 * Mounted in App.jsx around the whole router tree, so a rendering failure in
 * a page, the application shell, or session handling degrades to a readable
 * recovery screen instead of a blank page.
 *
 * The fallback intentionally carries no error message, stack trace, request
 * data, or other internal detail: only a stable explanation and a reload
 * control. It reuses the existing global element and [role="alert"] styles
 * from index.css, so no stylesheet, class name, or inline visual treatment
 * is required.
 *
 * Recovery is a full page reload, which rebuilds React state from scratch.
 * It runs only on an explicit user action, so a failing render cannot enter
 * an automatic retry loop.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    // Deliberately empty. Diagnostics stay sanitized: an error object may
    // carry messages, stacks, or request detail, so it is neither logged
    // nor rendered.
  }

  handleReload = () => {
    // Explicit user action only; never called automatically.
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <main>
          <h1>PhishGuard could not display this page</h1>

          <p role="alert">
            Something went wrong while showing this page. Reload the page to
            try again.
          </p>

          <button type="button" onClick={this.handleReload}>
            Reload page
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
