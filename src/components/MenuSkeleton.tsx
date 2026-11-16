export function MenuSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="menu-grid" aria-busy="true" aria-label="Loading menu">
      {Array.from({ length: count }).map((_, i) => (
        <div className="dish dish--skeleton" key={i}>
          <div className="dish__media skeleton" />
          <div className="dish__body">
            <div className="skeleton skeleton--line" style={{ width: '70%' }} />
            <div className="skeleton skeleton--line" style={{ width: '95%' }} />
            <div className="skeleton skeleton--line" style={{ width: '55%' }} />
            <div className="dish__footer">
              <div className="skeleton skeleton--line" style={{ width: 70, height: 20 }} />
              <div className="skeleton skeleton--pill" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
