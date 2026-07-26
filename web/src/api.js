const API_URL =
  import.meta.env.VITE_API_URL ||
  "http://localhost:3000";

let authRedirectInProgress = false;

export function getApiUrl() {
  return API_URL;
}

export function setToken(token) {
  localStorage.setItem("token", token);
}

export function setUser(user) {
  if (!user || typeof user !== "object") {
    localStorage.removeItem("user");
    return;
  }

  localStorage.setItem(
    "user",
    JSON.stringify(user)
  );
}

export function getToken() {
  return localStorage.getItem("token");
}

export function clearToken() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

function getResponseCode(data) {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return undefined;
  }

  return data.code;
}

function getRequestId(data) {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return undefined;
  }

  return data.requestId;
}

function createApiError(
  message,
  response,
  data
) {
  const error = new Error(message);

  error.name = "ApiError";
  error.status = response.status;
  error.code = getResponseCode(data);
  error.requestId = getRequestId(data);

  return error;
}

function buildErrorMessage(data) {
  let message =
    (
      data &&
      typeof data === "object" &&
      data.error
    ) ||
    (
      typeof data === "string" &&
      data
    ) ||
    "Erro na requisição";

  if (
    data &&
    typeof data === "object" &&
    Array.isArray(data.details) &&
    data.details.length > 0
  ) {
    const detailMessages = data.details
      .map((item) => item?.message)
      .filter(Boolean)
      .join(" ");

    if (detailMessages) {
      message = `${message}: ${detailMessages}`;
    }
  }

  if (
    data &&
    typeof data === "object" &&
    data.requestId
  ) {
    message =
      `${message} Código: ${data.requestId}`;
  }

  return message;
}

function invalidateSession() {
  clearToken();

  if (
    typeof window === "undefined" ||
    window.location.pathname === "/login" ||
    authRedirectInProgress
  ) {
    return;
  }

  authRedirectInProgress = true;
  window.location.replace("/login");
}

export async function apiFetch(
  path,
  options = {},
  config = {}
) {
  const { auth = true } = config;
  const token = getToken();

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (auth && token) {
    headers.Authorization =
      `Bearer ${token}`;
  }

  const response = await fetch(
    `${API_URL}${path}`,
    {
      ...options,
      headers,
    }
  );

  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");

  const data = isJson
    ? await response
        .json()
        .catch(() => ({}))
    : await response.text();

  const responseCode =
    getResponseCode(data);

  const sessionMustBeInvalidated =
    auth &&
    (
      response.status === 401 ||
      responseCode === "SESSION_REVOKED" ||
      responseCode === "USER_INACTIVE"
    );

  if (sessionMustBeInvalidated) {
    const message = buildErrorMessage(data);

    invalidateSession();

    throw createApiError(
      message,
      response,
      data
    );
  }

  if (!response.ok) {
    throw createApiError(
      buildErrorMessage(data),
      response,
      data
    );
  }

  return data;
}

export function getUser() {
  try {
    const raw =
      localStorage.getItem("user");

    return raw
      ? JSON.parse(raw)
      : null;
  } catch {
    return null;
  }
}