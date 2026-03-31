export const STATUS = [
  "triagem",
  "em_analise",
  "aguardando_aprovacao",
  "aprovado",
  "em_execucao",
  "aguardando_peca",
  "pronto_retirada",
  "encerrado",
  "cancelado",
];

export const STATUS_LABEL = {
  triagem: "Triagem",
  em_analise: "Em análise",
  aguardando_aprovacao: "Aguardando aprovação",
  aprovado: "Aprovado",
  em_execucao: "Em execução",
  aguardando_peca: "Aguardando peça",
  pronto_retirada: "Pronto para retirada",
  encerrado: "Encerrado",
  cancelado: "Cancelado",
};

export function statusLabel(status) {
  return STATUS_LABEL[status] || status;
}

export function statusBadgeClass(status) {
  if (status === "encerrado") return "badge--success";
  if (status === "cancelado") return "badge--danger";
  if (status === "aguardando_aprovacao") return "badge--warning";
  if (status === "aprovado") return "badge--success";
  if (status === "em_execucao" || status === "aguardando_peca") return "badge--default";
  return "badge--gray";
}