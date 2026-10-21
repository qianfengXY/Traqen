import express from "express";

const router = express.Router();

export function saveOrder() {
  return true;
}

export function submitOrder() {
  return saveOrder();
}

function shadowed(saveOrder) {
  return saveOrder();
}

router.post("/orders", submitOrder);
