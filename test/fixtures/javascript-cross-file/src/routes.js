import { handleGetOrder as orderHandler } from "./order-controller.js";

app.get("/orders/:id", orderHandler);
