import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Application rendering error:', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200/70 bg-white p-8 text-center shadow-card">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
              <AlertTriangle className="h-7 w-7" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-xl font-bold text-slate-900">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-500">
              An unexpected error occurred while loading this page. Reload to try again, and if
              the problem persists, sign out and sign back in.
            </p>
            <button type="button" onClick={this.handleReload} className="btn-primary mt-6 w-full">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}