const mustReplace = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`ESP32 field-ready: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementEsp32FieldReadyPlugin() {
  return {
    name: 'management-esp32-field-ready',
    enforce: 'pre',
    transform(code, id) {
      // Deliberately scoped away from every nRF24 generator/module.
      if (id.includes('src/managementEsp32Firmware.js')) {
        let out = code
        if (out.includes('ESP_NOW_FIELD_READY_V1')) return { code: out, map: null }

        // managementEsp32Firmware.js emits C++ from a JS template literal. Preserve the
        // C++ character escapes instead of letting JavaScript turn \n/\r into raw line breaks.
        out = mustReplace(
          out,
          "    if (c == '\\n' || c == '\\r') {",
          "    if (c == '\\\\n' || c == '\\\\r') {",
          'MASTER serial C++ escape preservation',
        )

        out = out.replaceAll('ESP-NOW v0.6.11 feature-parity', 'ESP-NOW v0.6.11 FIELD-READY')

        out = mustReplace(
          out,
          'uint32_t pingStartedUs[RECEIVER_COUNT] = {0};\nuint8_t receiverFlags[RECEIVER_COUNT] = {0};',
          [
            'uint32_t pingStartedUs[RECEIVER_COUNT] = {0};',
            'uint32_t pingTokenMs[RECEIVER_COUNT] = {0};',
            'uint8_t pingMissCount[RECEIVER_COUNT] = {0};',
            'int8_t receiverRssi[RECEIVER_COUNT] = {0};',
            'uint8_t receiverMac[RECEIVER_COUNT][6] = {{0}};',
            'bool receiverPeerReady[RECEIVER_COUNT] = {0};',
            'uint8_t receiverFlags[RECEIVER_COUNT] = {0};',
          ].join('\n'),
          'master field telemetry state',
        )

        out = mustReplace(
          out,
          'static_assert(sizeof(StagePacket) <= 250, "ESP-NOW packet too large");\n\nuint32_t lastSeenMs[RECEIVER_COUNT] = {0};',
          'static_assert(sizeof(StagePacket) <= 250, "ESP-NOW packet too large");\nstatic_assert(RECEIVER_COUNT >= 1 && RECEIVER_COUNT <= 7, "FIELD build supports MASTER 1 : RX 1-7 only");\n\nuint32_t lastSeenMs[RECEIVER_COUNT] = {0};',
          '1-to-7 compile guard',
        )

        out = mustReplace(
          out,
          '  esp_now_send(BROADCAST_MAC, reinterpret_cast<const uint8_t*>(&p), sizeof(p));\n}',
          [
            '  const uint8_t* destination = BROADCAST_MAC;',
            '  if (targetId >= 1 && targetId <= RECEIVER_COUNT && receiverPeerReady[targetId - 1]) {',
            '    destination = receiverMac[targetId - 1];',
            '  }',
            '  esp_now_send(destination, reinterpret_cast<const uint8_t*>(&p), sizeof(p));',
            '}',
          ].join('\n'),
          'targeted ESP-NOW transport',
        )

        out = mustReplace(
          out,
          '    Serial.print(0); Serial.print(\':\');\n    Serial.print((receiverFlags[i] & FLAG_PLAYING) ? 1 : 0); Serial.print(\':\');\n    Serial.print(receiverActiveSeq[i]);',
          [
            '    Serial.print(pingMissCount[i]); Serial.print(\':\');',
            '    Serial.print((receiverFlags[i] & FLAG_PLAYING) ? 1 : 0); Serial.print(\':\');',
            '    Serial.print(receiverActiveSeq[i]); Serial.print(\':\');',
            '    Serial.print(receiverRssi[i]);',
          ].join('\n'),
          'RXMON miss/RSSI fields',
        )

        const oldAck = `void handleAck(const StagePacket& p) {
  if (p.magic != MAGIC || p.type != CMD_ACK || p.targetId < 1 || p.targetId > RECEIVER_COUNT) return;
  const uint8_t i = p.targetId - 1;
  const uint32_t nowUs = micros();
  portENTER_CRITICAL(&telemetryMux);
  lastSeenMs[i] = millis();
  lastPingSampleMs[i] = lastSeenMs[i];
  seenHash[i] = p.showHash;
  receiverFlags[i] = p.flags;
  receiverActiveSeq[i] = p.seq;
  if (pingStartedUs[i]) {
    lastPingRttUs[i] = nowUs - pingStartedUs[i];
    pingStartedUs[i] = 0;
  }
  portEXIT_CRITICAL(&telemetryMux);
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onEspNowReceive(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  (void)info;
  if (!data || len != sizeof(StagePacket)) return;
  StagePacket p; memcpy(&p, data, sizeof(p)); handleAck(p);
}
#else
void onEspNowReceive(const uint8_t* mac, const uint8_t* data, int len) {
  (void)mac;
  if (!data || len != sizeof(StagePacket)) return;
  StagePacket p; memcpy(&p, data, sizeof(p)); handleAck(p);
}
#endif`

        const newAck = `bool capturedMac(uint8_t i) {
  for (uint8_t n = 0; n < 6; n++) if (receiverMac[i][n] != 0) return true;
  return false;
}

void refreshKnownPeers() {
  for (uint8_t i = 0; i < RECEIVER_COUNT; i++) {
    if (receiverPeerReady[i] || !capturedMac(i)) continue;
    if (esp_now_is_peer_exist(receiverMac[i])) {
      receiverPeerReady[i] = true;
      continue;
    }
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, receiverMac[i], 6);
    peer.channel = ESPNOW_CHANNEL;
    peer.encrypt = false;
    if (esp_now_add_peer(&peer) == ESP_OK) receiverPeerReady[i] = true;
  }
}

void handleAck(const uint8_t* sourceMac, const StagePacket& p, int8_t rssi) {
  if (p.magic != MAGIC || p.type != CMD_ACK || p.targetId < 1 || p.targetId > RECEIVER_COUNT) return;
  const uint8_t i = p.targetId - 1;
  const uint32_t nowMs = millis();
  const uint32_t nowUs = micros();
  portENTER_CRITICAL(&telemetryMux);
  lastSeenMs[i] = nowMs;
  seenHash[i] = p.showHash;
  receiverFlags[i] = p.flags;
  receiverActiveSeq[i] = p.seq;
  receiverRssi[i] = rssi;
  if (sourceMac) memcpy(receiverMac[i], sourceMac, 6);
  // Only the ACK echoing this receiver's current PING token is an RTT sample.
  // START/SHOW_STATE/PREVIEW ACKs must never corrupt the latency display.
  if (pingStartedUs[i] && pingTokenMs[i] && p.masterTimeMs == pingTokenMs[i]) {
    lastPingRttUs[i] = nowUs - pingStartedUs[i];
    lastPingSampleMs[i] = nowMs;
    pingStartedUs[i] = 0;
    pingTokenMs[i] = 0;
    pingMissCount[i] = 0;
  }
  portEXIT_CRITICAL(&telemetryMux);
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onEspNowReceive(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  if (!data || len != sizeof(StagePacket)) return;
  StagePacket p; memcpy(&p, data, sizeof(p));
  const int8_t rssi = (info && info->rx_ctrl) ? info->rx_ctrl->rssi : 0;
  handleAck(info ? info->src_addr : nullptr, p, rssi);
}
#else
void onEspNowReceive(const uint8_t* mac, const uint8_t* data, int len) {
  if (!data || len != sizeof(StagePacket)) return;
  StagePacket p; memcpy(&p, data, sizeof(p)); handleAck(mac, p, 0);
}
#endif`
        out = mustReplace(out, oldAck, newAck, 'ACK/RTT/MAC learning')

        const oldPing = `void pingOne(uint8_t i) {
  if (i >= RECEIVER_COUNT) return;
  pingStartedUs[i] = micros();
  sendPacketRaw(CMD_PING, i + 1, 0, cueSeq, millis(), showStartMasterMs, EXPECTED_HASH[i]);
}`
        const newPing = `void pingOne(uint8_t i) {
  if (i >= RECEIVER_COUNT) return;
  const uint32_t nowUs = micros();
  // A still-pending sample at the next round means the previous health PING was missed.
  if (pingStartedUs[i] && (uint32_t)(nowUs - pingStartedUs[i]) > 150000UL) {
    if (pingMissCount[i] < 255) pingMissCount[i]++;
  }
  const uint32_t tokenMs = millis();
  pingTokenMs[i] = tokenMs;
  pingStartedUs[i] = nowUs;
  sendPacketRaw(CMD_PING, i + 1, 0, cueSeq, tokenMs, showStartMasterMs, EXPECTED_HASH[i]);
}`
        out = mustReplace(out, oldPing, newPing, 'health ping token/miss accounting')

        out = mustReplace(
          out,
          '  WiFi.setSleep(false);\n  esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);',
          '  WiFi.setSleep(false);\n  esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);\n  esp_wifi_set_max_tx_power(78);',
          'receiver max TX power',
        )
        // The same setup sequence occurs in MASTER after RX; replace the remaining instance too.
        out = out.replace(
          '  WiFi.setSleep(false);\n  esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);',
          '  WiFi.setSleep(false);\n  esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);\n  esp_wifi_set_max_tx_power(78);',
        )

        out = mustReplace(
          out,
          '    Serial.println("LSM_READY LSM-B1 AB_DUAL V065 BUNDLE ${bundleHex}");\n    printStatus();',
          '    Serial.println("LSM_READY LSM-B1 AB_DUAL V065 BUNDLE ${bundleHex}");\n    Serial.println("TRANSPORT ESP_NOW CH6 FIELD_READY");\n    printStatus();',
          'transport identification',
        )

        out = mustReplace(
          out,
          '  const uint32_t now = millis();\n  commitStableAIfDue();',
          '  const uint32_t now = millis();\n  refreshKnownPeers();\n  commitStableAIfDue();',
          'peer refresh in master loop',
        )

        out = out.replace('ESP32_RX${rx.receiverId}_ESP_NOW_V0611.ino', 'ESP32_RX${rx.receiverId}_ESP_NOW_V0611_FIELD.ino')
        out = out.replace("filename: 'ESP32_Master_ESP_NOW_V0611.ino'", "filename: 'ESP32_Master_ESP_NOW_V0611_FIELD.ino'")

        // Marker is in JS source (not generated firmware) so the transform is idempotent.
        out += '\n// ESP_NOW_FIELD_READY_V1\n'
        return { code: out, map: null }
      }

      if (id.includes('src/ManagementApp.jsx')) {
        let out = code
        // Keep the existing telemetry layout/semantics but make its transport wording accurate
        // for both the preserved nRF24 path and the new ESP-NOW path.
        out = out.replace(
          'LIVE는 MASTER의 RXMON/PONG 텔레메트리 기준 · RX ms는 nRF24 PING→ACK 왕복시간',
          'LIVE는 MASTER RXMON/PONG 기준 · RX ms = MASTER PING→RX ACK 왕복시간 · R = 연속 미응답 샘플',
        )
        out = out.replace('<b>RF LIVE</b>', '<b>LINK LIVE</b>')
        return { code: out, map: null }
      }

      return null
    },
  }
}
