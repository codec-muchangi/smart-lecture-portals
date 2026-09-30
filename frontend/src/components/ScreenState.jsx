export function Loading() { return <p role="status">Loading…</p> }
export function Empty({ children = 'Nothing here yet.' }) { return <p>{children}</p> }
export function ErrorState({ error, onRetry }) {
  return (
    <div role="alert" className="card">
      <p>{error?.message || 'Something went wrong.'}</p>
      {onRetry && <button onClick={onRetry}>Retry</button>}
    </div>
  )
}
