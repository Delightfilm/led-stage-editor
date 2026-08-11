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
          '  // ───────────── nRF24 code generator / receiver fingerprints ─────────────',
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
          '',
          '  const hashNrfTarget = (target) => {',
          '    let hash = 0x811c9dc5;',
          '    const feed = (value) => {',
          '      const s = String(value);',
          '      for (let i = 0; i < s.length; i++) {',
          '        hash ^= s.charCodeAt(i);',
          '        hash = Math.imul(hash, 0x01000193) >>> 0;',
          '      }',
          '      hash ^= 0xff;',
          '      hash = Math.imul(hash, 0x01000193) >>> 0;',
          '    };',
          '    feed(target?.receiverId || 0);',
          '    (target?.parts || []).forEach((part) => {',
          '      feed(part.pin);',
          '      feed(part.endMs);',
          '      (part.frames || []).forEach((frame) => { feed(Math.round(Number(frame.t) || 0)); feed(frame.on ? 1 : 0); });',
          '    });',
          '    return hash >>> 0;',
          '  };',
          '',
          '  const receiverHashes = useMemo(() => receiverExportTargets.map((target) => hashNrfTarget(target)), [receiverExportTargets]);',
          '',
          '  const showHash = useMemo(() => {',
          '    let hash = 0x811c9dc5;',
          '    const feed = (value) => {',
          '      const s = String(value);',
          '      for (let i = 0; i < s.length; i++) {',
          '        hash ^= s.charCodeAt(i);',
          '        hash = Math.imul(hash, 0x01000193) >>> 0;',
          '      }',
          '      hash ^= 0xff;',
          '      hash = Math.imul(hash, 0x01000193) >>> 0;',
          '    };',
          '    feed(masterReceiverCount);',
          '    feed(showDurationMs);',
          '    receiverHashes.forEach(feed);',
          '    return hash >>> 0;',
          '  }, [receiverHashes, masterReceiverCount, showDurationMs]);',
          '',
          '  const showHashText = "0x" + showHash.toString(16).padStart(8, "0").toUpperCase();',
          '',
          '  const selectedReceiverTarget =',
          '    receiverExportTargets.find((t) => t.key === liveCodeTarget) || receiverExportTargets[0] || null;',
          '  const selectedReceiverHash = selectedReceiverTarget ? (receiverHashes[selectedReceiverTarget.receiverId - 1] || 0) : 0;',
          '  const selectedReceiverHashText = "0x" + selectedReceiverHash.toString(16).padStart(8, "0").toUpperCase();',
          '',
          '  const selectedReceiverStorageEstimate = useMemo(() => {',
          '    if (!selectedReceiverTarget) return { events: 0, bytesPerEvent: 2, bytes: 0, flashMin: 0, flashMax: 0, pctMax: 0, status: "" };',
          '    const frames = selectedReceiverTarget.parts.flatMap((p) => p.frames || []);',
          '    const maxTimeMs = frames.reduce((max, frame) => Math.max(max, Number(frame.t) || 0), 0);',
          '    const maxTick = Math.round(maxTimeMs / 20);',
          '    const bytesPerEvent = maxTick <= 0x7fff ? 2 : 4;',
          '    const bytes = frames.length * bytesPerEvent;',
          '    const UNO_FLASH_LIMIT = 32256;',
          '    const partOverhead = selectedReceiverTarget.parts.length * 32;',
          '    const flashMin = 9000 + partOverhead + bytes;',
          '    const flashMax = 13000 + partOverhead + bytes;',
          '    const pctMax = Math.min(999, Math.round((flashMax / UNO_FLASH_LIMIT) * 100));',
          '    const status = pctMax >= 90 ? "위험" : pctMax >= 75 ? "주의" : "여유";',
          '    return { events: frames.length, bytesPerEvent, bytes, flashMin, flashMax, pctMax, status };',
          '  }, [selectedReceiverTarget]);',
          '',
          '  const formatNrfBytes = (bytes) =>',
          '    bytes < 1024 ? Math.round(bytes) + " B" : (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + " KB";',
          '',
          '  const liveNrfCode = useMemo(() => {',
          '    if (liveCodeTarget === "master" || !selectedReceiverTarget) {',
          '      return buildNrf24MasterSketch({ receiverCount: masterReceiverCount, showDurationMs, receiverHashes });',
          '    }',
          '    return buildNrf24ReceiverSketch({ ...selectedReceiverTarget, showHash: selectedReceiverHash });',
          '  }, [liveCodeTarget, selectedReceiverTarget, selectedReceiverHash, masterReceiverCount, showDurationMs, receiverHashes]);',
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

      const panelMarker = '<h2>📡 Arduino 코드</h2>';
      if (!out.includes(panelMarker)) {
        const rightAnchor = '          </section>\n        </aside>\n      </div>\n\n      {/* ── 하단: 전체 의상 무대 미리보기 ── */}';
        if (!out.includes(rightAnchor)) throw new Error("nRF24 plugin: right panel anchor not found");
        const panel = [
          '          </section>',
          '',
          '          <section className="panel" style={{ marginTop: 12, minHeight: 360 }}>',
          '            <div className="panelHead">',
          '              <h2>📡 Arduino 코드</h2>',
          '            </div>',
          '            <p className="dim" style={{ lineHeight: 1.55, marginTop: 0 }}>',
          '              {liveCodeTarget === "master"',
          '                ? "SHOW " + showHashText + " · " + masterReceiverCount + "대 · " + Math.round(showDurationMs / 1000) + "s"',
          '                : "RX HASH " + selectedReceiverHashText + " · 타임라인 " + formatNrfBytes(selectedReceiverStorageEstimate.bytes) + " · 예상 전체 Flash " + formatNrfBytes(selectedReceiverStorageEstimate.flashMin) + "~" + formatNrfBytes(selectedReceiverStorageEstimate.flashMax) + " / 31.5 KB · " + selectedReceiverStorageEstimate.status}',
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
          '                {liveCodeTarget === "master" ? showHashText : "상한 예상 " + selectedReceiverStorageEstimate.pctMax + "%"}',
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
