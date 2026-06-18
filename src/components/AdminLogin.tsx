import { useRef, useEffect, useState } from "react";
import { createEdgeSpark } from "@edgespark/client";

const client = createEdgeSpark({
  baseUrl: "https://staging--b4puosnkz6175drjl5qg.youbase.cloud",
});

export default function AdminLogin() {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [checking, setChecking] = useState(true);

  // Check if already logged in
  useEffect(() => {
    client.auth.getSession().then(session => {
      if (session.data?.user) {
        window.location.hash = "#/inventory-admin";
        return;
      }
      setChecking(false);
      setIsReady(true);
    });
  }, []);

  // Render managed login UI once
  useEffect(() => {
    if (!isReady || renderedRef.current || !containerRef.current) return;
    renderedRef.current = true;

    client.auth.renderAuthUI(containerRef.current, {
      redirectTo: "#/inventory-admin",
      onLogin: () => {
        window.location.hash = "#/inventory-admin";
      },
    });
  }, [isReady]);

  if (checking) {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center">
        <div className="text-noir-300 font-body">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream-50 flex items-center justify-center px-4 py-12">
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div className="text-center mb-8">
          <p className="text-gold-500 font-typewriter text-xs uppercase tracking-[0.3em] mb-2">Frame & Reel</p>
          <h1 className="font-display text-2xl font-bold text-noir-500">Admin Access</h1>
        </div>
        <div ref={containerRef} />
      </div>
    </div>
  );
}
