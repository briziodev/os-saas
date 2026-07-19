export const MIN_NEW_PASSWORD_CHARACTERS = 10;
export const MAX_BCRYPT_PASSWORD_BYTES = 72;

export function countPasswordCharacters(password) {
  return Array.from(String(password ?? "")).length;
}

export function countPasswordBytes(password) {
  return new TextEncoder().encode(
    String(password ?? "")
  ).length;
}

export function getNewPasswordError(password) {
  if (typeof password !== "string") {
    return "Senha inválida.";
  }

  if (password.length === 0) {
    return "Informe uma senha.";
  }

  if (password.includes("\0")) {
    return "A senha contém um caractere inválido.";
  }

  if (password.trim().length === 0) {
    return "A senha não pode conter somente espaços.";
  }

  if (
    countPasswordCharacters(password) <
    MIN_NEW_PASSWORD_CHARACTERS
  ) {
    return `A senha precisa ter no mínimo ${MIN_NEW_PASSWORD_CHARACTERS} caracteres.`;
  }

  if (
    countPasswordBytes(password) >
    MAX_BCRYPT_PASSWORD_BYTES
  ) {
    return `A senha excede o limite seguro de ${MAX_BCRYPT_PASSWORD_BYTES} bytes.`;
  }

  return "";
}