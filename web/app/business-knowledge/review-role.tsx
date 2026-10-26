"use client";
import { createContext } from "react";
export type ReviewRoleSelection = {
  roles: string[];
  selected: string;
  choose: (role: string) => void;
};
export const ReviewRoleContext = createContext<ReviewRoleSelection>({
  roles: [],
  selected: "",
  choose: () => {},
});
