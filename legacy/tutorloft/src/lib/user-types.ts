export const userRoles = ["tutor", "student", "parent"] as const;

export type UserRole = (typeof userRoles)[number];

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};
