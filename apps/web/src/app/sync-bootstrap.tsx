"use client";

import { useEffect } from "react";
import { ApiError, api } from "@/lib/api-client";
import { activateLocalAccount } from "@/lib/local-db";
import { initializeSyncTriggers, setSyncAuthenticated, syncLocalLibrary } from "@/lib/sync";

export function SyncBootstrap() {
  useEffect(() => {
    initializeSyncTriggers();
    void api
      .me()
      .then(async (session) => {
        await activateLocalAccount(session.id, session.isAdmin);
        setSyncAuthenticated(true);
        void syncLocalLibrary();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          setSyncAuthenticated(false);
          void activateLocalAccount(null);
        }
      });
  }, []);

  return null;
}
