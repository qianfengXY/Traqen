import test from "node:test";
import findAccount from "../src/default-service.js";

test("finds an account", () => findAccount("ACCOUNT-001"));
