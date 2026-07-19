const MIN_NEW_PASSWORD_CHARACTERS = 10;
const MAX_BCRYPT_PASSWORD_BYTES = 72;
const BCRYPT_ROUNDS = 10;

function countPasswordCharacters(password) {
  return Array.from(String(password || "")).length;
}

function getNewPasswordIssues(password) {
  if (typeof password !== "string") {
    return ["Senha inválida."];
  }

  const issues = [];

  if (password.includes("\0")) {
    issues.push("A senha contém um caractere inválido.");
  }

  if (password.trim().length === 0) {
    issues.push("A senha não pode conter somente espaços.");
  }

  if (
    countPasswordCharacters(password) <
    MIN_NEW_PASSWORD_CHARACTERS
  ) {
    issues.push(
      `A senha deve ter pelo menos ${MIN_NEW_PASSWORD_CHARACTERS} caracteres.`
    );
  }

  if (
    Buffer.byteLength(password, "utf8") >
    MAX_BCRYPT_PASSWORD_BYTES
  ) {
    issues.push(
      `A senha excede o limite seguro de ${MAX_BCRYPT_PASSWORD_BYTES} bytes.`
    );
  }

  return issues;
}

function addNewPasswordIssues(password, context) {
  const issues = getNewPasswordIssues(password);

  for (const message of issues) {
    context.addIssue({
      code: "custom",
      message,
    });
  }
}

module.exports = {
  MIN_NEW_PASSWORD_CHARACTERS,
  MAX_BCRYPT_PASSWORD_BYTES,
  BCRYPT_ROUNDS,
  getNewPasswordIssues,
  addNewPasswordIssues,
};