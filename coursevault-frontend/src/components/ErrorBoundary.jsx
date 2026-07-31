import React from 'react';

/**
 * Without a boundary, any exception thrown while rendering unmounts the whole
 * tree — React empties #root and the page goes white, with the real error
 * buried in the console. That failure mode is indistinguishable from a CSS or
 * data problem, which makes it expensive to diagnose.
 *
 * This catches the throw and puts the message and component stack on the page.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    console.error('[ErrorBoundary] render failed', error, info?.componentStack);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ padding: 24, fontFamily: 'ui-monospace, monospace', maxWidth: 900, margin: '0 auto' }}>
        <div
          style={{
            border: '3px solid #000',
            borderRadius: 16,
            background: '#fff',
            boxShadow: '6px 6px 0 0 #111',
            overflow: 'hidden',
          }}
        >
          <div style={{ background: '#F26B4D', borderBottom: '3px solid #000', padding: '12px 16px', fontWeight: 900 }}>
            Something crashed while rendering
          </div>
          <div style={{ padding: 16 }}>
            <p style={{ fontWeight: 700, margin: '0 0 12px' }}>{String(error?.message || error)}</p>

            <button
              onClick={() => this.setState({ error: null, info: null })}
              style={{
                border: '2px solid #000',
                borderRadius: 10,
                padding: '6px 14px',
                fontWeight: 700,
                background: '#F9E076',
                cursor: 'pointer',
                marginBottom: 16,
              }}
            >
              Try again
            </button>

            <details open>
              <summary style={{ fontWeight: 700, cursor: 'pointer' }}>Component stack</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>
                {info?.componentStack || '(none)'}
              </pre>
            </details>

            {error?.stack && (
              <details style={{ marginTop: 12 }}>
                <summary style={{ fontWeight: 700, cursor: 'pointer' }}>JS stack</summary>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>{error.stack}</pre>
              </details>
            )}
          </div>
        </div>
      </div>
    );
  }
}
