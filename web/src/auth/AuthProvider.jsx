import { useCallback, useMemo, useState } from "react";
import {
  clearToken,
  getToken,
  getUser,
  setToken,
  setUser,
} from "../api";
import { AuthContext } from "./authContext";

function readStoredSession() {
  const token = getToken();
  const user = getUser();

  if (!token || !user || typeof user !== "object") {
    if (token || user) {
      clearToken();
    }

    return {
      token: null,
      user: null,
    };
  }

  return {
    token,
    user,
  };
}

export function AuthProvider({ children }) {
  const [session, setSessionState] = useState(readStoredSession);

  const setSession = useCallback(({ token, user }) => {
    if (!token || !user || typeof user !== "object") {
      clearToken();
      setSessionState({
        token: null,
        user: null,
      });
      return;
    }

    setToken(token);
    setUser(user);
    setSessionState({
      token,
      user,
    });
  }, []);

  const updateUser = useCallback((user) => {
    const token = getToken();

    if (!token || !user || typeof user !== "object") {
      clearToken();
      setSessionState({
        token: null,
        user: null,
      });
      return;
    }

    setUser(user);
    setSessionState((current) => ({
      ...current,
      token,
      user,
    }));
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setSessionState({
      token: null,
      user: null,
    });
  }, []);

  const value = useMemo(
    () => ({
      token: session.token,
      user: session.user,
      authenticated: Boolean(session.token && session.user),
      setSession,
      updateUser,
      logout,
    }),
    [session, setSession, updateUser, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
