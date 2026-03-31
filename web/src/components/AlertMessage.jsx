export default function AlertMessage({ message = "" }) {
  if (!message) return null;

  const isError = message.toLowerCase().includes("erro");

  return (
    <div
      className="card section"
      style={{
        background: isError ? "#fef2f2" : "#ecfdf5",
        borderColor: isError ? "#fecaca" : "#bbf7d0",
        color: isError ? "#991b1b" : "#166534",
      }}
    >
      {message}
    </div>
  );
}