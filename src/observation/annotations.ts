import { projectBBox, projectPoint } from "../renderer/bbox.ts";
export function evidenceAnnotations(screenshot: any, trigger: any) {
  if (
    screenshot?.coordinateSpace !== "screen_top_left_points" ||
    screenshot?.shadowsExcluded !== true
  )
    return { layers: [], point: null };
  const layers = ["focus", "selection", "click"].flatMap((kind) => {
    const region = screenshot.regions?.[kind];
    const box =
      region?.status === "available"
        ? projectBBox(region.rect, screenshot.frame)
        : null;
    return box ? [{ kind, ...box }] : [];
  });
  return {
    layers,
    point:
      trigger?.kind === "click"
        ? projectPoint(trigger.x, trigger.y, screenshot.frame)
        : null,
  };
}
