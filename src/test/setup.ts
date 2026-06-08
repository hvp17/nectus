import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { resetAppStore } from "./testUtils";

// The Zustand UI store is a module singleton, so reset it before every test to
// keep state from leaking across `render(<App/>)` calls within a file.
beforeEach(() => {
  resetAppStore();
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

HTMLCanvasElement.prototype.getContext = (() => ({
  canvas: document.createElement("canvas"),
  clearRect: () => undefined,
  fillRect: () => undefined,
  getImageData: () => ({ data: [] }),
  putImageData: () => undefined,
  createImageData: () => [],
  setTransform: () => undefined,
  drawImage: () => undefined,
  save: () => undefined,
  fillText: () => undefined,
  restore: () => undefined,
  beginPath: () => undefined,
  moveTo: () => undefined,
  lineTo: () => undefined,
  closePath: () => undefined,
  stroke: () => undefined,
  translate: () => undefined,
  scale: () => undefined,
  rotate: () => undefined,
  arc: () => undefined,
  fill: () => undefined,
  measureText: () => ({ width: 8 }),
  transform: () => undefined,
  rect: () => undefined,
  clip: () => undefined,
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

Element.prototype.scrollIntoView = () => undefined;
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => undefined;
Element.prototype.setPointerCapture = () => undefined;
