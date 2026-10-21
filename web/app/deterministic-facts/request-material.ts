import { DeterministicFactsClient, FactsClientError } from "./client.ts";
import type { MaterialBinding } from "./request-input.ts";

export type MaterialOption = { id: string; label: string };
export type VerifiedMaterialSelection = MaterialBinding & { client: DeterministicFactsClient };
type Context = { workspaceId: string; graphVersionId?: string };
const digest = /^[a-f0-9]{64}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function invalid(): never { throw new FactsClientError("材料响应与当前工作区、固定版本或登记材料不匹配，未采用此选择。", "F002_MATERIAL_REFERENCE_MISMATCH"); }
function version(context: Context) {
  if (!context.workspaceId || !digest.test(context.graphVersionId ?? "")) invalid();
  return `/versions/${context.graphVersionId}`;
}
function envelope(value: unknown, context: Context) {
  if (!object(value) || value.workspaceId !== context.workspaceId) invalid();
  return value;
}
function option(value: unknown): MaterialOption {
  if (!object(value) || value.kind !== "MATERIAL" || typeof value.id !== "string" || !digest.test(value.id)
    || !object(value.payload) || value.payload.materialId !== value.id) invalid();
  const label = value.payload.displayPath;
  if (label !== undefined && (typeof label !== "string" || label.length > 4096)) invalid();
  return { id: value.id, label: typeof label === "string" && label ? label : value.id };
}

// Both routes are existing authorized fixed-version metadata reads. Discovery
// never reads original content or grants the consumer investigation's scope.
export async function readRequestMaterialPage(client: DeterministicFactsClient, context: Context, cursor: string | null = null) {
  const route = version(context), query = new URLSearchParams({ limit: "20" });
  if (cursor !== null) {
    if (typeof cursor !== "string" || !cursor || cursor.length > 4096) invalid();
    query.set("cursor", cursor);
  }
  const value = envelope(await client.request<unknown>(`${route}/materials?${query}`), context);
  if (!Array.isArray(value.items) || value.items.length > 20 || (value.nextCursor !== null
    && (typeof value.nextCursor !== "string" || !value.nextCursor || value.nextCursor.length > 4096 || value.nextCursor === cursor || !value.items.length))) invalid();
  const items = value.items.map(option);
  if (new Set(items.map(item => item.id)).size !== items.length) invalid();
  return { items, nextCursor: value.nextCursor as string | null };
}

export async function readRequestMaterial(client: DeterministicFactsClient, context: Context, materialId: string) {
  const route = version(context);
  if (!digest.test(materialId)) invalid();
  const value = envelope(await client.request<unknown>(`${route}/records/MATERIAL/${materialId}`), context);
  const material = option(value.record);
  if (material.id !== materialId) invalid();
  return material;
}
