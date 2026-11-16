export function LiveDot({ connected }: { connected: boolean }) {
  return (
    <span className={`live ${connected ? 'is-live' : ''}`}>
      <span className="live__dot" /> {connected ? 'Live' : 'Connecting…'}
    </span>
  )
}
