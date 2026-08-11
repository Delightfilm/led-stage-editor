export function nrf24LiveCodePlugin() {
  return {
    name: "nrf24-live-code-panel",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("/src/App.jsx")) return null;

      let out = code;

      const reactImport = 'import React, { useState, useRef, useEffect, useMemo } from "react";';
      const nrfImport = 'import { buildNrf24ReceiverSketch, buildNrf24MasterSketch } from "./nrf24Codegen.js";';
      if (!out.includes(nrfImport)) {
        if (!out.includes(reactImport)) throw new Error("nRF24 plugin: React import anchor not found");
        out = out.replace(reactImport, reactImport + "\n" + nrfImport);
      }

      const stateAnchor = '  const [exportSelected, setExportSelected] = useState({});';
      const stateLine = '  const [liveCodeTarget, setLiveCodeTarget] = useState("master");';
      if (!out.includes(stateLine)) {
        if (!out.includes(stateAnchor)) throw new Error("nRF24 plugin: state anchor not found");
        out = out.replace(stateAnchor, stateAnchor + "\n" + stateLine);
      }

      const selectedBlockAnchor = '  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;';
      if (!out.includes("const receiverExportTargets = useMemo")) {
        if (!out.includes(selectedBlockAnchor)) throw new Error("nRF24 plugin: selectedBlock anchor not found");
        const helpers = [
          '  // ───────────── nRF24 live code generator ─────────────',
          '  const receiverExportTargets = useMemo(() =>',
          '    costumes.slice(0, 8).map((costume, index) => {',
          '      const parts = costume.parts.map((part) => {',
          '        const partBlocks = blocks',
          '          .filter((b) => b.costumeId === costume.id && b.partId === part.id)',
          '          .sort((a, b) => a.start - b.start);',
          '        const { frames, endMs } = bakeOnOffFrames(partBlocks, 20);',
          '        return { name: part.name, pin: part.pin, frames, endMs, eventCount: partBlocks.length };',
          '      });',
          '      return {',
          '        key: costume.id,',
          '        receiverId: index + 1,',
          '        costumeName: costume.name,',
          '        parts,',
          '        filename: "Receiver_" + (index + 1) + ".ino",',
          '        eventCount: parts.reduce((sum, p) => sum + p.eventCount, 0),',
          '      };',
          '    }),',
          '    [costumes, blocks]',
          '  );',
          '',
          '  const masterReceiverCount = Math.max(1, Math.min(8, receiverExportTargets.length || 1));',
          '  const showDurationMs = Math.max(0, ...receiverExportTargets.flatMap((t) => t.parts.map((p) => p.endMs || 0)));',
          '  const selectedReceiverTarget =',
          '    receiverExportTargets.find((t) => t.key === liveCodeTarget) || receiverExportTargets[0] || null;',
          '',
          '  const liveNrfCode = useMemo(() => {',
          '    if (liveCodeTarget === "master" || !selectedReceiverTarget) {',
          '      return buildNrf24MasterSketch({ receiverCount: masterReceiverCount, showDurationMs });',
          '    }',
          '    return buildNrf24ReceiverSketch(selectedReceiverTarget);',
          '  }, [liveCodeTarget, selectedReceiverTarget, masterReceiverCount, showDurationMs]);',
          '',
          '  const liveNrfFilename =',
          '    liveCodeTarget === "master" || !selectedReceiverTarget',
          '      ? "EL_Master_Controller.ino"',
          '      : selectedReceiverTarget.filename;',
          '',
          '  const copyLiveNrfCode = async () => {',
          '    try {',
          '      await navigator.clipboard.writeText(liveNrfCode);',
          '      showToast("📋 " + liveNrfFilename + " 전체 코드를 복사했어요.");',
          '    } catch {',
          '      showToast("⚠️ 복사 실패: 코드 창에서 직접 선택해 복사해 주세요.");',
          '    }',
          '  };',
          '',
          '  const downloadLiveNrfCode = () => {',
          '    download(liveNrfFilename, liveNrfCode, "text/x-arduino");',
          '    showToast("📡 " + liveNrfFilename + " 저장 완료");',
          '  };',
          '',
        ].join("\n");
        out = out.replace(selectedBlockAnchor, helpers + selectedBlockAnchor);
      }

      const panelMarker = '<h2>📡 nRF24 실시간 코드</h2>';
      if (!out.includes(panelMarker)) {
        const rightAnchor = '          </section>\n        </aside>\n      </div>\n\n      {/* ── 하단: 전체 의상 무대 미리보기 ── */}';
        if (!out.includes(rightAnchor)) throw new Error("nRF24 plugin: right panel anchor not found");
        const panel = [
          '          </section>',
          '',
          '          <section className="panel" style={{ marginTop: 12, minHeight: 360 }}>',
          '            <div className="panelHead">',
          '              <h2>📡 nRF24 실시간 코드</h2>',
          '              <span className="dim">LIVE</span>',
          '            </div>',
          '            <p className="dim" style={{ lineHeight: 1.5, marginTop: 0 }}>',
          '              타임라인 변경 즉시 갱신 · 약 0.5초 LINK 감시 · OVERRIDE · SHOW_STATE · 안전한 SEEK REJOIN',
          '            </p>',
          '            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>',
          '              <button className={liveCodeTarget === "master" ? "primaryBtn" : "ghostBtn"} onClick={() => setLiveCodeTarget("master")}>MASTER</button>',
          '              {receiverExportTargets.map((t) => (',
          '                <button key={t.key} className={liveCodeTarget === t.key ? "primaryBtn" : "ghostBtn"} onClick={() => setLiveCodeTarget(t.key)}>RX{t.receiverId}</button>',
          '              ))}',
          '            </div>',
          '            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>',
          '              <code style={{ fontSize: 11 }}>{liveNrfFilename}</code>',
          '              <span className="dim" style={{ fontSize: 11 }}>',
          '                {liveCodeTarget === "master" ? "LINK " + masterReceiverCount + "대 · " + Math.round(showDurationMs / 1000) + "s" : (selectedReceiverTarget?.eventCount || 0) + " blocks"}',
          '              </span>',
          '            </div>',
          '            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>',
          '              <button className="ghostBtn" onClick={copyLiveNrfCode}>📋 전체 코드 복사</button>',
          '              <button className="primaryBtn" onClick={downloadLiveNrfCode}>⬇ .ino 저장</button>',
          '            </div>',
          '            <pre style={{ margin: 0, maxHeight: 430, overflow: "auto", whiteSpace: "pre", fontSize: 10, lineHeight: 1.45, padding: 10, borderRadius: 8, background: "#080b12", border: "1px solid rgba(255,255,255,.08)" }}>',
          '              <code>{liveNrfCode}</code>',
          '            </pre>',
          '          </section>',
          '        </aside>',
          '      </div>',
          '',
          '      {/* ── 하단: 전체 의상 무대 미리보기 ── */}',
        ].join("\n");
        out = out.replace(rightAnchor, panel);
      }

      return { code: out, map: null };
    },
  };
}
