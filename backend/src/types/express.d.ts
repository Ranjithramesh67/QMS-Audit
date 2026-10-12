declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        /** Role code, e.g. ADMIN / QMR / a custom role code. For display/UX only. */
        role: string;
        roleId: string;
        roleName: string;
        /** Resolved permission keys held by the user's role. `*` means full access. */
        permissions: string[];
        name: string;
        plantId?: string | null;
        departmentId?: string | null;
      };
    }
  }
}

export {};
