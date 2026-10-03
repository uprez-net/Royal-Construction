import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import {
  attachOfferBoundaryScroll,
  type ScrollDirection,
} from "@/components/offers/new-workflow/shell/offer-boundary-scroll";

// EventTarget runs the actual installed listeners without needing a browser.
// Layout and event deltas are supplied just as the browser supplies them.
class Pane extends EventTarget {
  scrollTop = 0;
  clientHeight = 400;
  scrollHeight = 1200;
  ownerDocument = {
    defaultView: {
      getComputedStyle: (element: { overflowY: string }) => element,
    },
  };
}

function fixture(handled = true) {
  const pane = new Pane();
  const directions: ScrollDirection[] = [];
  const dispose = attachOfferBoundaryScroll(
    pane as unknown as HTMLElement,
    (direction) => {
      directions.push(direction);
      return handled;
    },
  );
  return { pane, directions, dispose };
}

function wheel(
  pane: Pane,
  deltaY: number,
  extras: Record<string, unknown> = {},
) {
  const event = new Event("wheel", { cancelable: true });
  const { target, ...properties } = extras;
  Object.assign(
    event,
    { deltaY, deltaX: 0, deltaMode: 0, ctrlKey: false, metaKey: false },
    properties,
  );
  if (target) Object.defineProperty(event, "target", { value: target });
  pane.dispatchEvent(event);
  return event;
}

function touch(
  pane: Pane,
  type: string,
  y: number,
  x = 0,
  count = 1,
  target?: object,
) {
  const event = new Event(type, { cancelable: true });
  if (target) Object.defineProperty(event, "target", { value: target });
  Object.assign(event, {
    touches: Array.from({ length: count }, (_, identifier) => ({
      identifier,
      clientX: x,
      clientY: y,
    })),
  });
  pane.dispatchEvent(event);
  return event;
}

afterEach(() => vi.restoreAllMocks());

test("normal scrolling and reaching an edge do not replace the section", () => {
  const { pane, directions } = fixture();
  pane.scrollTop = 300;
  assert.equal(wheel(pane, 900).defaultPrevented, false);
  assert.deepEqual(directions, []);
  // Only a subsequent outward scroll, with the pane already at the edge,
  // requests the adjacent section.
  pane.scrollTop = 800;
  assert.equal(wheel(pane, 80).defaultPrevented, true);
  assert.deepEqual(directions, [1]);
});

test("outward scrolling at the top goes back, including a short section", () => {
  const { pane, directions } = fixture();
  pane.scrollHeight = pane.clientHeight;
  assert.equal(wheel(pane, -80).defaultPrevented, true);
  assert.deepEqual(directions, [-1]);
});

test("small trackpad deltas accumulate, and reversing clears earlier intent", () => {
  const { pane, directions } = fixture();
  pane.scrollHeight = pane.clientHeight;
  wheel(pane, 40);
  wheel(pane, -30);
  assert.deepEqual(directions, []);
  wheel(pane, -30);
  assert.deepEqual(directions, [-1]);
});

test("wheel momentum cannot skip steps or move the newly opened pane", () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const { pane, directions } = fixture();
  pane.scrollTop = 800;
  wheel(pane, 80);
  // The screen has replaced the section and opened it at the top.
  pane.scrollTop = 0;
  now = 100;
  assert.equal(wheel(pane, 80).defaultPrevented, true);
  now = 200;
  assert.equal(wheel(pane, -80).defaultPrevented, true);
  assert.deepEqual(directions, [1]);
  // After the gesture settles, a deliberate reverse gesture works.
  now = 900;
  wheel(pane, -80);
  assert.deepEqual(directions, [1, -1]);
});

test("a blocked boundary consumes one gesture without repeatedly reporting it", () => {
  const { pane, directions } = fixture();
  pane.scrollTop = 800;
  wheel(pane, 80);
  for (let i = 0; i < 15; i++) wheel(pane, 80);
  assert.deepEqual(directions, [1]);
});

test("first and last sections leave an absent neighbour alone", () => {
  const { pane, directions } = fixture(false);
  assert.equal(wheel(pane, -100).defaultPrevented, false);
  pane.scrollTop = 800;
  assert.equal(wheel(pane, 100).defaultPrevented, false);
  assert.deepEqual(directions, [-1, 1]);
});

test("mouse line and page deltas work as well as pixel deltas", () => {
  for (const [deltaY, deltaMode] of [
    [4, 1],
    [1, 2],
  ]) {
    const { pane, directions } = fixture();
    pane.scrollTop = 799.5;
    wheel(pane, deltaY, { deltaMode });
    assert.deepEqual(directions, [1]);
  }
});

test("zoom, horizontal scrolling and already-handled events remain native", () => {
  const { pane, directions } = fixture();
  pane.scrollTop = 800;
  for (const extras of [
    { ctrlKey: true },
    { metaKey: true },
    { deltaX: 200 },
  ]) {
    assert.equal(wheel(pane, 100, extras).defaultPrevented, false);
  }
  const event = new Event("wheel", { cancelable: true });
  Object.assign(event, { deltaY: 100, deltaX: 0 });
  event.preventDefault();
  pane.dispatchEvent(event);
  assert.deepEqual(directions, []);
});

test("wheel navigation works over inputs and descendants of cards", () => {
  for (const direction of [-1, 1] as const) {
    for (const input of [false, true]) {
      const { pane, directions } = fixture();
      pane.scrollTop = direction > 0 ? 800 : 0;
      const card = {
        matches: () => false,
        parentElement: pane,
        overflowY: "hidden",
        scrollHeight: 500,
        clientHeight: 100,
        scrollTop: 0,
      };
      const child = {
        matches: () => input,
        parentElement: card,
        scrollHeight: 32,
        clientHeight: 32,
        scrollTop: 0,
      };
      assert.equal(
        wheel(pane, direction * 100, { target: child }).defaultPrevented,
        true,
      );
      assert.deepEqual(directions, [direction]);
    }
  }
});

test("a nested scroll area or editor keeps wheel input while it can scroll", () => {
  const { pane, directions } = fixture();
  pane.scrollTop = 800;
  const scroller = {
    matches: () => false,
    parentElement: pane,
    scrollHeight: 500,
    clientHeight: 100,
    scrollTop: 200,
    overflowY: "auto",
  };
  const child = { matches: () => false, parentElement: scroller };
  const editor = { ...scroller, matches: () => true };
  for (const target of [scroller, child, editor]) {
    assert.equal(wheel(pane, 100, { target }).defaultPrevented, false);
    pane.scrollTop = 0;
    assert.equal(wheel(pane, -100, { target }).defaultPrevented, false);
    pane.scrollTop = 800;
  }
  assert.deepEqual(directions, []);
});

test("exhausted nested cards and textareas hand their boundary gesture to the pane", () => {
  for (const direction of [-1, 1] as const) {
    for (const editor of [false, true]) {
      const { pane, directions } = fixture();
      pane.scrollTop = direction > 0 ? 800 : 0;
      const scroller = {
        matches: () => editor,
        parentElement: pane,
        overflowY: "auto",
        scrollHeight: 500,
        clientHeight: 100,
        scrollTop: direction > 0 ? 400 : 0,
      };
      const child = { matches: () => false, parentElement: scroller };
      assert.equal(
        wheel(pane, direction * 100, { target: child }).defaultPrevented,
        true,
      );
      assert.deepEqual(directions, [direction]);
    }
  }
});

test("touch navigation works over inputs and waits for nested scrolling to finish", () => {
  for (const direction of [-1, 1] as const) {
    const { pane, directions } = fixture();
    pane.scrollTop = direction > 0 ? 800 : 0;
    const input = { matches: () => true, parentElement: pane };
    touch(pane, "touchstart", 200, 0, 1, input);
    assert.equal(
      touch(pane, "touchmove", 200 - direction * 100, 0, 1, input)
        .defaultPrevented,
      true,
    );
    assert.deepEqual(directions, [direction]);

    const nested = fixture();
    nested.pane.scrollTop = direction > 0 ? 800 : 0;
    const scroller = {
      matches: () => false,
      parentElement: nested.pane,
      overflowY: "auto",
      scrollHeight: 500,
      clientHeight: 100,
      scrollTop: 200,
    };
    touch(nested.pane, "touchstart", 200, 0, 1, scroller);
    assert.equal(
      touch(nested.pane, "touchmove", 200 - direction * 100, 0, 1, scroller)
        .defaultPrevented,
      false,
    );
    assert.deepEqual(nested.directions, []);
    scroller.scrollTop = direction > 0 ? 400 : 0;
    assert.equal(
      touch(nested.pane, "touchmove", 200 - direction * 200, 0, 1, scroller)
        .defaultPrevented,
      true,
    );
    assert.deepEqual(nested.directions, [direction]);
  }
});

test("touch swipes handle one boundary each and suppress the rest of that swipe", () => {
  const { pane, directions } = fixture();
  pane.scrollTop = 800;
  touch(pane, "touchstart", 200);
  assert.equal(touch(pane, "touchmove", 170).defaultPrevented, false);
  assert.equal(touch(pane, "touchmove", 130).defaultPrevented, true);
  pane.scrollTop = 0;
  assert.equal(touch(pane, "touchmove", 90).defaultPrevented, true);
  assert.deepEqual(directions, [1]);
  touch(pane, "touchend", 90, 0, 0);
  touch(pane, "touchstart", 100);
  touch(pane, "touchmove", 180);
  assert.deepEqual(directions, [1, -1]);
});

test("horizontal swipes, pinch gestures and cancelled touches do not navigate", () => {
  const { pane, directions } = fixture();
  touch(pane, "touchstart", 100);
  assert.equal(touch(pane, "touchmove", 180, 200).defaultPrevented, false);
  touch(pane, "touchstart", 100, 0, 2);
  touch(pane, "touchmove", 180);
  touch(pane, "touchstart", 100);
  touch(pane, "touchcancel", 100, 0, 0);
  touch(pane, "touchmove", 180);
  assert.deepEqual(directions, []);
});

test("disposing the pane removes every installed listener", () => {
  const { pane, directions, dispose } = fixture();
  dispose();
  wheel(pane, -80);
  touch(pane, "touchstart", 100);
  touch(pane, "touchmove", 180);
  assert.deepEqual(directions, []);
});
