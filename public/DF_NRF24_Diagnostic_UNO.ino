/*
 * DF NRF24 Diagnostic V1 — BENCH ONLY
 * Target: Arduino UNO/Nano (ATmega328P, 5V logic via a proper nRF24 adapter such as YL-105)
 * nRF24 SPI: CE D9 / CSN D10 / MOSI D11 / MISO D12 / SCK D13
 * Serial: 115200 baud
 *
 * IMPORTANT:
 * - This is a dedicated diagnostic firmware. Do NOT replace the stage MASTER or RX firmware with it.
 * - It intentionally does not know the show timeline, receiver IDs, or stage protocol.
 * - It talks only to the NRF DIAGNOSTIC web tab using protocol DF_NRF_DIAG_V1.
 */

#include <SPI.h>

static const uint8_t CE_PIN = 9;
static const uint8_t CSN_PIN = 10;
static uint32_t spiHz = 2000000UL;

// nRF24L01+ commands/registers
static const uint8_t R_REGISTER = 0x00;
static const uint8_t W_REGISTER = 0x20;
static const uint8_t R_RX_PAYLOAD = 0x61;
static const uint8_t W_TX_PAYLOAD = 0xA0;
static const uint8_t FLUSH_TX = 0xE1;
static const uint8_t FLUSH_RX = 0xE2;
static const uint8_t NOP_CMD = 0xFF;

static const uint8_t REG_CONFIG = 0x00;
static const uint8_t REG_EN_AA = 0x01;
static const uint8_t REG_EN_RXADDR = 0x02;
static const uint8_t REG_SETUP_AW = 0x03;
static const uint8_t REG_SETUP_RETR = 0x04;
static const uint8_t REG_RF_CH = 0x05;
static const uint8_t REG_RF_SETUP = 0x06;
static const uint8_t REG_STATUS = 0x07;
static const uint8_t REG_OBSERVE_TX = 0x08;
static const uint8_t REG_RPD = 0x09;
static const uint8_t REG_RX_ADDR_P0 = 0x0A;
static const uint8_t REG_TX_ADDR = 0x10;
static const uint8_t REG_RX_PW_P0 = 0x11;
static const uint8_t REG_FIFO_STATUS = 0x17;
static const uint8_t REG_DYNPD = 0x1C;
static const uint8_t REG_FEATURE = 0x1D;

static const uint8_t STATUS_RX_DR = 0x40;
static const uint8_t STATUS_TX_DS = 0x20;
static const uint8_t STATUS_MAX_RT = 0x10;
static const uint8_t CONFIG_PWR_UP = 0x02;
static const uint8_t CONFIG_PRIM_RX = 0x01;

struct Counters {
  uint32_t cycles;
  uint32_t readFail;
  uint32_t writeFail;
  uint32_t badStatus;
};

Counters stressStats = {0, 0, 0, 0};
bool stressRunning = false;
uint32_t lastStressReportMs = 0;
char inputLine[48];
uint8_t inputLen = 0;

static void csnHigh() { digitalWrite(CSN_PIN, HIGH); }
static void csnLow() { digitalWrite(CSN_PIN, LOW); }
static void ceLow() { digitalWrite(CE_PIN, LOW); }
static void ceHigh() { digitalWrite(CE_PIN, HIGH); }

static uint8_t command(uint8_t cmd) {
  SPI.beginTransaction(SPISettings(spiHz, MSBFIRST, SPI_MODE0));
  csnLow();
  uint8_t status = SPI.transfer(cmd);
  csnHigh();
  SPI.endTransaction();
  return status;
}

static uint8_t readReg(uint8_t reg, uint8_t *statusOut = 0) {
  SPI.beginTransaction(SPISettings(spiHz, MSBFIRST, SPI_MODE0));
  csnLow();
  uint8_t status = SPI.transfer(R_REGISTER | (reg & 0x1F));
  uint8_t value = SPI.transfer(NOP_CMD);
  csnHigh();
  SPI.endTransaction();
  if (statusOut) *statusOut = status;
  return value;
}

static uint8_t writeReg(uint8_t reg, uint8_t value) {
  SPI.beginTransaction(SPISettings(spiHz, MSBFIRST, SPI_MODE0));
  csnLow();
  uint8_t status = SPI.transfer(W_REGISTER | (reg & 0x1F));
  SPI.transfer(value);
  csnHigh();
  SPI.endTransaction();
  return status;
}

static void readBytes(uint8_t reg, uint8_t *data, uint8_t len) {
  SPI.beginTransaction(SPISettings(spiHz, MSBFIRST, SPI_MODE0));
  csnLow();
  SPI.transfer(R_REGISTER | (reg & 0x1F));
  while (len--) *data++ = SPI.transfer(NOP_CMD);
  csnHigh();
  SPI.endTransaction();
}

static void writeBytes(uint8_t reg, const uint8_t *data, uint8_t len) {
  SPI.beginTransaction(SPISettings(spiHz, MSBFIRST, SPI_MODE0));
  csnLow();
  SPI.transfer(W_REGISTER | (reg & 0x1F));
  while (len--) SPI.transfer(*data++);
  csnHigh();
  SPI.endTransaction();
}

static void writePayload(const uint8_t *data, uint8_t len) {
  SPI.beginTransaction(SPISettings(spiHz, MSBFIRST, SPI_MODE0));
  csnLow();
  SPI.transfer(W_TX_PAYLOAD);
  while (len--) SPI.transfer(*data++);
  csnHigh();
  SPI.endTransaction();
}

static bool plausibleStatus(uint8_t s) {
  // Bit7 is reserved and should stay 0. RX_P_NO may be 0..7.
  return (s & 0x80) == 0;
}

static bool plausibleRegisters(uint8_t status, uint8_t aw, uint8_t ch) {
  uint8_t awBits = aw & 0x03;
  return plausibleStatus(status) && awBits >= 1 && awBits <= 3 && ch <= 125;
}

static bool chipConnected() {
  uint8_t s1 = 0, s2 = 0;
  uint8_t aw = readReg(REG_SETUP_AW, &s1);
  uint8_t ch = readReg(REG_RF_CH, &s2);
  if ((s1 == 0xFF && s2 == 0xFF) || (s1 == 0x00 && s2 == 0x00 && aw == 0x00 && ch == 0x00)) return false;
  return plausibleRegisters(s2, aw, ch);
}

static uint32_t fnv1aStep(uint32_t hash, uint8_t value) {
  hash ^= value;
  hash *= 16777619UL;
  return hash;
}

static uint32_t configHash() {
  const uint8_t regs[] = { REG_CONFIG, REG_EN_AA, REG_EN_RXADDR, REG_SETUP_AW, REG_SETUP_RETR, REG_RF_CH, REG_RF_SETUP, REG_RX_PW_P0, REG_DYNPD, REG_FEATURE };
  uint32_t hash = 2166136261UL;
  for (uint8_t i = 0; i < sizeof(regs); ++i) {
    hash = fnv1aStep(hash, regs[i]);
    hash = fnv1aStep(hash, readReg(regs[i]));
  }
  return hash;
}

static void printHex32(uint32_t value) {
  const char hex[] = "0123456789ABCDEF";
  for (int8_t shift = 28; shift >= 0; shift -= 4) Serial.print(hex[(value >> shift) & 0x0F]);
}

static bool singleWriteReadback(uint8_t pattern, uint8_t *statusOut = 0) {
  uint8_t before = readReg(REG_RF_CH);
  uint8_t status = writeReg(REG_RF_CH, pattern & 0x7F);
  uint8_t after = readReg(REG_RF_CH);
  writeReg(REG_RF_CH, before);
  if (statusOut) *statusOut = status;
  return after == (pattern & 0x7F);
}

static void measureSpi(uint16_t iterations, uint16_t &readOk, uint16_t &readFail, uint16_t &writeOk, uint16_t &writeFail, uint16_t &badStatus) {
  readOk = readFail = writeOk = writeFail = badStatus = 0;
  const uint8_t patterns[] = { 2, 37, 76, 83 };
  uint8_t originalCh = readReg(REG_RF_CH);
  for (uint16_t i = 0; i < iterations; ++i) {
    uint8_t status = 0;
    uint8_t aw = readReg(REG_SETUP_AW, &status);
    uint8_t ch = readReg(REG_RF_CH);
    if (plausibleRegisters(status, aw, ch)) ++readOk; else ++readFail;
    if (!plausibleStatus(status)) ++badStatus;

    uint8_t pattern = patterns[i & 0x03];
    writeReg(REG_RF_CH, pattern);
    uint8_t got = readReg(REG_RF_CH, &status);
    if (got == pattern) ++writeOk; else ++writeFail;
    if (!plausibleStatus(status)) ++badStatus;
  }
  writeReg(REG_RF_CH, originalCh);
}

static bool ceTxTest() {
  ceLow();

  uint8_t oldConfig = readReg(REG_CONFIG);
  uint8_t oldEnAa = readReg(REG_EN_AA);
  uint8_t oldEnRx = readReg(REG_EN_RXADDR);
  uint8_t oldRetr = readReg(REG_SETUP_RETR);
  uint8_t oldCh = readReg(REG_RF_CH);
  uint8_t oldPw = readReg(REG_RX_PW_P0);
  uint8_t oldTxAddr[5];
  uint8_t oldRxAddr0[5];
  readBytes(REG_TX_ADDR, oldTxAddr, 5);
  readBytes(REG_RX_ADDR_P0, oldRxAddr0, 5);

  command(FLUSH_TX);
  writeReg(REG_STATUS, STATUS_RX_DR | STATUS_TX_DS | STATUS_MAX_RT);
  writeReg(REG_EN_AA, 0x00);          // no ACK required
  writeReg(REG_EN_RXADDR, 0x01);
  writeReg(REG_SETUP_RETR, 0x00);
  writeReg(REG_RF_CH, 2);             // stay away from stage CH76
  writeReg(REG_RX_PW_P0, 1);
  const uint8_t addr[5] = { 'D', 'F', 'D', 'I', 'A' };
  writeBytes(REG_TX_ADDR, addr, 5);
  writeBytes(REG_RX_ADDR_P0, addr, 5);

  uint8_t config = (oldConfig | CONFIG_PWR_UP) & ~CONFIG_PRIM_RX;
  writeReg(REG_CONFIG, config);
  delay(5);

  const uint8_t payload = 0xA5;
  writePayload(&payload, 1);
  ceHigh();
  delayMicroseconds(20);
  ceLow();

  bool pass = false;
  uint32_t start = micros();
  while ((uint32_t)(micros() - start) < 5000UL) {
    uint8_t status = readReg(REG_STATUS);
    if (status & STATUS_TX_DS) { pass = true; break; }
    if (status & STATUS_MAX_RT) break;
  }

  command(FLUSH_TX);
  writeReg(REG_STATUS, STATUS_RX_DR | STATUS_TX_DS | STATUS_MAX_RT);
  writeBytes(REG_TX_ADDR, oldTxAddr, 5);
  writeBytes(REG_RX_ADDR_P0, oldRxAddr0, 5);
  writeReg(REG_RX_PW_P0, oldPw);
  writeReg(REG_RF_CH, oldCh);
  writeReg(REG_SETUP_RETR, oldRetr);
  writeReg(REG_EN_RXADDR, oldEnRx);
  writeReg(REG_EN_AA, oldEnAa);
  writeReg(REG_CONFIG, oldConfig);
  ceLow();
  return pass;
}


static uint16_t rfPeerTest(uint16_t total, uint16_t &okOut, uint16_t &failOut) {
  ceLow();
  uint8_t oldConfig = readReg(REG_CONFIG);
  uint8_t oldEnAa = readReg(REG_EN_AA);
  uint8_t oldEnRx = readReg(REG_EN_RXADDR);
  uint8_t oldAw = readReg(REG_SETUP_AW);
  uint8_t oldRetr = readReg(REG_SETUP_RETR);
  uint8_t oldCh = readReg(REG_RF_CH);
  uint8_t oldRfSetup = readReg(REG_RF_SETUP);
  uint8_t oldPw = readReg(REG_RX_PW_P0);
  uint8_t oldTxAddr[5];
  uint8_t oldRxAddr0[5];
  readBytes(REG_TX_ADDR, oldTxAddr, 5);
  readBytes(REG_RX_ADDR_P0, oldRxAddr0, 5);

  const uint8_t addr[5] = { 'D', 'F', 'R', 'F', '1' };
  command(FLUSH_TX);
  writeReg(REG_STATUS, STATUS_RX_DR | STATUS_TX_DS | STATUS_MAX_RT);
  writeReg(REG_EN_AA, 0x01);
  writeReg(REG_EN_RXADDR, 0x01);
  writeReg(REG_SETUP_AW, 0x03);
  writeReg(REG_SETUP_RETR, 0x3F); // 1 ms retry delay, 15 retries
  writeReg(REG_RF_CH, 42);
  writeReg(REG_RF_SETUP, 0x06);   // 1 Mbps, 0 dBm
  writeReg(REG_RX_PW_P0, 4);
  writeBytes(REG_TX_ADDR, addr, 5);
  writeBytes(REG_RX_ADDR_P0, addr, 5);
  writeReg(REG_CONFIG, 0x0E);     // CRC2, PWR_UP, PTX
  delay(5);

  uint16_t ok = 0;
  uint16_t fail = 0;
  for (uint16_t seq = 0; seq < total; ++seq) {
    command(FLUSH_TX);
    writeReg(REG_STATUS, STATUS_RX_DR | STATUS_TX_DS | STATUS_MAX_RT);
    uint8_t payload[4] = { 0xD4, 0x46, (uint8_t)(seq & 0xFF), (uint8_t)(seq >> 8) };
    writePayload(payload, 4);
    ceHigh();
    delayMicroseconds(20);
    ceLow();

    bool done = false;
    uint32_t start = micros();
    while ((uint32_t)(micros() - start) < 30000UL) {
      uint8_t status = readReg(REG_STATUS);
      if (status & STATUS_TX_DS) { ++ok; done = true; break; }
      if (status & STATUS_MAX_RT) { ++fail; done = true; break; }
    }
    if (!done) ++fail;
    writeReg(REG_STATUS, STATUS_RX_DR | STATUS_TX_DS | STATUS_MAX_RT);
    delay(2);
  }

  command(FLUSH_TX);
  writeReg(REG_STATUS, STATUS_RX_DR | STATUS_TX_DS | STATUS_MAX_RT);
  writeBytes(REG_TX_ADDR, oldTxAddr, 5);
  writeBytes(REG_RX_ADDR_P0, oldRxAddr0, 5);
  writeReg(REG_RX_PW_P0, oldPw);
  writeReg(REG_RF_SETUP, oldRfSetup);
  writeReg(REG_RF_CH, oldCh);
  writeReg(REG_SETUP_RETR, oldRetr);
  writeReg(REG_SETUP_AW, oldAw);
  writeReg(REG_EN_RXADDR, oldEnRx);
  writeReg(REG_EN_AA, oldEnAa);
  writeReg(REG_CONFIG, oldConfig);
  ceLow();

  okOut = ok;
  failOut = fail;
  uint32_t denom = (uint32_t)ok + fail;
  return denom ? (uint32_t)ok * 1000UL / denom : 0;
}

static void printHello() {
  Serial.print(F("{\"type\":\"hello\",\"protocol\":\"DF_NRF_DIAG_V1\",\"board\":\"UNO\",\"ce\":")); Serial.print(CE_PIN);
  Serial.print(F(",\"csn\":")); Serial.print(CSN_PIN);
  Serial.print(F(",\"mosi\":11,\"miso\":12,\"sck\":13,\"baud\":115200}"));
  Serial.println();
}

static void printHealth() {
  uint16_t readOk, readFail, writeOk, writeFail, badStatus;
  measureSpi(120, readOk, readFail, writeOk, writeFail, badStatus);
  uint8_t status = command(NOP_CMD);
  uint8_t config = readReg(REG_CONFIG);
  uint8_t ch = readReg(REG_RF_CH);
  uint8_t aw = readReg(REG_SETUP_AW);
  bool chip = chipConnected();
  bool cePass = chip ? ceTxTest() : false;
  uint16_t readTotal = readOk + readFail;
  uint16_t writeTotal = writeOk + writeFail;
  uint8_t misoScore = readTotal ? (uint32_t)readOk * 100UL / readTotal : 0;
  uint8_t mosiScore = writeTotal ? (uint32_t)writeOk * 100UL / writeTotal : 0;
  uint16_t all = readTotal + writeTotal;
  uint16_t allFail = readFail + writeFail + badStatus;
  uint8_t busScore = all ? (allFail >= all ? 0 : (uint32_t)(all - allFail) * 100UL / all) : 0;
  uint32_t hash = configHash();

  Serial.print(F("{\"type\":\"health\",\"chip\":")); Serial.print(chip ? 1 : 0);
  Serial.print(F(",\"status\":")); Serial.print(status);
  Serial.print(F(",\"config\":")); Serial.print(config);
  Serial.print(F(",\"rf_ch\":")); Serial.print(ch);
  Serial.print(F(",\"setup_aw\":")); Serial.print(aw);
  Serial.print(F(",\"read_ok\":")); Serial.print(readOk);
  Serial.print(F(",\"read_fail\":")); Serial.print(readFail);
  Serial.print(F(",\"write_ok\":")); Serial.print(writeOk);
  Serial.print(F(",\"write_fail\":")); Serial.print(writeFail);
  Serial.print(F(",\"bad_status\":")); Serial.print(badStatus);
  Serial.print(F(",\"miso\":")); Serial.print(misoScore);
  Serial.print(F(",\"mosi\":")); Serial.print(mosiScore);
  Serial.print(F(",\"bus\":")); Serial.print(busScore);
  Serial.print(F(",\"ce\":\"")); Serial.print(cePass ? F("PASS") : F("FAIL")); Serial.print(F("\""));
  Serial.print(F(",\"speed\":")); Serial.print(spiHz);
  Serial.print(F(",\"hash\":\"")); printHex32(hash); Serial.print(F("\"}"));
  Serial.println();
}

static void printRegisters() {
  uint32_t hash = configHash();
  Serial.print(F("{\"type\":\"regs\""));
  Serial.print(F(",\"status\":")); Serial.print(command(NOP_CMD));
  Serial.print(F(",\"config\":")); Serial.print(readReg(REG_CONFIG));
  Serial.print(F(",\"en_aa\":")); Serial.print(readReg(REG_EN_AA));
  Serial.print(F(",\"en_rxaddr\":")); Serial.print(readReg(REG_EN_RXADDR));
  Serial.print(F(",\"setup_aw\":")); Serial.print(readReg(REG_SETUP_AW));
  Serial.print(F(",\"setup_retr\":")); Serial.print(readReg(REG_SETUP_RETR));
  Serial.print(F(",\"rf_ch\":")); Serial.print(readReg(REG_RF_CH));
  Serial.print(F(",\"rf_setup\":")); Serial.print(readReg(REG_RF_SETUP));
  Serial.print(F(",\"fifo_status\":")); Serial.print(readReg(REG_FIFO_STATUS));
  Serial.print(F(",\"dynpd\":")); Serial.print(readReg(REG_DYNPD));
  Serial.print(F(",\"feature\":")); Serial.print(readReg(REG_FEATURE));
  Serial.print(F(",\"hash\":\"")); printHex32(hash); Serial.print(F("\"}"));
  Serial.println();
}

static void printStress() {
  Serial.print(F("{\"type\":\"stress\",\"running\":")); Serial.print(stressRunning ? 1 : 0);
  Serial.print(F(",\"cycles\":")); Serial.print(stressStats.cycles);
  Serial.print(F(",\"read_fail\":")); Serial.print(stressStats.readFail);
  Serial.print(F(",\"write_fail\":")); Serial.print(stressStats.writeFail);
  Serial.print(F(",\"bad_status\":")); Serial.print(stressStats.badStatus);
  Serial.print(F("}")); Serial.println();
}

static void stressBatch(uint8_t count) {
  uint8_t originalCh = readReg(REG_RF_CH);
  const uint8_t patterns[] = { 3, 29, 61, 82 };
  for (uint8_t i = 0; i < count; ++i) {
    uint8_t status = 0;
    uint8_t aw = readReg(REG_SETUP_AW, &status);
    uint8_t ch = readReg(REG_RF_CH);
    if (!plausibleRegisters(status, aw, ch)) ++stressStats.readFail;
    if (!plausibleStatus(status)) ++stressStats.badStatus;

    uint8_t pattern = patterns[stressStats.cycles & 0x03];
    writeReg(REG_RF_CH, pattern);
    uint8_t got = readReg(REG_RF_CH, &status);
    if (got != pattern) ++stressStats.writeFail;
    if (!plausibleStatus(status)) ++stressStats.badStatus;
    ++stressStats.cycles;
  }
  writeReg(REG_RF_CH, originalCh);
}

static void runSweep() {
  const uint32_t speeds[] = { 250000UL, 500000UL, 1000000UL, 2000000UL, 4000000UL, 8000000UL };
  uint32_t restoreHz = spiHz;
  for (uint8_t i = 0; i < 6; ++i) {
    spiHz = speeds[i];
    uint16_t readOk, readFail, writeOk, writeFail, badStatus;
    measureSpi(240, readOk, readFail, writeOk, writeFail, badStatus);
    uint32_t ok = (uint32_t)readOk + writeOk;
    uint32_t fail = (uint32_t)readFail + writeFail + badStatus;
    uint32_t total = ok + fail;
    uint16_t rate = total ? (uint32_t)ok * 1000UL / total : 0;
    Serial.print(F("{\"type\":\"sweep\",\"hz\":")); Serial.print(spiHz);
    Serial.print(F(",\"ok\":")); Serial.print(ok);
    Serial.print(F(",\"fail\":")); Serial.print(fail);
    Serial.print(F(",\"rate\":")); Serial.print(rate);
    Serial.print(F("}")); Serial.println();
  }
  spiHz = restoreHz;
  Serial.println(F("{\"type\":\"sweep_done\"}"));
}

static void resetStats() {
  stressStats.cycles = 0;
  stressStats.readFail = 0;
  stressStats.writeFail = 0;
  stressStats.badStatus = 0;
  printStress();
}

static bool equalsIgnoreCase(const char *a, const char *b) {
  while (*a && *b) {
    char ca = *a >= 'a' && *a <= 'z' ? *a - 32 : *a;
    char cb = *b >= 'a' && *b <= 'z' ? *b - 32 : *b;
    if (ca != cb) return false;
    ++a; ++b;
  }
  return *a == 0 && *b == 0;
}

static void handleCommand(char *line) {
  while (*line == ' ') ++line;
  if (equalsIgnoreCase(line, "HELLO")) { printHello(); return; }
  if (equalsIgnoreCase(line, "CHECK")) { printHealth(); return; }
  if (equalsIgnoreCase(line, "REGDUMP")) { printRegisters(); return; }
  if (equalsIgnoreCase(line, "STRESS START")) { stressRunning = true; printStress(); return; }
  if (equalsIgnoreCase(line, "STRESS STOP")) { stressRunning = false; printStress(); return; }
  if (equalsIgnoreCase(line, "RESET STATS")) { resetStats(); return; }
  if (equalsIgnoreCase(line, "SWEEP")) { stressRunning = false; runSweep(); return; }
  if (equalsIgnoreCase(line, "RF PEER TEST")) {
    stressRunning = false;
    uint16_t ok = 0, fail = 0;
    uint16_t rate = chipConnected() ? rfPeerTest(100, ok, fail) : 0;
    Serial.print(F("{\"type\":\"rf_peer\",\"total\":100,\"ok\":")); Serial.print(ok);
    Serial.print(F(",\"fail\":")); Serial.print(fail);
    Serial.print(F(",\"rate\":")); Serial.print(rate);
    Serial.println(F("}"));
    return;
  }
  if (equalsIgnoreCase(line, "CE TEST")) {
    bool pass = chipConnected() && ceTxTest();
    Serial.print(F("{\"type\":\"ce\",\"ce\":\"")); Serial.print(pass ? F("PASS") : F("FAIL"));
    Serial.println(F("\"}"));
    return;
  }
  Serial.print(F("{\"type\":\"error\",\"message\":\"unknown command: "));
  for (uint8_t i = 0; line[i] && i < 24; ++i) {
    char c = line[i];
    if (c == '\"' || c == '\\') Serial.print(' '); else Serial.print(c);
  }
  Serial.println(F("\"}"));
}

static void pollSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      inputLine[inputLen] = 0;
      if (inputLen) handleCommand(inputLine);
      inputLen = 0;
      continue;
    }
    if (inputLen < sizeof(inputLine) - 1) inputLine[inputLen++] = c;
  }
}

void setup() {
  pinMode(CE_PIN, OUTPUT);
  pinMode(CSN_PIN, OUTPUT);
  ceLow();
  csnHigh();
  Serial.begin(115200);
  SPI.begin();
  delay(120);
  printHello();
}

void loop() {
  pollSerial();
  if (stressRunning) {
    stressBatch(12);
    uint32_t now = millis();
    if (now - lastStressReportMs >= 250) {
      lastStressReportMs = now;
      printStress();
    }
  }
}
