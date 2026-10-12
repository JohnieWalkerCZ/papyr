"use client";

import { useEffect, useState } from "react";
import { ApiError, api, type SessionUser } from "@/lib/api-client";
import { setSyncAuthenticated, syncLocalLibrary } from "@/lib/sync";
import { useLocale } from "@/lib/locale";

export function AuthPanel() {
  const copy = useLocale().auth;
  const [user, setUser] = useState<SessionUser | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [setupMode, setSetupMode] = useState(false);
  const [status, setStatus] = useState<string>(copy.checking);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onSyncState = (event: Event) => {
      const state = (event as CustomEvent<{ state: string }>).detail.state;
      if (state === "authRequired") {
        setUser(null);
        setStatus(copy.loggedOut);
      }
    };
    window.addEventListener("papyr-sync-state", onSyncState);
    void api
      .me()
      .then((session) => {
        setUser(session);
        setSyncAuthenticated(true);
        setStatus(copy.loggedIn(session.username || session.id));
        void syncLocalLibrary();
      })
      .catch((error: unknown) => {
        setUser(null);
        const unauthorized = error instanceof ApiError && error.status === 401;
        setStatus(unauthorized ? copy.loggedOut : copy.unavailable);
      });
    return () => window.removeEventListener("papyr-sync-state", onSyncState);
  }, [copy]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const session = setupMode ? await api.setup(username, password, setupToken) : await api.login(username, password);
      setUser(session);
      setSyncAuthenticated(true);
      setPassword("");
      setSetupToken("");
      setStatus(copy.loggedIn(session.username || session.id));
      void syncLocalLibrary();
    } catch (error) {
      setStatus(setupMode ? (error instanceof ApiError ? error.message : copy.unavailable) : copy.loggedOut);
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
      setStatus(copy.loggedOut);
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
        <button type="button" onClick={() => void logout()} disabled={busy}>
          {copy.logout}
        </button>
      ) : (
        <>
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
                minLength={12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {setupMode && (
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
            )}
            <button type="submit" disabled={busy}>
              {busy ? copy.submit : setupMode ? copy.setup : copy.login}
            </button>
          </form>
          <button className="text-button" type="button" onClick={() => setSetupMode((mode) => !mode)}>
            {copy.showSetup}
          </button>
          {setupMode && <p className="save-status">{copy.setupHelp}</p>}
        </>
      )}
    </section>
  );
}
