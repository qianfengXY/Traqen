export type ExtractionKind = "COMPONENT" | "DIRECTORY" | "ENTRY";
export type ExtractionSelection = { kind: ExtractionKind; componentId: string; pathBytes?: string };

// These are selectors within an already frozen component, never filesystem
// access instructions. F001 inventory and F002 admission validate them again.
export function extractionScopes(components: string[], separate: boolean, kind: ExtractionKind = "COMPONENT", path = "") {
  if (!components.length || components.length > 32 || components.some(id => !/^[a-f0-9]{64}$/.test(id))
    || new Set(components).size !== components.length) throw new Error("请明确选择冻结来源组件。");
  if (kind === "COMPONENT") {
    const selections: ExtractionSelection[] = components.map(componentId => ({ kind, componentId }));
    return separate ? selections.map(selection => ({ selections: [selection] })) : [{ selections }];
  }
  if (!["DIRECTORY", "ENTRY"].includes(kind) || components.length !== 1) throw new Error("按目录或文件提取时，请只选择一个冻结组件。");
  const bytes = new TextEncoder().encode(path);
  if (!bytes.length || bytes.length > 4096 || /[\u0000-\u001f\u007f\\:]/.test(path) || path.startsWith("/")
    || path.split("/").some(part => !part || part === "." || part === "..")) throw new Error("请输入冻结组件内的相对路径，不包含根目录、盘符或上级跳转。");
  const pathBytes = btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return [{ selections: [{ kind, componentId: components[0], pathBytes }] }];
}
