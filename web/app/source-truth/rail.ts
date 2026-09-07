// Reveal a station without scrolling the document or moving keyboard focus.
export function revealSourceStation(rail: HTMLElement | null, station: number) {
  if (!rail || !Number.isInteger(station) || station < 1 || station > 8) return;
  const target = rail.querySelector<HTMLElement>(`[data-station="${station}"]`);
  if (!target) return;
  const viewport = rail.getBoundingClientRect(), bounds = target.getBoundingClientRect();
  const left = bounds.left < viewport.left ? bounds.left - viewport.left
    : bounds.right > viewport.right ? bounds.right - viewport.right : 0;
  if (left) rail.scrollBy({ left, behavior: "auto" });
}
