/** Project release momentum, then magnetize to one of two detents. dy/vy point down. */
export function sheetSnap(height: number, velocityY: number, closed: number, opened: number): 'closed' | 'open' {
  const projected = height - velocityY * 180;
  return projected >= (closed + opened) / 2 ? 'open' : 'closed';
}

/** An unfinished search has no compact trip state. Reports close back to the map. */
export function collapsedScreen(screen: 'map' | 'route' | 'report', hasDestination: boolean): 'map' | 'route' {
  return screen === 'route' && hasDestination ? 'route' : 'map';
}
