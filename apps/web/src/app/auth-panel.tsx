"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type SessionUser } from "@/lib/api-client";
import { activateLocalAccount, resetLocalPapyrData } from "@/lib/local-db";
import { setSyncAuthenticated, syncLocalLibrary } from "@/lib/sync";
import { useLocale } from "@/lib/locale";

export function AuthPanel() {
  const copy = useLocale().auth;
  const [user, setUser] = useState<SessionUser | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [setupMode, setSetupMode] = useState(false);
  const [setupComplete, setSetupComplete] = useState(true);
  const [setupStatusError, setSetupStatusError] = useState<ApiError | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [status, setStatus] = useState<string>(copy.checking);
  const [busy, setBusy] = useState(false);

  const refreshSetupStatus = useCallback(async () => {
    try {
      const { complete } = await api.setupStatus();
      setSetupComplete(complete);
      setSetupMode(!complete);
      setSetupStatusError(null);
    } catch (error) {
      setSetupStatusError(error instanceof ApiError ? error : new ApiError(copy.unavailable, 0));
    }
  }, [copy]);

  useEffect(() => {
    const onSyncState = (event: Event) => {
      if ((event as CustomEvent<{ state: string }>).detail.state === "authRequired") {
        setUser(null);
        setSyncAuthenticated(false);
        void activateLocalAccount(null);
        setStatus(copy.loggedOut);
        window.location.reload();
      }
    };
    window.addEventListener("papyr-sync-state", onSyncState);
    void Promise.resolve().then(refreshSetupStatus);
    void api
      .me()
      .then(async (session) => {
        await activateLocalAccount(session.id, session.isAdmin);
        setUser(session);
        setSyncAuthenticated(true);
        setStatus(copy.loggedIn(session.username || session.id));
        void syncLocalLibrary();
      })
      .catch(async (error: unknown) => {
        await activateLocalAccount(null);
        setUser(null);
        const unauthorized = error instanceof ApiError && error.status === 401;
        setStatus(unauthorized ? copy.loggedOut : copy.unavailable);
      });
    return () => window.removeEventListener("papyr-sync-state", onSyncState);
  }, [copy, refreshSetupStatus]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const session = setupMode
        ? await api.setup(username, password, setupToken, confirmReset)
        : await api.login(username, password);
      if (setupMode) await resetLocalPapyrData();
      await activateLocalAccount(session.id, !setupMode && session.isAdmin);
      setUser(session);
      setSyncAuthenticated(true);
      setPassword("");
      setSetupToken("");
      setStatus(copy.loggedIn(session.username || session.id));
      window.location.reload();
    } catch (error) {
      setStatus(error instanceof ApiError ? error.message : copy.unavailable);
    } finally {
      setBusy(false);
    }
  }

  async function createAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.createAccount(newUsername, newPassword);
      setNewUsername("");
      setNewPassword("");
      setStatus(copy.accountCreated);
    } catch (error) {
      setStatus(error instanceof ApiError ? error.message : copy.unavailable);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await api.logout();
      setUser(null);
      setSyncAuthenticated(false);
      await activateLocalAccount(null);
      window.location.reload();
    } catch {
      setStatus(copy.unavailable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-panel" aria-labelledby="auth-title">
      <div className="auth-heading">
        <h2 id="auth-title">{copy.title}</h2>
        <p aria-live="polite">{status}</p>
      </div>
      {user ? (
        <>
          <button type="button" onClick={() => void logout()} disabled={busy}>
            {copy.logout}
          </button>
          {user.isAdmin && (
            <form className="auth-form" onSubmit={(event) => void createAccount(event)}>
              <h3>{copy.createAccount}</h3>
              <label>
                {copy.username}
                <input
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={64}
                  value={newUsername}
                  onChange={(event) => setNewUsername(event.target.value)}
                />
              </label>
              <label>
                {copy.password}
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <button type="submit" disabled={busy}>
                {busy ? copy.submit : copy.createAccount}
              </button>
            </form>
          )}
        </>
      ) : (
        <>
          {setupStatusError && (
            <div className="setup-diagnostic" role="alert">
              <strong>{copy.setupCheckFailed}</strong>
              <p>
                {copy.setupDiagnostic(setupStatusError.status, setupStatusError.code, setupStatusError.diagnosticId)}
              </p>
              <p>
                {setupStatusError.status === 0
                  ? copy.setupConnectionError
                  : setupStatusError.code === "DATABASE_SCHEMA_ERROR"
                    ? copy.setupDatabaseSchemaError
                    : setupStatusError.code === "DATABASE_AUTH_FAILED"
                      ? copy.setupDatabaseAuthError
                      : setupStatusError.code === "DATABASE_NOT_FOUND"
                        ? copy.setupDatabaseMissing
                        : setupStatusError.code === "DATABASE_UNAVAILABLE"
                          ? copy.setupDatabaseUnavailable
                          : copy.setupCheckGenericError}
              </p>
              <button className="text-button" type="button" onClick={() => void refreshSetupStatus()}>
                {copy.retrySetupCheck}
              </button>
            </div>
          )}
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <label>
              {copy.username}
              <input
                autoComplete="username"
                required
                minLength={3}
                maxLength={64}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label>
              {copy.password}
              <input
                type="password"
                autoComplete={setupMode ? "new-password" : "current-password"}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {setupMode && (
              <>
                <label>
                  {copy.setupToken}
                  <input
                    autoComplete="off"
                    required
                    minLength={32}
                    value={setupToken}
                    onChange={(event) => setSetupToken(event.target.value)}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    required
                    checked={confirmReset}
                    onChange={(event) => setConfirmReset(event.target.checked)}
                  />
                  {copy.confirmReset}
                </label>
              </>
            )}
            <button type="submit" disabled={busy || (setupMode && setupComplete)}>
              {busy ? copy.submit : setupMode ? copy.setup : copy.login}
            </button>
          </form>
          {!setupComplete && (
            <button className="text-button" type="button" onClick={() => setSetupMode((mode) => !mode)}>
              {copy.showSetup}
            </button>
          )}
          {setupMode && <p className="save-status">{copy.setupHelp}</p>}
        </>
      )}
    </section>
  );
}
