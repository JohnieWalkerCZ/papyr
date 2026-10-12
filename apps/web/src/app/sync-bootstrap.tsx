"use client";

import { useEffect } from "react";
import { api } from "@/lib/api-client";
import { initializeSyncTriggers, setSyncAuthenticated, syncLocalLibrary } from "@/lib/sync";

export function SyncBootstrap() {
  useEffect(() => {
    initializeSyncTriggers();
    void api
      .me()
      .then(() => {
        setSyncAuthenticated(true);
        void syncLocalLibrary();
      })
      .catch(() => {});
  }, []);

  return null;
}
