export default function PageHeader({
  eyebrow = "Painel da oficina",
  title,
  description,
  right,
}) {
  return (
    <div className="topbar">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, opacity: 0.82, marginBottom: 6 }}>
          {eyebrow}
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: "clamp(30px, 6vw, 42px)",
            lineHeight: 1.05,
          }}
        >
          {title}
        </h1>

        {description ? (
          <p
            style={{
              marginTop: 10,
              marginBottom: 0,
              fontSize: 15,
              opacity: 0.92,
              lineHeight: 1.5,
            }}
          >
            {description}
          </p>
        ) : null}
      </div>

      {right ? (
        <div
          className="form-actions"
          style={{
            width: "100%",
            maxWidth: 420,
            marginLeft: "auto",
          }}
        >
          {right}
        </div>
      ) : null}
    </div>
  );
}