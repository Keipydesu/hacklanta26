# 030. Two magnetic task-sheet positions

- Status: Accepted
- Date: 2026-10-10
- Supersedes: Decisions 015 and 029's disclosure-chevron and empty compact-trip presentation.

The operator requested drag-to-open/close with momentum and magnetic snapping. A grabber and
header drag surface control the sheet; velocity projects the release toward either compact or
expanded, and a damped spring settles there. Search occupies the available height above the
keyboard. Inner lists retain scrolling, and the handle exposes accessible expand/collapse actions.
Remove the chevron. A tap on exposed map collapses the sheet unless explicitly choosing an endpoint.

No selected destination means no intermediate From/To panel when closing search: return to the
single destination input. A compact selected trip hides From; expansion restores it. Closing
reporting returns to the map without discarding the saved queue or draft category.

No dependencies or API changes. Simulator checks cover accessible expansion and map-tap collapse;
automated drag delivered zero movement, so physical drag/velocity feel remains to be checked.
