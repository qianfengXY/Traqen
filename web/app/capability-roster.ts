import type { ChildCapabilityRole } from "./product-foundation-client";

type SlotDefaults = Pick<ChildCapabilityRole, "model" | "skillNames" | "mcpNames"> & Partial<Pick<ChildCapabilityRole, "rolePolicy">>;

function cloneValues(values: string[]) {
  return [...values];
}

function childNumber(id: string) {
  const match = /^CHILD-(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

export function createDefaultChildSlots(): ChildCapabilityRole[] {
  return [1].map((number) => ({
    id: `CHILD-${number}`,
    model: "",
    skillNames: [],
    mcpNames: [],
    rolePolicy: "SPECIALIST",
    independenceGroup: `GROUP-${number}`,
  }));
}

export function addChildSlot(
  slots: ChildCapabilityRole[],
  defaults: SlotDefaults,
): ChildCapabilityRole[] {
  const used = new Set(slots.map(({ id }) => childNumber(id)).filter(Boolean));
  let number = 1;
  while (used.has(number)) number += 1;
  return [...slots, {
    id: `CHILD-${number}`,
    model: defaults.model,
    skillNames: cloneValues(defaults.skillNames),
    mcpNames: cloneValues(defaults.mcpNames),
    rolePolicy: defaults.rolePolicy ?? "SPECIALIST",
    independenceGroup: `GROUP-${number}`,
  }];
}

export function removeChildSlot(slots: ChildCapabilityRole[], slotId: string) {
  return slots.length <= 1 ? slots : slots.filter(({ id }) => id !== slotId);
}

export function needsStartConfirmation(lastConfirmedExecutionProfileId: string | null, nextExecutionProfileId: string) {
  return lastConfirmedExecutionProfileId !== nextExecutionProfileId;
}
