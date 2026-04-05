const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export function getApiUrl() {
  return API_URL;
}

export function setToken(token) {
  localStorage.setItem("token", token);
}

export function getToken() {
  return localStorage.getItem("token");
}

export function clearToken() {
  localStorage.removeItem("token");
}

export async function apiFetch(path, options = {}, config = {}) {
  const { auth = true } = config;
  const token = getToken();

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (auth && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");

  const data = isJson ? await response.json().catch(() => ({})) : await response.text();

  if (response.status === 401) {
    clearToken();
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  if (!response.ok) {
    const message =
      (typeof data === "object" && data?.error) ||
      (typeof data === "string" && data) ||
      "Erro na requisição";
    throw new Error(message);
  }

  return data;
}