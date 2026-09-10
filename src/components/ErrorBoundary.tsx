import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** 렌더링 중 예외가 나도 흰 화면 대신 복구 방법을 보여줍니다. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  handleReload = () => {
    location.reload();
  };

  handleClearCacheAndReload = () => {
    if (!confirm('브라우저에 저장된 번역 기록을 모두 삭제하고 다시 불러올까요?\n(단어장과 API 키는 유지됩니다)')) return;
    Object.keys(localStorage)
      .filter(k => k.startsWith('manga-cache-'))
      .forEach(k => localStorage.removeItem(k));
    location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 max-w-lg w-full p-6">
          <h1 className="text-lg font-bold text-gray-800 mb-2">화면을 그리는 중 오류가 발생했습니다</h1>
          <p className="text-sm text-gray-600 mb-4">
            새로고침으로 대부분 해결됩니다. 같은 오류가 반복되면 저장된 번역 기록이 손상됐을 수 있습니다.
          </p>
          <pre className="text-xs bg-gray-50 border rounded p-3 mb-4 overflow-auto max-h-40 text-red-600 whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
          <div className="flex gap-2 justify-end">
            <button
              onClick={this.handleClearCacheAndReload}
              className="px-4 py-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100"
            >
              번역 기록 초기화 후 새로고침
            </button>
            <button
              onClick={this.handleReload}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              새로고침
            </button>
          </div>
        </div>
      </div>
    );
  }
}
