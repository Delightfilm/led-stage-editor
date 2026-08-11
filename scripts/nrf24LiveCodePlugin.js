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
        out = out.replace(reactImport, `${reactImport}\n${nrfImport}`);
      }

      const stateAnchor = '  const [exportSelected, setExportSelected] = useState({});';
      const stateLine = '  const [liveCodeTarget, setLiveCodeTarget] = useState("master");';
      if (!out.includes(stateLine)) {
        if (!out.includes(stateAnchor)) throw new Error("nRF24 plugin: state anchor not found");
        out = out.replace(stateAnchor, `${stateAnchor}\n${stateLine}`);
      }

      const selectedBlockAnchor = '  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;';
      if (!out.includes("const receiverExportTargets = useMemo")) {
        if (!out.includes(selectedBlockAnchor)) throw new Error("nRF24 plugin: selectedBlock anchor not found");
        const helpers = `  // ───────────── nRF24 live code generator ─────────────\n  const receiverExportTargets = useMemo(() =>\n    costumes.slice(0, 8).map((costume, index) => {\n      const parts = costume.parts.map((part) => {\n        const partBlocks = blocks\n          .filter((b) => b.costumeId === costume.id && b.partId === part.id)\n          .sort((a, b) => a.start - b.start);\n        const { frames, endMs } = bakeOnOffFrames(partBlocks, 20);\n        return { name: part.name, pin: part.pin, frames, endMs, eventCount: partBlocks.length };\n      });\n      return {\n        key: costume.id,\n        receiverId: index + 1,\n        costumeName: costume.name,\n        parts,\n        filename: \\`Receiver_\\${index + 1}.ino\\`,\n        eventCount: parts.reduce((sum, p) => sum + p.eventCount, 0),\n      };\n    }),\n    [costumes, blocks]\n  );\n\n  const masterReceiverCount = Math.max(1, Math.min(8, receiverExportTargets.length || 1));\n  const selectedReceiverTarget =\n    receiverExportTargets.find((t) => t.key === liveCodeTarget) || receiverExportTargets[0] || null;\n\n  const liveNrfCode = useMemo(() => {\n    if (liveCodeTarget === "master" || !selectedReceiverTarget) {\n      return buildNrf24MasterSketch({ receiverCount: masterReceiverCount });\n    }\n    return buildNrf24ReceiverSketch(selectedReceiverTarget);\n  }, [liveCodeTarget, selectedReceiverTarget, masterReceiverCount]);\n\n  const liveNrfFilename =\n    liveCodeTarget === "master" || !selectedReceiverTarget\n      ? "EL_Master_Controller.ino"\n      : selectedReceiverTarget.filename;\n\n  const copyLiveNrfCode = async () => {\n    try {\n      await navigator.clipboard.writeText(liveNrfCode);\n      showToast(\\`📋 \\${liveNrfFilename} 전체 코드를 복사했어요.\\`);\n    } catch {\n      showToast("⚠️ 복사 실패: 코드 창에서 직접 선택해 복사해 주세요.");\n    }\n  };\n\n  const downloadLiveNrfCode = () => {\n    download(liveNrfFilename, liveNrfCode, "text/x-arduino");\n    showToast(\\`📡 \\${liveNrfFilename} 저장 완료\\`);\n  };\n\n`;
        out = out.replace(selectedBlockAnchor, helpers + selectedBlockAnchor);
      }

      const panelMarker = '<h2>📡 nRF24 실시간 코드</h2>';
      if (!out.includes(panelMarker)) {
        const rightAnchor = `          </section>\n        </aside>\n      </div>\n\n      {/* ── 하단: 전체 의상 무대 미리보기 ── */}`;
        if (!out.includes(rightAnchor)) throw new Error("nRF24 plugin: right panel anchor not found");
        const panel = `          </section>\n\n          <section className="panel" style={{ marginTop: 12, minHeight: 360 }}>\n            <div className="panelHead">\n              <h2>📡 nRF24 실시간 코드</h2>\n              <span className="dim">LIVE</span>\n            </div>\n            <p className="dim" style={{ lineHeight: 1.5, marginTop: 0 }}>\n              타임라인 변경 즉시 갱신 · MASTER는 LINK/SYNC/START · RX1~RX8은 각 의상 UNO에 그대로 복사\n            </p>\n            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>\n              <button className={liveCodeTarget === "master" ? "primaryBtn" : "ghostBtn"} onClick={() => setLiveCodeTarget("master")}>MASTER</button>\n              {receiverExportTargets.map((t) => (\n                <button key={t.key} className={liveCodeTarget === t.key ? "primaryBtn" : "ghostBtn"} onClick={() => setLiveCodeTarget(t.key)}>RX{t.receiverId}</button>\n              ))}\n            </div>\n            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>\n              <code style={{ fontSize: 11 }}>{liveNrfFilename}</code>\n              <span className="dim" style={{ fontSize: 11 }}>\n                {liveCodeTarget === "master" ? \\`LINK \\${masterReceiverCount}대\\` : \\`\\${selectedReceiverTarget?.eventCount || 0} blocks\\`}\n              </span>\n            </div>\n            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>\n              <button className="ghostBtn" onClick={copyLiveNrfCode}>📋 전체 코드 복사</button>\n              <button className="primaryBtn" onClick={downloadLiveNrfCode}>⬇ .ino 저장</button>\n            </div>\n            <pre style={{ margin: 0, maxHeight: 430, overflow: "auto", whiteSpace: "pre", fontSize: 10, lineHeight: 1.45, padding: 10, borderRadius: 8, background: "#080b12", border: "1px solid rgba(255,255,255,.08)" }}>\n              <code>{liveNrfCode}</code>\n            </pre>\n          </section>\n        </aside>\n      </div>\n\n      {/* ── 하단: 전체 의상 무대 미리보기 ── */}`;
        out = out.replace(rightAnchor, panel);
      }

      return { code: out, map: null };
    },
  };
}
