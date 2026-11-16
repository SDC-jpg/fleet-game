// If drawing the screen ever fails, show what went wrong instead of a black
// page, so it can be reported (and a reload tried). Saved equipment is safe:
// it's written to the browser as soon as it changes.

import { Component, type ReactNode } from 'react';

export class CrashScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Game screen crashed:', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const details = `${error.message}\n${error.stack ?? ''}`;
    return (
      <div className="crash-screen">
        <h1>Something went wrong</h1>
        <p>The game hit an error. Your saved equipment is safe. Please copy the details below and send them so it can be fixed.</p>
        <textarea readOnly value={details} />
        <div>
          <button onClick={() => navigator.clipboard?.writeText(details)}>Copy details</button>
          <button onClick={() => location.reload()}>Reload the game</button>
        </div>
      </div>
    );
  }
}
