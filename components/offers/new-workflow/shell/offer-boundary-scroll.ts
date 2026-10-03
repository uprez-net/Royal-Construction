export type ScrollDirection = -1 | 1;

const EDGE_TOLERANCE = 2;
const INTENT_DISTANCE = 60;
const WHEEL_IDLE_MS = 220;
const TRANSITION_COOLDOWN_MS = 650;

// Keep a gesture's momentum in this pane after a step swap. Returning true
// means the boundary was handled (including a blocked step); false means there
// is no adjacent step. Availability belongs to the screen's existing gates.
export function attachOfferBoundaryScroll(
  pane: HTMLElement,
  onBoundary: (direction: ScrollDirection) => boolean,
): () => void {
  function ownsScroll(
    target: EventTarget | null,
    direction?: ScrollDirection,
  ): boolean {
    let element = target as HTMLElement | null;
    while (element && element !== pane) {
      // Hovering a card or input does not give it ownership of scrolling.
      // A nested editor/list keeps the gesture only while it can actually
      // scroll in that direction; its exhausted edge can hand off to the pane.
      if (
        direction
        && element.scrollHeight > element.clientHeight + EDGE_TOLERANCE
      ) {
        const overflow =
          pane.ownerDocument.defaultView?.getComputedStyle(element).overflowY;
        const canScroll =
          direction < 0
            ? element.scrollTop > EDGE_TOLERANCE
            : element.scrollTop + element.clientHeight
              < element.scrollHeight - EDGE_TOLERANCE;
        if ((overflow === "auto" || overflow === "scroll") && canScroll)
          return false;
      }
      element = element.parentElement;
    }
    return element === pane;
  }

  function atBoundary(direction: ScrollDirection): boolean {
    return direction < 0
      ? pane.scrollTop <= EDGE_TOLERANCE
      : pane.scrollTop + pane.clientHeight
          >= pane.scrollHeight - EDGE_TOLERANCE;
  }

  let lastWheelAt = -Infinity;
  let consumedAt = -Infinity;
  let wheelConsumed = false;
  let wheelDistance = 0;
  let wheelDirection: ScrollDirection | null = null;

  function onWheel(event: WheelEvent) {
    const direction: ScrollDirection = event.deltaY < 0 ? -1 : 1;
    if (
      event.defaultPrevented
      || !event.cancelable
      || event.ctrlKey
      || event.metaKey
      || event.deltaY === 0
      || Math.abs(event.deltaX) > Math.abs(event.deltaY)
      || !ownsScroll(event.target, direction)
    )
      return;

    const now = performance.now();
    if (
      now - lastWheelAt > WHEEL_IDLE_MS
      && now - consumedAt > TRANSITION_COOLDOWN_MS
    ) {
      wheelConsumed = false;
      wheelDistance = 0;
      wheelDirection = null;
    }
    lastWheelAt = now;
    if (wheelConsumed) {
      event.preventDefault();
      return;
    }

    if (!atBoundary(direction)) {
      wheelDistance = 0;
      wheelDirection = null;
      return;
    }
    if (wheelDirection !== direction) wheelDistance = 0;
    wheelDirection = direction;
    const unit =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? pane.clientHeight
          : 1;
    wheelDistance += Math.abs(event.deltaY) * unit;
    if (wheelDistance < INTENT_DISTANCE) return;
    wheelDistance = 0;
    if (onBoundary(direction)) {
      wheelConsumed = true;
      consumedAt = now;
      event.preventDefault();
    }
  }

  let touch: {
    id: number;
    startX: number;
    startY: number;
    lastY: number;
  } | null = null;
  let touchConsumed = false;
  let touchDistance = 0;
  let touchDirection: ScrollDirection | null = null;

  function onTouchStart(event: TouchEvent) {
    touch = null;
    touchConsumed = false;
    touchDistance = 0;
    touchDirection = null;
    if (event.touches.length !== 1 || !ownsScroll(event.target)) return;
    const first = event.touches[0];
    touch = {
      id: first.identifier,
      startX: first.clientX,
      startY: first.clientY,
      lastY: first.clientY,
    };
  }

  function onTouchMove(event: TouchEvent) {
    if (event.touches.length !== 1) {
      touch = null;
      return;
    }
    if (!touch || event.defaultPrevented || !event.cancelable) return;
    const current = event.touches[0];
    if (current.identifier !== touch.id) return;
    if (touchConsumed) {
      event.preventDefault();
      return;
    }
    const delta = touch.lastY - current.clientY;
    touch.lastY = current.clientY;
    if (
      delta === 0
      || Math.abs(current.clientX - touch.startX)
        > Math.abs(current.clientY - touch.startY)
    )
      return;
    const direction: ScrollDirection = delta < 0 ? -1 : 1;
    if (!ownsScroll(event.target, direction) || !atBoundary(direction)) {
      touchDistance = 0;
      touchDirection = null;
      return;
    }
    if (touchDirection !== direction) touchDistance = 0;
    touchDirection = direction;
    touchDistance += Math.abs(delta);
    if (touchDistance < INTENT_DISTANCE) return;
    touchDistance = 0;
    if (onBoundary(direction)) {
      touchConsumed = true;
      event.preventDefault();
    }
  }

  function onTouchEnd() {
    touch = null;
  }

  // Non-passive only on the pane: cancellation is needed at a handled edge,
  // while ordinary scrolling, pinch zoom and nested editors remain native.
  pane.addEventListener("wheel", onWheel, { passive: false });
  pane.addEventListener("touchstart", onTouchStart, { passive: true });
  pane.addEventListener("touchmove", onTouchMove, { passive: false });
  pane.addEventListener("touchend", onTouchEnd, { passive: true });
  pane.addEventListener("touchcancel", onTouchEnd, { passive: true });
  return () => {
    pane.removeEventListener("wheel", onWheel);
    pane.removeEventListener("touchstart", onTouchStart);
    pane.removeEventListener("touchmove", onTouchMove);
    pane.removeEventListener("touchend", onTouchEnd);
    pane.removeEventListener("touchcancel", onTouchEnd);
  };
}
