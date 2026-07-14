import type { AppRole } from "@prisma/client";
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: AppRole;
      associateId: string | null;
      mustResetPassword: boolean;
    };
  }
  interface User {
    role: AppRole;
    associateId: string | null;
    mustResetPassword: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: AppRole;
    associateId: string | null;
    mustResetPassword: boolean;
  }
}
