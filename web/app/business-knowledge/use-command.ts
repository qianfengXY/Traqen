"use client";
import { useLayoutEffect, useRef } from "react";
import { subscribeProductRoute } from "../product-navigation.ts";
import type { BusinessKnowledgeClient } from "./client.ts";

// A command may have been durably accepted after its initiating view left.
// Its receipt is not permission to update a newer view or navigation intent.
export function useCommandContext(client: BusinessKnowledgeClient, identity: string) {
  const context = useRef({ active:false, generation:0 });
  useLayoutEffect(() => {
    const current = context.current;
    current.active = true; current.generation++;
    const unsubscribe = subscribeProductRoute(() => { current.generation++; });
    return () => { current.active = false; current.generation++; unsubscribe(); };
  }, [client, identity]);
  return () => {
    const current = context.current, generation = current.generation;
    return () => current.active && current.generation === generation && !client.signal?.aborted;
  };
}
