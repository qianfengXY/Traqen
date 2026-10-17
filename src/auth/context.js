import { AsyncLocalStorage } from "node:async_hooks";
export const authContext = new AsyncLocalStorage();
export const identityContext = () => authContext.getStore();
