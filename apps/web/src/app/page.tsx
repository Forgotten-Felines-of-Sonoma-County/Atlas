export default function Home() {
  return (
    <div>
      <h1>Atlas TNR Dashboard</h1>
      <p className="text-muted mt-2">
        Cat tracking and TNR management system.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
          gap: "1rem",
          marginTop: "2rem",
        }}
      >
        <a href="/cats" className="card">
          <h2>Cats</h2>
          <p className="text-muted text-sm mt-1">
            Browse and search the cat registry
          </p>
        </a>

        <a href="/search" className="card">
          <h2>Search</h2>
          <p className="text-muted text-sm mt-1">
            Search cats, people, and places
          </p>
        </a>
      </div>
    </div>
  );
}
