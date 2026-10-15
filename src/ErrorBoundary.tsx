import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Si una pantalla falla, se muestra el motivo en lugar de dejar la ventana en blanco. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Error en la interfaz:', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" style={{ margin: 20 }}>
        <h2>Algo ha fallado en esta pantalla</h2>
        <div className="msg bad">{this.state.error.message}</div>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          Reintentar
        </button>
      </div>
    );
  }
}
