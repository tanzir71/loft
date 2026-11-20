import type { UserRole } from "@/lib/user-types";

export function roleHomePath(role: UserRole) {
  switch (role) {
    case "tutor":
      return "/dashboard";
    case "student":
      return "/home";
    case "parent":
      return "/overview";
  }
}
