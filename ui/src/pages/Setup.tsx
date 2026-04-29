import { useState } from "react";
import { useStack } from "../lib/stack-context.js";
import { clearStackOverride } from "../lib/deployments.js";

// Setup tab: shows the active deployment handles + lets the user paste
// an override JSON to swap in a local validator's stack. Persists to
// localStorage so reload keeps the override.
//
// The default config mirrors `deployments/devnet.json`'s `kaminoStack`
// block. Stale-after dates >7d show a warning; if the on-chain state
// has drifted (e.g., maturity rolled), the override is the escape
// hatch.

export function Setup() {
  const { stack, replace } = useStack();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => stringifyStack(stack));
  const [error, setError] = useState<string | null>(null);
  const ageDays = computeAgeDays(stack.lastUpdated);

  function handleSave() {
    setError(null);
    try {
      const parsed = JSON.parse(draft);
      replace(parsed);
      setEditing(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleReset() {
    clearStackOverride();
    window.location.reload();
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Active deployment</h2>
      <p style={{ color: "#8a8a8a", fontSize: 13 }}>
        Cluster: <code>{stack.cluster}</code> · RPC: <code>{stack.rpcUrl}</code>
        {" · "}
        Updated: <code>{stack.lastUpdated}</code>
        {ageDays > 7 && (
          <span style={{ color: "#fa6" }}> (stale: {ageDays}d old)</span>
        )}
      </p>

      <Block title="Programs" obj={stack.programs} />
      <Block title="Kamino stack (Solstice USDC)" obj={stack.kaminoStack} />

      <div style={{ marginTop: 24, display: "flex", gap: 8 }}>
        <button onClick={() => setEditing((v) => !v)} style={btnSecondary}>
          {editing ? "Cancel" : "Override"}
        </button>
        <button onClick={handleReset} style={btnSecondary}>
          Reset to defaults
        </button>
      </div>

      {editing && (
        <div style={{ marginTop: 16 }}>
          <textarea
            rows={20}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{
              width: "100%",
              background: "#161618",
              color: "#e8e8e8",
              border: "1px solid #2a2a2e",
              padding: 10,
              borderRadius: 4,
              fontFamily: "inherit",
              fontSize: 12,
              resize: "vertical",
            }}
          />
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button onClick={handleSave} style={btnPrimary}>
              Save + reload
            </button>
            {error && <div style={{ color: "#f88", fontSize: 12 }}>{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Block({ title, obj }: { title: string; obj: Record<string, unknown> }) {
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 14, marginBottom: 8 }}>{title}</h3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <tbody>
          {Object.entries(obj).map(([k, v]) => (
            <tr key={k} style={{ borderBottom: "1px solid #1a1a1c" }}>
              <td style={{ color: "#8a8a8a", padding: "6px 8px", width: 220 }}>{k}</td>
              <td
                style={{
                  fontFamily: "ui-monospace, monospace",
                  padding: "6px 8px",
                  wordBreak: "break-all",
                }}
              >
                {String(v)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function stringifyStack(s: ReturnType<typeof useStack>["stack"]): string {
  const flat = (obj: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, String(v)])
    );
  return JSON.stringify(
    {
      cluster: s.cluster,
      rpcUrl: s.rpcUrl,
      lastUpdated: s.lastUpdated,
      programs: flat(s.programs as unknown as Record<string, unknown>),
      kaminoStack: flat(s.kaminoStack as unknown as Record<string, unknown>),
    },
    null,
    2
  );
}

function computeAgeDays(lastUpdated: string): number {
  const t = Date.parse(lastUpdated);
  if (Number.isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / 86_400_000);
}

const btnPrimary: React.CSSProperties = {
  background: "#6cf",
  color: "#0e0e10",
  border: "none",
  padding: "10px 16px",
  borderRadius: 4,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  background: "transparent",
  color: "#e8e8e8",
  border: "1px solid #2a2a2e",
  padding: "10px 16px",
  borderRadius: 4,
  fontSize: 13,
  cursor: "pointer",
};
